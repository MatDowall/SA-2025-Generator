// Shared SQLite persistence for the web edition.
//
// Unlike the desktop app (one process, one `Mutex<Connection>`), the server is
// concurrent, so the DB is a single shared file accessed through an r2d2 pool
// with WAL journalling. WAL lets readers and a writer proceed concurrently,
// which is ample for a single firm's team.
//
// The application schema is ported verbatim from the desktop
// (src-tauri/src/db.rs) so the P2 endpoint handlers reuse the same tables and
// queries unchanged. Two tables are added for the web edition: `users` and
// `sessions` (auth, wired up in P4).

use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;

pub type Pool = r2d2::Pool<SqliteConnectionManager>;
// Used by the P2 endpoint handlers (one pooled connection per request).
#[allow(dead_code)]
pub type PooledConn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Full schema. Ported from the desktop app, plus `users`/`sessions`. Because
/// the web DB is greenfield, columns added by later desktop releases (e.g.
/// tp_companies.is_active) are declared directly in the CREATE statements - no
/// ALTER-based migrations needed as there is no legacy web DB to upgrade.
const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    project_number  TEXT NOT NULL,
    csv_export_selection TEXT,
    -- Projects are private to their creator (unlike the shared tp_companies /
    -- staff / settings directories). NULL only for pre-per-user rows, which the
    -- startup migration reassigns to the first admin.
    owner_user_id   INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subcontractors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    ordering    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS field_values (
    subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
    field_name       TEXT NOT NULL,
    value            TEXT,
    PRIMARY KEY (subcontractor_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_subcontractors_project ON subcontractors(project_id);

CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS contract_info_values (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    field_key   TEXT NOT NULL,
    value       TEXT,
    PRIMARY KEY (project_id, field_key)
);

CREATE TABLE IF NOT EXISTS subcontractor_grid_values (
    subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
    column_key        TEXT NOT NULL,
    value             TEXT,
    PRIMARY KEY (subcontractor_id, column_key)
);

CREATE TABLE IF NOT EXISTS tp_companies (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    company             TEXT NOT NULL,
    legal_name_register TEXT,
    nzbn                TEXT,
    legal_name_nzbn     TEXT,
    address_1           TEXT,
    address_2           TEXT,
    address_3           TEXT,
    city                TEXT,
    zip                 TEXT,
    full_address        TEXT,
    business_phone      TEXT,
    email               TEXT,
    directors           TEXT,
    trades              TEXT,
    standard_cost_code  TEXT,
    ordering            INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER,
    match_status        TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS staff_directory (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    role      TEXT NOT NULL CHECK (role IN ('PM','BTM','QS')),
    name      TEXT NOT NULL,
    mobile    TEXT,
    email     TEXT,
    ordering  INTEGER NOT NULL DEFAULT 0,
    signature_png TEXT
);

CREATE TABLE IF NOT EXISTS subcontractor_audit (
    subcontractor_id  INTEGER PRIMARY KEY REFERENCES subcontractors(id) ON DELETE CASCADE,
    loa_sent_date      TEXT,
    fa_sent_date       TEXT,
    sa_sent_date       TEXT,
    sa_returned_date   TEXT,
    notes              TEXT
);

CREATE INDEX IF NOT EXISTS idx_grid_values_sub ON subcontractor_grid_values(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_contract_info_project ON contract_info_values(project_id);
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff_directory(role);

-- Web edition: authentication (one firm, shared team). Wired up in P4.
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT,                     -- argon2; NULL for SSO-only accounts
    display_name   TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    ms_oid         TEXT UNIQUE,              -- reserved for Microsoft SSO linking
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    failed_attempts INTEGER NOT NULL DEFAULT 0,  -- consecutive failed logins (rolling window)
    last_failed_at TEXT,                      -- timestamp of the last failed login
    locked_until   TEXT                       -- if in the future, logins are refused
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,             -- random opaque id, set as httpOnly cookie
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Web edition: single-use tokens for self-service password setup (invite) and,
-- later, reset. Only the sha256 of the raw token is stored, so a DB read alone
-- cannot be replayed to set a password. Rows cascade when the user is deleted.
CREATE TABLE IF NOT EXISTS user_tokens (
    token_hash TEXT PRIMARY KEY,               -- sha256 hex of the raw token
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL CHECK (purpose IN ('invite','reset')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used_at    TEXT                             -- NULL until consumed; single-use
);

CREATE INDEX IF NOT EXISTS idx_user_tokens_user ON user_tokens(user_id);

-- Security audit trail for account events (invite/reset issued, activation,
-- password change, lockout). Deliberately has NO foreign keys so the history
-- survives user deletion; emails are denormalized so entries stay readable.
CREATE TABLE IF NOT EXISTS auth_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    event          TEXT NOT NULL,          -- invite_created | reset_created | activated | password_changed | account_locked
    target_user_id INTEGER,                -- the account acted upon (may be gone later)
    target_email   TEXT,
    actor_user_id  INTEGER,                -- who did it (admin, the user, or NULL = system)
    actor_email    TEXT,
    detail         TEXT                     -- freeform (e.g. token purpose)
);
"#;

/// Builds the connection pool for the SQLite file at `path`, applying WAL and
/// foreign-key pragmas to every pooled connection, then runs the schema once.
pub fn init_pool(path: &Path) -> Result<Pool, String> {
    let manager = SqliteConnectionManager::file(path).with_init(|c| {
        // journal_mode=WAL is a persistent DB-level setting (idempotent to
        // re-assert); foreign_keys and busy_timeout are per-connection, so they
        // must be set on every connection the pool hands out.
        c.execute_batch(
            "PRAGMA journal_mode = WAL;\
             PRAGMA foreign_keys = ON;\
             PRAGMA busy_timeout = 5000;",
        )
    });

    let pool = r2d2::Pool::builder()
        .build(manager)
        .map_err(|e| format!("build pool: {e}"))?;

    let conn = pool.get().map_err(|e| format!("get connection: {e}"))?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("apply schema: {e}"))?;
    // Upgrade a DB created before projects were per-user, then index the column
    // (after the ALTER, so it exists on already-created projects tables too).
    ensure_column(&conn, "projects", "owner_user_id", "INTEGER")
        .map_err(|e| format!("migrate projects.owner_user_id: {e}"))?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id)",
        [],
    )
    .map_err(|e| format!("index projects.owner_user_id: {e}"))?;

    // Login rate-limiting columns for DBs created before lockout was added.
    ensure_column(&conn, "users", "failed_attempts", "INTEGER NOT NULL DEFAULT 0")
        .map_err(|e| format!("migrate users.failed_attempts: {e}"))?;
    ensure_column(&conn, "users", "last_failed_at", "TEXT")
        .map_err(|e| format!("migrate users.last_failed_at: {e}"))?;
    ensure_column(&conn, "users", "locked_until", "TEXT")
        .map_err(|e| format!("migrate users.locked_until: {e}"))?;

    // Final Account send-date column for DBs created before the Final Account
    // tab was added.
    ensure_column(&conn, "subcontractor_audit", "fa_sent_date", "TEXT")
        .map_err(|e| format!("migrate subcontractor_audit.fa_sent_date: {e}"))?;

    Ok(pool)
}

/// Counts of rows removed by a maintenance sweep.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Maintenance {
    pub expired_sessions: usize,
    pub orphan_projects: usize,
    pub orphan_last_project_keys: usize,
    pub spent_tokens: usize,
}

/// Removes rows that can accumulate over time: expired sessions, projects whose
/// owner no longer exists (and, via ON DELETE CASCADE, all their child rows),
/// and per-user last-project markers for deleted users. Cheap; safe to run at
/// startup and on demand. Does not VACUUM (callers that want to reclaim file
/// space run VACUUM separately).
pub fn run_maintenance(conn: &Connection) -> Result<Maintenance, String> {
    let expired_sessions = conn
        .execute("DELETE FROM sessions WHERE expires_at <= datetime('now')", [])
        .map_err(|e| e.to_string())?;
    // owner_user_id NULL is a pre-migration state handled elsewhere; only rows
    // pointing at a since-deleted user are orphans. Child rows cascade.
    let orphan_projects = conn
        .execute(
            "DELETE FROM projects \
             WHERE owner_user_id IS NOT NULL \
               AND owner_user_id NOT IN (SELECT id FROM users)",
            [],
        )
        .map_err(|e| e.to_string())?;
    let orphan_last_project_keys = conn
        .execute(
            "DELETE FROM app_state WHERE key LIKE 'last_project:%' \
             AND CAST(substr(key, 14) AS INTEGER) NOT IN (SELECT id FROM users)",
            [],
        )
        .map_err(|e| e.to_string())?;
    // Invite/reset tokens that are used or past expiry are dead weight.
    let spent_tokens = conn
        .execute(
            "DELETE FROM user_tokens \
             WHERE used_at IS NOT NULL OR expires_at <= datetime('now')",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(Maintenance {
        expired_sessions,
        orphan_projects,
        orphan_last_project_keys,
        spent_tokens,
    })
}

/// Adds `column` to `table` if an earlier schema version created the table
/// without it (CREATE TABLE IF NOT EXISTS above only covers fresh installs).
fn ensure_column(
    conn: &rusqlite::Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let exists = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .any(|c| c == column);
    if !exists {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])?;
    }
    Ok(())
}
