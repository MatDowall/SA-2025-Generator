// SQLite persistence layer for SA-2025 Generator.
// Schema is intentionally minimal for Milestone 0; later milestones build on it.
use rusqlite::Connection;
use std::sync::Mutex;

/// Wraps the SQLite connection so it can live in Tauri's managed state.
pub struct Db(pub Mutex<Connection>);

/// Initial schema. field_values is keyed by AcroForm field name (the template
/// is the single source of truth — see resources/field-map.json).
const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    project_number  TEXT NOT NULL,
    csv_export_selection TEXT,           -- JSON array of field names, remembered per project
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
    field_name       TEXT NOT NULL,      -- matches an AcroForm field name
    value            TEXT,
    PRIMARY KEY (subcontractor_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_subcontractors_project ON subcontractors(project_id);

-- Small key/value store for app state (e.g. last-opened project).
CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Global per-project answers from the "Contract Info" tab. Key/value shape
-- mirrors field_values so the recompute pipeline can treat both uniformly.
CREATE TABLE IF NOT EXISTS contract_info_values (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    field_key   TEXT NOT NULL,
    value       TEXT,
    PRIMARY KEY (project_id, field_key)
);

-- Per-subcontractor "Subcontractor Details" grid columns. Separate namespace
-- from field_values since grid columns (e.g. "trade") are not AcroForm field names.
CREATE TABLE IF NOT EXISTS subcontractor_grid_values (
    subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
    column_key        TEXT NOT NULL,
    value             TEXT,
    PRIMARY KEY (subcontractor_id, column_key)
);

-- Global (not project-scoped) subcontractor directory, seeded once from the
-- legacy workbook's hidden "TP Companies" sheet; future work repopulates via API.
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
    is_active           INTEGER  -- NULL = not checked against the Companies Register yet, 1 = active, 0 = inactive
);

-- Generic global settings: company identity scalars and JSON-array reference
-- lists (e.g. list_sub_trades, list_retentions) that replace the legacy
-- workbook's hidden "Drop Down Lists" sheet.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Staff directories (PM / BTM / QS), structured rather than flat strings so
-- each name carries mobile + email, mirroring the legacy Drop Down Lists' use.
CREATE TABLE IF NOT EXISTS staff_directory (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    role      TEXT NOT NULL CHECK (role IN ('PM','BTM','QS')),
    name      TEXT NOT NULL,
    mobile    TEXT,
    email     TEXT,
    ordering  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_grid_values_sub ON subcontractor_grid_values(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_contract_info_project ON contract_info_values(project_id);
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff_directory(role);
"#;

/// Adds `column` to `table` if an earlier release created the table without
/// it — `CREATE TABLE IF NOT EXISTS` in SCHEMA above only covers fresh installs.
fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> rusqlite::Result<()> {
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

pub fn init(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    ensure_column(&conn, "tp_companies", "is_active", "INTEGER")?;
    Ok(conn)
}
