// Authentication for the web edition: email + password login, opaque session
// tokens in a cookie, an auth guard for the data API, and admin-only user
// management. Built provider-agnostic so Microsoft SSO (P6) can slot in beside
// the password path without changing the guard or the session model.
use crate::db::Pool;
use crate::state::AppState;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::body::Body;
use axum::extract::{Json, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use rand_core::{OsRng, RngCore};
use axum::routing::{get, post};
use axum::{Extension, Router};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const COOKIE_NAME: &str = "sa2025_session";
const SESSION_DAYS: i64 = 30;

type ApiError = (StatusCode, String);

fn infra<E: std::fmt::Display>(e: E) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

/// The authenticated user, inserted into request extensions by the guard and
/// returned by /api/auth/me. camelCase to match the frontend.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub role: String,
}

// ---- password hashing ----

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .and_then(|ph| Argon2::default().verify_password(password.as_bytes(), &ph))
        .is_ok()
}

// ---- sessions ----

fn gen_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn create_session(conn: &Connection, user_id: i64) -> Result<String, String> {
    let token = gen_token();
    conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at) \
         VALUES (?1, ?2, datetime('now', ?3))",
        params![token, user_id, format!("+{SESSION_DAYS} days")],
    )
    .map_err(|e| e.to_string())?;
    Ok(token)
}

fn user_for_token(conn: &Connection, token: &str) -> Result<Option<User>, String> {
    conn.query_row(
        "SELECT u.id, u.email, u.display_name, u.role \
         FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.token = ?1 AND s.expires_at > datetime('now')",
        params![token],
        |r| {
            Ok(User {
                id: r.get(0)?,
                email: r.get(1)?,
                display_name: r.get(2)?,
                role: r.get(3)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

// ---- cookies ----

fn cookie_from_headers(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|kv| {
            let (k, v) = kv.trim().split_once('=')?;
            (k == name).then(|| v.to_string())
        })
        .next()
}

fn session_cookie(token: &str, secure: bool) -> String {
    let mut c = format!(
        "{COOKIE_NAME}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        SESSION_DAYS * 24 * 3600
    );
    if secure {
        c.push_str("; Secure");
    }
    c
}

fn clear_cookie(secure: bool) -> String {
    let mut c = format!("{COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    if secure {
        c.push_str("; Secure");
    }
    c
}

// ---- guard middleware (wraps the data API) ----

/// Rejects any request without a valid session cookie with 401; otherwise
/// injects the `User` into the request extensions for downstream handlers.
pub async fn require_auth(
    State(s): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let user = match cookie_from_headers(req.headers(), COOKIE_NAME) {
        Some(token) => {
            let conn = s.pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            user_for_token(&conn, &token).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        }
        None => None,
    };
    match user {
        Some(u) => {
            req.extensions_mut().insert(u);
            Ok(next.run(req).await)
        }
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

// ---- public auth routes ----

pub fn auth_router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
}

#[derive(Deserialize)]
struct LoginArgs {
    email: String,
    password: String,
}

async fn login(State(s): State<AppState>, Json(a): Json<LoginArgs>) -> Result<Response, ApiError> {
    let conn = s.pool.get().map_err(infra)?;
    let email = a.email.trim();
    let row: Option<(i64, String, Option<String>, String, String)> = conn
        .query_row(
            "SELECT id, email, password_hash, display_name, role \
             FROM users WHERE email = ?1 COLLATE NOCASE",
            params![email],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(infra)?;

    let unauthorized = || (StatusCode::UNAUTHORIZED, "Invalid email or password.".to_string());
    let (id, email, hash, display_name, role) = row.ok_or_else(unauthorized)?;
    let hash = hash.ok_or_else(unauthorized)?; // SSO-only account: no password
    if !verify_password(&a.password, &hash) {
        return Err(unauthorized());
    }

    let token = create_session(&conn, id).map_err(infra)?;
    let user = User {
        id,
        email,
        display_name,
        role,
    };
    let body = serde_json::to_string(&user).map_err(infra)?;
    let mut resp = Response::new(Body::from(body));
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    resp.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&session_cookie(&token, s.cookie_secure)).map_err(infra)?,
    );
    Ok(resp)
}

async fn logout(State(s): State<AppState>, headers: HeaderMap) -> Result<Response, ApiError> {
    if let Some(token) = cookie_from_headers(&headers, COOKIE_NAME) {
        let conn = s.pool.get().map_err(infra)?;
        let _ = conn.execute("DELETE FROM sessions WHERE token = ?1", params![token]);
    }
    let mut resp = Response::new(Body::from("null"));
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    resp.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&clear_cookie(s.cookie_secure)).map_err(infra)?,
    );
    Ok(resp)
}

async fn me(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<User>, StatusCode> {
    let token = cookie_from_headers(&headers, COOKIE_NAME).ok_or(StatusCode::UNAUTHORIZED)?;
    let conn = s.pool.get().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    match user_for_token(&conn, &token).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        Some(u) => Ok(Json(u)),
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

// ---- admin-only user management (mounted on the protected router) ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserRow {
    id: i64,
    email: String,
    display_name: String,
    role: String,
    created_at: String,
}

fn require_admin(user: &User) -> Result<(), ApiError> {
    if user.role == "admin" {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, "Admins only.".to_string()))
    }
}

pub async fn list_users(
    State(s): State<AppState>,
    Extension(me): Extension<User>,
) -> Result<Json<Vec<UserRow>>, ApiError> {
    require_admin(&me)?;
    let conn = s.pool.get().map_err(infra)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, email, display_name, role, created_at FROM users \
             ORDER BY email COLLATE NOCASE",
        )
        .map_err(infra)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(UserRow {
                id: r.get(0)?,
                email: r.get(1)?,
                display_name: r.get(2)?,
                role: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(infra)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(infra)?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateUserArgs {
    email: String,
    password: String,
    display_name: String,
    role: String,
}

pub async fn create_user(
    State(s): State<AppState>,
    Extension(me): Extension<User>,
    Json(a): Json<CreateUserArgs>,
) -> Result<Json<UserRow>, ApiError> {
    require_admin(&me)?;
    let bad = |m: &str| (StatusCode::BAD_REQUEST, m.to_string());
    let email = a.email.trim().to_string();
    let display_name = a.display_name.trim().to_string();
    if email.is_empty() || !email.contains('@') {
        return Err(bad("A valid email is required."));
    }
    if display_name.is_empty() {
        return Err(bad("A display name is required."));
    }
    if a.password.len() < 8 {
        return Err(bad("Password must be at least 8 characters."));
    }
    if a.role != "admin" && a.role != "member" {
        return Err(bad("Role must be 'admin' or 'member'."));
    }
    let hash = hash_password(&a.password).map_err(infra)?;
    let conn = s.pool.get().map_err(infra)?;
    conn.execute(
        "INSERT INTO users (email, password_hash, display_name, role) VALUES (?1, ?2, ?3, ?4)",
        params![email, hash, display_name, a.role],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            bad("A user with that email already exists.")
        } else {
            infra(e)
        }
    })?;
    let id = conn.last_insert_rowid();
    let created_at: String = conn
        .query_row("SELECT created_at FROM users WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(infra)?;
    Ok(Json(UserRow {
        id,
        email,
        display_name,
        role: a.role,
        created_at,
    }))
}

#[derive(Deserialize)]
pub(crate) struct DeleteUserArgs {
    id: i64,
}

pub async fn delete_user(
    State(s): State<AppState>,
    Extension(me): Extension<User>,
    Json(a): Json<DeleteUserArgs>,
) -> Result<Json<()>, ApiError> {
    require_admin(&me)?;
    if a.id == me.id {
        return Err((StatusCode::BAD_REQUEST, "You can't delete your own account.".to_string()));
    }
    // Remove the user's data in one transaction so no orphans are left: their
    // projects (child rows cascade via FK), their last-project marker, and the
    // account itself (sessions cascade via FK).
    let mut conn = s.pool.get().map_err(infra)?;
    let tx = conn.transaction().map_err(infra)?;
    tx.execute("DELETE FROM projects WHERE owner_user_id = ?1", params![a.id])
        .map_err(infra)?;
    tx.execute(
        "DELETE FROM app_state WHERE key = ?1",
        params![format!("last_project:{}", a.id)],
    )
    .map_err(infra)?;
    tx.execute("DELETE FROM users WHERE id = ?1", params![a.id])
        .map_err(infra)?;
    tx.commit().map_err(infra)?;
    Ok(Json(()))
}

/// Admin-only: sweep away accumulated cruft (expired sessions, orphaned
/// projects) and VACUUM to reclaim file space. Returns the counts removed.
pub async fn cleanup_database(
    State(s): State<AppState>,
    Extension(me): Extension<User>,
) -> Result<Json<crate::db::Maintenance>, ApiError> {
    require_admin(&me)?;
    let conn = s.pool.get().map_err(infra)?;
    let report = crate::db::run_maintenance(&conn).map_err(infra)?;
    // Reclaim space from the deleted rows. VACUUM can't run inside a transaction
    // (none is open here) and is fine on a WAL database.
    conn.execute("VACUUM", []).map_err(infra)?;
    Ok(Json(report))
}

// ---- startup admin bootstrap ----

/// Creates the initial admin from ADMIN_EMAIL / ADMIN_PASSWORD if that account
/// doesn't exist yet. Warns if there are no users and no admin env is set (the
/// app is unusable until an admin exists).
pub fn seed_admin_if_configured(pool: &Pool) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("admin seed: no connection: {e}");
            return;
        }
    };
    let email = std::env::var("ADMIN_EMAIL").ok().filter(|s| !s.trim().is_empty());
    let password = std::env::var("ADMIN_PASSWORD").ok().filter(|s| !s.is_empty());

    match (email, password) {
        (Some(email), Some(password)) => {
            let email = email.trim();
            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM users WHERE email = ?1 COLLATE NOCASE",
                    params![email],
                    |_| Ok(true),
                )
                .optional()
                .unwrap_or(None)
                .unwrap_or(false);
            if exists {
                return;
            }
            match hash_password(&password) {
                Ok(hash) => {
                    match conn.execute(
                        "INSERT INTO users (email, password_hash, display_name, role) \
                         VALUES (?1, ?2, 'Administrator', 'admin')",
                        params![email, hash],
                    ) {
                        Ok(_) => tracing::info!("seeded admin account {email}"),
                        Err(e) => tracing::error!("admin seed insert failed: {e}"),
                    }
                }
                Err(e) => tracing::error!("admin seed hash failed: {e}"),
            }
        }
        _ => {
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
                .unwrap_or(0);
            if count == 0 {
                tracing::warn!(
                    "no users exist and ADMIN_EMAIL/ADMIN_PASSWORD are not set - \
                     set them to bootstrap the first admin, then log in and add users."
                );
            }
        }
    }
}
