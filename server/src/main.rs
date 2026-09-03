// SA-2025 Generator - web server.
//
// P0: serves the SPA + /api/health.
// P1: shared SQLite pool (WAL), reported from /api/health.
// P2: mounts the /api RPC router (all former Tauri commands) and seeds the
//     settings + TP-companies directories on first run.
//
// P4 will wrap /api in the auth guard.

mod audit;
mod auth;
mod compute;
mod contract_info;
mod db;
mod export;
mod fieldmap;
mod grid_values;
mod import;
mod nzbn_api;
mod projectfile;
mod projects;
mod routes;
mod settings;
mod state;
mod tp_companies;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Html;
use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use state::AppState;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::services::ServeDir;

/// Server configuration, all sourced from the environment.
struct Config {
    port: u16,
    static_dir: PathBuf,
    data_dir: PathBuf,
    resources_dir: PathBuf,
    /// Session cookies carry `Secure` only when true (set in production, where
    /// TLS is terminated by the proxy). Default false for plain-HTTP local dev.
    cookie_secure: bool,
}

impl Config {
    fn from_env() -> Self {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(8080);
        let static_dir = std::env::var("STATIC_DIR")
            .unwrap_or_else(|_| "static".to_string())
            .into();
        let data_dir = std::env::var("DATA_DIR")
            .unwrap_or_else(|_| "data".to_string())
            .into();
        let resources_dir = std::env::var("RESOURCES_DIR")
            .unwrap_or_else(|_| "resources".to_string())
            .into();
        let cookie_secure = std::env::var("COOKIE_SECURE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        Self {
            port,
            static_dir,
            data_dir,
            resources_dir,
            cookie_secure,
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let cfg = Config::from_env();

    // Open (or create) the shared SQLite database.
    std::fs::create_dir_all(&cfg.data_dir)
        .unwrap_or_else(|e| panic!("create data dir {}: {e}", cfg.data_dir.display()));
    let db_path = cfg.data_dir.join("sa2025.sqlite");
    let pool = db::init_pool(&db_path)
        .unwrap_or_else(|e| panic!("init database {}: {e}", db_path.display()));
    tracing::info!("database ready at {}", db_path.display());

    // One-time seed of settings/staff and the TP-companies directory from the
    // bundled resources, mirroring the desktop's first-run behaviour.
    seed_on_first_run(&pool, &cfg.resources_dir);

    // Bootstrap the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if configured.
    auth::seed_admin_if_configured(&pool);

    // Projects are per-user; assign any pre-per-user (unowned) projects to the
    // first admin so existing data stays visible after the upgrade.
    if let Ok(conn) = pool.get() {
        let admin_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();
        if let Some(admin_id) = admin_id {
            match projects::assign_orphan_projects(&conn, admin_id) {
                Ok(n) if n > 0 => {
                    tracing::info!("assigned {n} pre-existing project(s) to admin id {admin_id}")
                }
                Err(e) => tracing::error!("orphan project migration failed: {e}"),
                _ => {}
            }
        }
        // Sweep accumulated cruft (expired sessions, orphaned projects from any
        // prior user deletions) so the DB self-heals on boot.
        match db::run_maintenance(&conn) {
            Ok(m) => {
                if m.expired_sessions + m.orphan_projects + m.orphan_last_project_keys > 0 {
                    tracing::info!(
                        "startup cleanup: {} expired session(s), {} orphan project(s), {} stale marker(s)",
                        m.expired_sessions,
                        m.orphan_projects,
                        m.orphan_last_project_keys
                    );
                }
            }
            Err(e) => tracing::error!("startup cleanup failed: {e}"),
        }
    }

    let state = AppState {
        pool,
        resources_dir: Arc::new(cfg.resources_dir.clone()),
        cookie_secure: cfg.cookie_secure,
    };

    // Vite emits hashed assets under /assets and a single index.html. Serve the
    // assets dir directly (real 200/404), and route everything else to the SPA
    // shell with a 200 so client-side routing and full-page reloads both work.
    let index_html = std::fs::read_to_string(cfg.static_dir.join("index.html"))
        .unwrap_or_else(|e| panic!("read {}/index.html: {e}", cfg.static_dir.display()));

    // The data API sits behind the auth guard; health and the auth routes
    // (login/logout/me) stay public, as do the SPA and its assets.
    let protected = routes::api_router().route_layer(axum::middleware::from_fn_with_state(
        state.clone(),
        auth::require_auth,
    ));

    let app = Router::new()
        .route("/api/health", get(health))
        .merge(auth::auth_router())
        .merge(protected)
        .nest_service("/assets", ServeDir::new(cfg.static_dir.join("assets")))
        .fallback(move || {
            let body = index_html.clone();
            async move { Html(body) }
        })
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], cfg.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));
    tracing::info!(
        "SA-2025 web server listening on http://{addr} (serving {})",
        cfg.static_dir.display()
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

/// Seeds settings/staff and TP companies from the bundled resource JSON if those
/// tables are still empty (idempotent - safe on every boot).
fn seed_on_first_run(pool: &db::Pool, resources_dir: &std::path::Path) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("seed: could not get connection: {e}");
            return;
        }
    };
    match std::fs::read_to_string(resources_dir.join("settings-seed.json")) {
        Ok(json) => {
            if let Err(e) = settings::seed_settings_if_empty(&conn, &json) {
                tracing::error!("settings seed failed: {e}");
            }
        }
        Err(e) => tracing::warn!("settings-seed.json not read: {e}"),
    }
    match std::fs::read_to_string(resources_dir.join("tp-companies-seed.json")) {
        Ok(json) => {
            if let Err(e) = tp_companies::seed_tp_companies_if_empty(&conn, &json) {
                tracing::error!("tp_companies seed failed: {e}");
            }
        }
        Err(e) => tracing::warn!("tp-companies-seed.json not read: {e}"),
    }
}

/// Liveness + DB readiness probe.
async fn health(State(state): State<AppState>) -> Result<Json<Value>, (StatusCode, String)> {
    let conn = state
        .pool
        .get()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db pool: {e}")))?;
    let table_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db query: {e}")))?;

    Ok(Json(json!({
        "status": "ok",
        "service": "sa2025-web",
        "phase": "P5",
        "db": { "tables": table_count },
    })))
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}
