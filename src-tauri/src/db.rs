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
"#;

pub fn init(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}
