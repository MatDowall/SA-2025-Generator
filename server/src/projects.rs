// Project & subcontractor persistence. Ported from the desktop app
// (src-tauri/src/projects.rs): the only change is each function takes a
// `&Connection` instead of locking a Tauri-managed `State<Db>`; SQL is verbatim.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub project_number: String,
}

#[derive(Serialize)]
pub struct Subcontractor {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub ordering: i64,
}

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn create_project(
    conn: &Connection,
    owner_user_id: i64,
    name: String,
    project_number: String,
) -> Result<Project, String> {
    let name = name.trim().to_string();
    let project_number = project_number.trim().to_string();
    if name.is_empty() || project_number.is_empty() {
        return Err("Project name and number are required.".into());
    }
    conn.execute(
        "INSERT INTO projects (name, project_number, owner_user_id) VALUES (?1, ?2, ?3)",
        params![name, project_number, owner_user_id],
    )
    .map_err(map_err)?;
    Ok(Project {
        id: conn.last_insert_rowid(),
        name,
        project_number,
    })
}

/// Only the caller's own projects (projects are private to their creator).
pub fn list_projects(conn: &Connection, owner_user_id: i64) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, project_number FROM projects \
             WHERE owner_user_id = ?1 ORDER BY name COLLATE NOCASE",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![owner_user_id], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                project_number: r.get(2)?,
            })
        })
        .map_err(map_err)?;
    rows.collect::<Result<_, _>>().map_err(map_err)
}

/// Error returned when a project/subcontractor isn't the caller's. Deliberately
/// generic (doesn't distinguish "missing" from "someone else's").
const NO_ACCESS: &str = "You don't have access to this project.";

/// Verifies `project_id` exists and belongs to `user_id`.
pub fn assert_project_owner(
    conn: &Connection,
    project_id: i64,
    user_id: i64,
) -> Result<(), String> {
    let owner: Option<Option<i64>> = conn
        .query_row(
            "SELECT owner_user_id FROM projects WHERE id = ?1",
            params![project_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(map_err)?;
    match owner {
        Some(Some(o)) if o == user_id => Ok(()),
        _ => Err(NO_ACCESS.to_string()),
    }
}

/// Verifies `subcontractor_id` belongs to a project owned by `user_id`.
pub fn assert_sub_owner(
    conn: &Connection,
    subcontractor_id: i64,
    user_id: i64,
) -> Result<(), String> {
    let owner: Option<Option<i64>> = conn
        .query_row(
            "SELECT p.owner_user_id FROM subcontractors s \
             JOIN projects p ON p.id = s.project_id WHERE s.id = ?1",
            params![subcontractor_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(map_err)?;
    match owner {
        Some(Some(o)) if o == user_id => Ok(()),
        _ => Err(NO_ACCESS.to_string()),
    }
}

/// One-time migration: assign projects created before the per-user change to
/// `admin_id`. Idempotent (only touches NULL-owner rows).
pub fn assign_orphan_projects(conn: &Connection, admin_id: i64) -> Result<usize, String> {
    conn.execute(
        "UPDATE projects SET owner_user_id = ?1 WHERE owner_user_id IS NULL",
        params![admin_id],
    )
    .map_err(map_err)
}

pub fn rename_project(
    conn: &Connection,
    id: i64,
    name: String,
    project_number: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    let project_number = project_number.trim().to_string();
    if name.is_empty() || project_number.is_empty() {
        return Err("Project name and number are required.".into());
    }
    conn.execute(
        "UPDATE projects SET name = ?1, project_number = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![name, project_number, id],
    )
    .map_err(map_err)?;
    Ok(())
}

pub fn delete_project(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(map_err)?;
    Ok(())
}

pub fn add_subcontractor(
    conn: &Connection,
    project_id: i64,
    name: String,
) -> Result<Subcontractor, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Subcontractor name is required.".into());
    }
    let ordering: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(ordering), -1) + 1 FROM subcontractors WHERE project_id = ?1",
            params![project_id],
            |r| r.get(0),
        )
        .map_err(map_err)?;
    conn.execute(
        "INSERT INTO subcontractors (project_id, name, ordering) VALUES (?1, ?2, ?3)",
        params![project_id, name, ordering],
    )
    .map_err(map_err)?;
    Ok(Subcontractor {
        id: conn.last_insert_rowid(),
        project_id,
        name,
        ordering,
    })
}

pub fn list_subcontractors(conn: &Connection, project_id: i64) -> Result<Vec<Subcontractor>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, name, ordering FROM subcontractors \
             WHERE project_id = ?1 ORDER BY ordering, id",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![project_id], |r| {
            Ok(Subcontractor {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                ordering: r.get(3)?,
            })
        })
        .map_err(map_err)?;
    rows.collect::<Result<_, _>>().map_err(map_err)
}

pub fn rename_subcontractor(conn: &Connection, id: i64, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Subcontractor name is required.".into());
    }
    conn.execute(
        "UPDATE subcontractors SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(map_err)?;
    Ok(())
}

pub fn delete_subcontractor(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM subcontractors WHERE id = ?1", params![id])
        .map_err(map_err)?;
    Ok(())
}

// --- field values (the per-subcontractor form data) ---

pub fn get_field_values(
    conn: &Connection,
    subcontractor_id: i64,
) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT field_name, value FROM field_values WHERE subcontractor_id = ?1")
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![subcontractor_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(map_err)?;
    let mut map = HashMap::new();
    for row in rows {
        let (name, val) = row.map_err(map_err)?;
        map.insert(name, val.unwrap_or_default());
    }
    Ok(map)
}

pub fn set_field_value(
    conn: &Connection,
    subcontractor_id: i64,
    field_name: String,
    value: String,
) -> Result<(), String> {
    if value.is_empty() {
        conn.execute(
            "DELETE FROM field_values WHERE subcontractor_id = ?1 AND field_name = ?2",
            params![subcontractor_id, field_name],
        )
        .map_err(map_err)?;
    } else {
        conn.execute(
            "INSERT INTO field_values (subcontractor_id, field_name, value) VALUES (?1, ?2, ?3) \
             ON CONFLICT(subcontractor_id, field_name) DO UPDATE SET value = excluded.value",
            params![subcontractor_id, field_name, value],
        )
        .map_err(map_err)?;
    }
    Ok(())
}

// --- per-project CSV export field selection (remembered) ---

pub fn get_csv_selection(conn: &Connection, project_id: i64) -> Result<Option<Vec<String>>, String> {
    let json: Option<String> = conn
        .query_row(
            "SELECT csv_export_selection FROM projects WHERE id = ?1",
            params![project_id],
            |r| r.get(0),
        )
        .map_err(map_err)?;
    match json {
        Some(s) => serde_json::from_str(&s).map(Some).map_err(map_err),
        None => Ok(None),
    }
}

pub fn set_csv_selection(
    conn: &Connection,
    project_id: i64,
    fields: Vec<String>,
) -> Result<(), String> {
    let json = serde_json::to_string(&fields).map_err(map_err)?;
    conn.execute(
        "UPDATE projects SET csv_export_selection = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![json, project_id],
    )
    .map_err(map_err)?;
    Ok(())
}

// --- last-opened project, for restoring the workspace on reload ---

pub fn set_last_project(conn: &Connection, user_id: i64, id: Option<i64>) -> Result<(), String> {
    let key = format!("last_project:{user_id}");
    match id {
        Some(v) => conn
            .execute(
                "INSERT INTO app_state (key, value) VALUES (?1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, v.to_string()],
            )
            .map(|_| ())
            .map_err(map_err),
        None => conn
            .execute("DELETE FROM app_state WHERE key = ?1", params![key])
            .map(|_| ())
            .map_err(map_err),
    }
}

pub fn get_last_project(conn: &Connection, user_id: i64) -> Result<Option<i64>, String> {
    let key = format!("last_project:{user_id}");
    let val: Option<String> = conn
        .query_row("SELECT value FROM app_state WHERE key = ?1", params![key], |r| {
            r.get(0)
        })
        .ok();
    Ok(val.and_then(|v| v.parse::<i64>().ok()))
}
