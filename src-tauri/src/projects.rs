// Project & subcontractor persistence commands (Milestone 3).
use crate::db::Db;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

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

#[tauri::command]
pub fn create_project(
    state: State<'_, Db>,
    name: String,
    project_number: String,
) -> Result<Project, String> {
    let name = name.trim().to_string();
    let project_number = project_number.trim().to_string();
    if name.is_empty() || project_number.is_empty() {
        return Err("Project name and number are required.".into());
    }
    let conn = state.0.lock().map_err(map_err)?;
    conn.execute(
        "INSERT INTO projects (name, project_number) VALUES (?1, ?2)",
        params![name, project_number],
    )
    .map_err(map_err)?;
    Ok(Project {
        id: conn.last_insert_rowid(),
        name,
        project_number,
    })
}

#[tauri::command]
pub fn list_projects(state: State<'_, Db>) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(map_err)?;
    let mut stmt = conn
        .prepare("SELECT id, name, project_number FROM projects ORDER BY name COLLATE NOCASE")
        .map_err(map_err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                project_number: r.get(2)?,
            })
        })
        .map_err(map_err)?;
    rows.collect::<Result<_, _>>().map_err(map_err)
}

#[tauri::command]
pub fn rename_project(
    state: State<'_, Db>,
    id: i64,
    name: String,
    project_number: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    let project_number = project_number.trim().to_string();
    if name.is_empty() || project_number.is_empty() {
        return Err("Project name and number are required.".into());
    }
    let conn = state.0.lock().map_err(map_err)?;
    conn.execute(
        "UPDATE projects SET name = ?1, project_number = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![name, project_number, id],
    )
    .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_project(state: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn add_subcontractor(
    state: State<'_, Db>,
    project_id: i64,
    name: String,
) -> Result<Subcontractor, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Subcontractor name is required.".into());
    }
    let conn = state.0.lock().map_err(map_err)?;
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

#[tauri::command]
pub fn list_subcontractors(
    state: State<'_, Db>,
    project_id: i64,
) -> Result<Vec<Subcontractor>, String> {
    let conn = state.0.lock().map_err(map_err)?;
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

#[tauri::command]
pub fn rename_subcontractor(state: State<'_, Db>, id: i64, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Subcontractor name is required.".into());
    }
    let conn = state.0.lock().map_err(map_err)?;
    conn.execute(
        "UPDATE subcontractors SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_subcontractor(state: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    conn.execute("DELETE FROM subcontractors WHERE id = ?1", params![id])
        .map_err(map_err)?;
    Ok(())
}

// --- field values (the per-subcontractor form data) ---

#[tauri::command]
pub fn get_field_values(
    state: State<'_, Db>,
    subcontractor_id: i64,
) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = state.0.lock().map_err(map_err)?;
    let mut stmt = conn
        .prepare("SELECT field_name, value FROM field_values WHERE subcontractor_id = ?1")
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![subcontractor_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(map_err)?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (name, val) = row.map_err(map_err)?;
        map.insert(name, val.unwrap_or_default());
    }
    Ok(map)
}

#[tauri::command]
pub fn set_field_value(
    state: State<'_, Db>,
    subcontractor_id: i64,
    field_name: String,
    value: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    if value.is_empty() {
        // Keep the table tidy — an empty value is the absence of a value.
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

#[tauri::command]
pub fn get_csv_selection(
    state: State<'_, Db>,
    project_id: i64,
) -> Result<Option<Vec<String>>, String> {
    let conn = state.0.lock().map_err(map_err)?;
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

#[tauri::command]
pub fn set_csv_selection(
    state: State<'_, Db>,
    project_id: i64,
    fields: Vec<String>,
) -> Result<(), String> {
    let json = serde_json::to_string(&fields).map_err(map_err)?;
    let conn = state.0.lock().map_err(map_err)?;
    conn.execute(
        "UPDATE projects SET csv_export_selection = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![json, project_id],
    )
    .map_err(map_err)?;
    Ok(())
}

// --- last-opened project, for restoring the workspace on reload ---

#[tauri::command]
pub fn set_last_project(state: State<'_, Db>, id: Option<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    match id {
        Some(v) => conn
            .execute(
                "INSERT INTO app_state (key, value) VALUES ('last_project', ?1) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![v.to_string()],
            )
            .map(|_| ())
            .map_err(map_err),
        None => conn
            .execute("DELETE FROM app_state WHERE key = 'last_project'", [])
            .map(|_| ())
            .map_err(map_err),
    }
}

#[tauri::command]
pub fn get_last_project(state: State<'_, Db>) -> Result<Option<i64>, String> {
    let conn = state.0.lock().map_err(map_err)?;
    let val: Option<String> = conn
        .query_row(
            "SELECT value FROM app_state WHERE key = 'last_project'",
            [],
            |r| r.get(0),
        )
        .ok();
    Ok(val.and_then(|v| v.parse::<i64>().ok()))
}
