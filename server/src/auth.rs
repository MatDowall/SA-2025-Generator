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
/// How long an invite link stays valid before the admin must re-issue it.
const INVITE_HOURS: i64 = 72;
/// Reset links are shorter-lived than invites (they target an active account).
const RESET_HOURS: i64 = 24;
/// Minimum password length. Length beats composition rules (current NIST guidance).
const MIN_PASSWORD_LEN: usize = 12;
/// Login rate-limiting: this many consecutive failed logins within the rolling
/// window locks the account for the cooldown period.
const MAX_FAILED_ATTEMPTS: i64 = 5;
const LOCKOUT_MINUTES: i64 = 15;
/// A failure older than this resets the running count (rolling window).
const ATTEMPT_WINDOW_MINUTES: i64 = 15;

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

/// Shared password policy (reused by activation now, change-password later).
fn validate_password(password: &str) -> Result<(), ApiError> {
    if password.len() < MIN_PASSWORD_LEN {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Password must be at least {MIN_PASSWORD_LEN} characters."),
        ));
    }
    Ok(())
}

// ---- login rate-limiting (per-account lockout) ----

/// Records a failed login. Uses a rolling window: a failure older than the
/// window resets the count. Returns true if this failure just locked the
/// account (reached the threshold).
fn register_failed_login(conn: &Connection, user_id: i64) -> Result<bool, String> {
    conn.execute(
        &format!(
            "UPDATE users SET \
               failed_attempts = CASE \
                 WHEN last_failed_at IS NULL \
                   OR last_failed_at <= datetime('now', '-{ATTEMPT_WINDOW_MINUTES} minutes') THEN 1 \
                 ELSE failed_attempts + 1 END, \
               last_failed_at = datetime('now') \
             WHERE id = ?1"
        ),
        params![user_id],
    )
    .map_err(|e| e.to_string())?;
    let attempts: i64 = conn
        .query_row(
            "SELECT failed_attempts FROM users WHERE id = ?1",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if attempts >= MAX_FAILED_ATTEMPTS {
        // Lock, and reset the counter so a fresh set of attempts is available
        // once the cooldown elapses.
        conn.execute(
            &format!(
                "UPDATE users SET locked_until = datetime('now', '+{LOCKOUT_MINUTES} minutes'), \
                 failed_attempts = 0 WHERE id = ?1"
            ),
            params![user_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

/// Clears any failure count / lock after a successful auth (login, or a password
/// set via activation).
fn clear_login_failures(conn: &Connection, user_id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE users SET failed_attempts = 0, last_failed_at = NULL, locked_until = NULL \
         WHERE id = ?1",
        params![user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

// ---- invite / reset tokens ----

/// sha256 of the raw token, hex-encoded. Only this is stored, so a DB read
/// alone can't be replayed to set a password.
fn token_hash(raw: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(raw.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Inserts a fresh single-use token and returns the RAW token (shown once,
/// never persisted).
fn mint_token(conn: &Connection, user_id: i64, purpose: &str, hours: i64) -> Result<String, String> {
    let raw = gen_token();
    conn.execute(
        "INSERT INTO user_tokens (token_hash, user_id, purpose, expires_at) \
         VALUES (?1, ?2, ?3, datetime('now', ?4))",
        params![token_hash(&raw), user_id, purpose, format!("+{hours} hours")],
    )
    .map_err(|e| e.to_string())?;
    Ok(raw)
}

/// Resolves a live (unused, unexpired) password-setup token — invite OR reset,
/// which share the same "set a password" activation flow — to its
/// (user_id, email, purpose), or None if it's missing/spent/expired.
fn lookup_setup_token(
    conn: &Connection,
    raw: &str,
) -> Result<Option<(i64, String, String)>, String> {
    conn.query_row(
        "SELECT u.id, u.email, t.purpose FROM user_tokens t JOIN users u ON u.id = t.user_id \
         WHERE t.token_hash = ?1 AND t.purpose IN ('invite','reset') \
           AND t.used_at IS NULL AND t.expires_at > datetime('now')",
        params![token_hash(raw)],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

// ---- security audit trail ----

/// Records an account-security event. Best-effort: a logging failure is warned
/// about but never fails the operation it's auditing.
fn log_auth_event(
    conn: &Connection,
    event: &str,
    target_user_id: Option<i64>,
    target_email: &str,
    actor_user_id: Option<i64>,
    actor_email: Option<&str>,
    detail: Option<&str>,
) {
    if let Err(e) = conn.execute(
        "INSERT INTO auth_events \
           (event, target_user_id, target_email, actor_user_id, actor_email, detail) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![event, target_user_id, target_email, actor_user_id, actor_email, detail],
    ) {
        tracing::warn!("auth_events insert failed ({event}): {e}");
    }
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
        .route("/api/auth/token_info", post(token_info))
        .route("/api/auth/activate", post(activate))
}

#[derive(Deserialize)]
struct LoginArgs {
    email: String,
    password: String,
}

async fn login(State(s): State<AppState>, Json(a): Json<LoginArgs>) -> Result<Response, ApiError> {
    let conn = s.pool.get().map_err(infra)?;
    let email = a.email.trim();
    // `lock_mins` is Some(remaining minutes) while the account is locked, else None.
    let row: Option<(i64, String, Option<String>, String, String, Option<i64>)> = conn
        .query_row(
            "SELECT id, email, password_hash, display_name, role, \
               CASE WHEN locked_until IS NOT NULL AND locked_until > datetime('now') \
                    THEN CAST((julianday(locked_until) - julianday('now')) * 1440 AS INTEGER) + 1 \
                    ELSE NULL END \
             FROM users WHERE email = ?1 COLLATE NOCASE",
            params![email],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()
        .map_err(infra)?;

    let unauthorized = || (StatusCode::UNAUTHORIZED, "Invalid email or password.".to_string());
    let (id, email, hash, display_name, role, lock_mins) = row.ok_or_else(unauthorized)?;

    // Refuse a locked account before even checking the password.
    if let Some(mins) = lock_mins {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            format!("Too many failed attempts. Try again in about {mins} minute(s)."),
        ));
    }

    // A null hash (invited/not-yet-activated) counts as a failed verification.
    let ok = match &hash {
        Some(h) => verify_password(&a.password, h),
        None => false,
    };
    if !ok {
        let locked = register_failed_login(&conn, id).map_err(infra)?;
        if locked {
            // System-initiated lockout (no actor).
            log_auth_event(&conn, "account_locked", Some(id), &email, None, None, None);
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                format!("Too many failed attempts. This account is locked for {LOCKOUT_MINUTES} minutes."),
            ));
        }
        return Err(unauthorized());
    }

    clear_login_failures(&conn, id).map_err(infra)?;
    let token = create_session(&conn, id).map_err(infra)?;
    let user = User {
        id,
        email,
        display_name,
        role,
    };
    session_response(&user, &token, s.cookie_secure)
}

/// Builds a JSON `User` body with a fresh session cookie attached. Shared by the
/// login and activation paths so both land the caller signed in identically.
fn session_response(user: &User, token: &str, secure: bool) -> Result<Response, ApiError> {
    let body = serde_json::to_string(user).map_err(infra)?;
    let mut resp = Response::new(Body::from(body));
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    resp.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&session_cookie(token, secure)).map_err(infra)?,
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

// ---- self-service activation (public; invite-link flow) ----

#[derive(Deserialize)]
struct TokenArgs {
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenInfo {
    email: String,
}

/// Generic error for a token that's missing, already used, or expired. Kept
/// deliberately vague (410) so it can't be used to probe for accounts.
fn dead_token() -> ApiError {
    (
        StatusCode::GONE,
        "This link has expired or has already been used. Ask an admin for a new invite.".to_string(),
    )
}

/// Validates an invite token and returns the target email so the activation
/// page can show whose account is being set up. Does not consume the token.
async fn token_info(
    State(s): State<AppState>,
    Json(a): Json<TokenArgs>,
) -> Result<Json<TokenInfo>, ApiError> {
    let conn = s.pool.get().map_err(infra)?;
    let (_id, email, _purpose) = lookup_setup_token(&conn, &a.token)
        .map_err(infra)?
        .ok_or_else(dead_token)?;
    Ok(Json(TokenInfo { email }))
}

#[derive(Deserialize)]
struct ActivateArgs {
    token: String,
    password: String,
}

/// Consumes an invite token: sets the user's password, marks the token used,
/// invalidates any other outstanding invites for that user, and signs them in.
async fn activate(
    State(s): State<AppState>,
    Json(a): Json<ActivateArgs>,
) -> Result<Response, ApiError> {
    validate_password(&a.password)?;
    let mut conn = s.pool.get().map_err(infra)?;

    // Validate + consume atomically so a token can't be replayed by concurrent
    // requests.
    let tx = conn.transaction().map_err(infra)?;
    let (user_id, _email, purpose) = lookup_setup_token(&tx, &a.token)
        .map_err(infra)?
        .ok_or_else(dead_token)?;
    let hash = hash_password(&a.password).map_err(infra)?;
    // Setting a password also clears any failed-login lockout on the account.
    tx.execute(
        "UPDATE users SET password_hash = ?1, failed_attempts = 0, \
         last_failed_at = NULL, locked_until = NULL WHERE id = ?2",
        params![hash, user_id],
    )
    .map_err(infra)?;
    // Burn every outstanding setup token for this user (invite or reset — the one
    // just used and any superseded ones), so none can be reused.
    tx.execute(
        "UPDATE user_tokens SET used_at = datetime('now') \
         WHERE user_id = ?1 AND purpose IN ('invite','reset') AND used_at IS NULL",
        params![user_id],
    )
    .map_err(infra)?;
    tx.commit().map_err(infra)?;

    // Load the now-activated user and sign them in.
    let user = conn
        .query_row(
            "SELECT id, email, display_name, role FROM users WHERE id = ?1",
            params![user_id],
            |r| {
                Ok(User {
                    id: r.get(0)?,
                    email: r.get(1)?,
                    display_name: r.get(2)?,
                    role: r.get(3)?,
                })
            },
        )
        .map_err(infra)?;
    // The user activated their own account (self-actor); note which link type.
    log_auth_event(
        &conn,
        "activated",
        Some(user.id),
        &user.email,
        Some(user.id),
        Some(&user.email),
        Some(&purpose),
    );
    let session = create_session(&conn, user_id).map_err(infra)?;
    session_response(&user, &session, s.cookie_secure)
}

// ---- self-service change password (protected; any signed-in user) ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangePasswordArgs {
    current_password: String,
    new_password: String,
}

/// Lets a signed-in user rotate their own password. Requires the current
/// password, enforces the shared policy, then invalidates every *other* session
/// for that user (keeping the caller's own) so a stolen cookie elsewhere dies.
pub async fn change_password(
    State(s): State<AppState>,
    Extension(me): Extension<User>,
    headers: HeaderMap,
    Json(a): Json<ChangePasswordArgs>,
) -> Result<Json<()>, ApiError> {
    validate_password(&a.new_password)?;
    if a.new_password == a.current_password {
        return Err((
            StatusCode::BAD_REQUEST,
            "New password must be different from the current one.".to_string(),
        ));
    }
    let conn = s.pool.get().map_err(infra)?;

    // Verify the current password against the stored hash.
    let hash: Option<String> = conn
        .query_row(
            "SELECT password_hash FROM users WHERE id = ?1",
            params![me.id],
            |r| r.get(0),
        )
        .map_err(infra)?;
    let wrong = || (StatusCode::BAD_REQUEST, "Current password is incorrect.".to_string());
    let hash = hash.ok_or_else(wrong)?; // no password set (shouldn't happen for a live session)
    if !verify_password(&a.current_password, &hash) {
        return Err(wrong());
    }

    let new_hash = hash_password(&a.new_password).map_err(infra)?;
    conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![new_hash, me.id],
    )
    .map_err(infra)?;

    // Drop every other session for this user; keep the one making this request.
    if let Some(current) = cookie_from_headers(&headers, COOKIE_NAME) {
        conn.execute(
            "DELETE FROM sessions WHERE user_id = ?1 AND token != ?2",
            params![me.id, current],
        )
        .map_err(infra)?;
    }
    log_auth_event(
        &conn,
        "password_changed",
        Some(me.id),
        &me.email,
        Some(me.id),
        Some(&me.email),
        None,
    );
    Ok(Json(()))
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthEventRow {
    id: i64,
    created_at: String,
    event: String,
    target_email: Option<String>,
    actor_email: Option<String>,
    detail: Option<String>,
}

/// Admin-only: the most recent account-security events, newest first.
pub async fn list_auth_events(
    State(s): State<AppState>,
    Extension(me): Extension<User>,
) -> Result<Json<Vec<AuthEventRow>>, ApiError> {
    require_admin(&me)?;
    let conn = s.pool.get().map_err(infra)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, created_at, event, target_email, actor_email, detail \
             FROM auth_events ORDER BY id DESC LIMIT 200",
        )
        .map_err(infra)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AuthEventRow {
                id: r.get(0)?,
                created_at: r.get(1)?,
                event: r.get(2)?,
                target_email: r.get(3)?,
                actor_email: r.get(4)?,
                detail: r.get(5)?,
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
    display_name: String,
    role: String,
}

/// The created account plus a one-time invite token. The raw token is returned
/// exactly once (never stored in plaintext); the admin composes an
/// `/activate#<token>` link from it and hands it to the new user.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatedUser {
    user: UserRow,
    invite_token: String,
    expires_hours: i64,
}

pub async fn create_user(
    State(s): State<AppState>,
    Extension(me): Extension<User>,
    Json(a): Json<CreateUserArgs>,
) -> Result<Json<CreatedUser>, ApiError> {
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
    if a.role != "admin" && a.role != "member" {
        return Err(bad("Role must be 'admin' or 'member'."));
    }
    // The account starts with no password (NULL hash); the invitee sets it via
    // the activation link. Login already rejects a null-hash account.
    let mut conn = s.pool.get().map_err(infra)?;
    let tx = conn.transaction().map_err(infra)?;
    tx.execute(
        "INSERT INTO users (email, password_hash, display_name, role) VALUES (?1, NULL, ?2, ?3)",
        params![email, display_name, a.role],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            bad("A user with that email already exists.")
        } else {
            infra(e)
        }
    })?;
    let id = tx.last_insert_rowid();
    let created_at: String = tx
        .query_row("SELECT created_at FROM users WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(infra)?;
    let invite_token = mint_token(&tx, id, "invite", INVITE_HOURS).map_err(infra)?;
    tx.commit().map_err(infra)?;
    log_auth_event(
        &conn,
        "invite_created",
        Some(id),
        &email,
        Some(me.id),
        Some(&me.email),
        None,
    );
    Ok(Json(CreatedUser {
        user: UserRow {
            id,
            email,
            display_name,
            role: a.role,
            created_at,
        },
        invite_token,
        expires_hours: INVITE_HOURS,
    }))
}

#[derive(Deserialize)]
pub(crate) struct UserIdArgs {
    id: i64,
}

/// A one-time reset link's raw token + TTL, returned once for the admin to hand
/// to the user (same `/activate#<token>` flow as an invite).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetLink {
    token: String,
    expires_hours: i64,
    email: String,
}

/// Admin-only: mint a fresh reset token for an existing user. Does not touch the
/// current password — the user sets a new one when they open the link.
pub async fn create_reset_link(
    State(s): State<AppState>,
    Extension(me): Extension<User>,
    Json(a): Json<UserIdArgs>,
) -> Result<Json<ResetLink>, ApiError> {
    require_admin(&me)?;
    let conn = s.pool.get().map_err(infra)?;
    let email: Option<String> = conn
        .query_row("SELECT email FROM users WHERE id = ?1", params![a.id], |r| r.get(0))
        .optional()
        .map_err(infra)?;
    let email = email.ok_or((StatusCode::NOT_FOUND, "No such user.".to_string()))?;
    let token = mint_token(&conn, a.id, "reset", RESET_HOURS).map_err(infra)?;
    log_auth_event(
        &conn,
        "reset_created",
        Some(a.id),
        &email,
        Some(me.id),
        Some(&me.email),
        None,
    );
    Ok(Json(ResetLink {
        token,
        expires_hours: RESET_HOURS,
        email,
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
