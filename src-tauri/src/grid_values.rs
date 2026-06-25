// Per-subcontractor "Subcontractor Details" grid columns. Separate namespace
// from field_values since grid columns (e.g. "trade") are not AcroForm field
// names — see subcontractor_grid_values in db.rs.
use crate::db::Db;
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn get_grid_values(
    state: State<'_, Db>,
    subcontractor_id: i64,
) -> Result<HashMap<String, String>, String> {
    let conn = state.0.lock().map_err(map_err)?;
    let mut stmt = conn
        .prepare("SELECT column_key, value FROM subcontractor_grid_values WHERE subcontractor_id = ?1")
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![subcontractor_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(map_err)?;
    let mut map = HashMap::new();
    for row in rows {
        let (key, val) = row.map_err(map_err)?;
        map.insert(key, val.unwrap_or_default());
    }
    Ok(map)
}

#[tauri::command]
pub fn set_grid_value(
    state: State<'_, Db>,
    subcontractor_id: i64,
    column_key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    if value.is_empty() {
        conn.execute(
            "DELETE FROM subcontractor_grid_values WHERE subcontractor_id = ?1 AND column_key = ?2",
            params![subcontractor_id, column_key],
        )
        .map_err(map_err)?;
    } else {
        conn.execute(
            "INSERT INTO subcontractor_grid_values (subcontractor_id, column_key, value) VALUES (?1, ?2, ?3) \
             ON CONFLICT(subcontractor_id, column_key) DO UPDATE SET value = excluded.value",
            params![subcontractor_id, column_key, value],
        )
        .map_err(map_err)?;
    }
    Ok(())
}

/// Bulk variant of set_grid_value — one transaction for many column_key/value
/// pairs at once (used by CSV reverse-import, which otherwise would be one
/// IPC round-trip per cell).
#[tauri::command]
pub fn bulk_set_grid_values(
    state: State<'_, Db>,
    subcontractor_id: i64,
    values: HashMap<String, String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    for (column_key, value) in values {
        if value.is_empty() {
            conn.execute(
                "DELETE FROM subcontractor_grid_values WHERE subcontractor_id = ?1 AND column_key = ?2",
                params![subcontractor_id, column_key],
            )
            .map_err(map_err)?;
        } else {
            conn.execute(
                "INSERT INTO subcontractor_grid_values (subcontractor_id, column_key, value) VALUES (?1, ?2, ?3) \
                 ON CONFLICT(subcontractor_id, column_key) DO UPDATE SET value = excluded.value",
                params![subcontractor_id, column_key, value],
            )
            .map_err(map_err)?;
        }
    }
    Ok(())
}

/// Returns every subcontractor's grid values at once, keyed by subcontractor
/// id — the grid renders every row simultaneously, so one bulk call avoids
/// an IPC round-trip per row.
#[tauri::command]
pub fn get_grid_values_for_project(
    state: State<'_, Db>,
    project_id: i64,
) -> Result<HashMap<i64, HashMap<String, String>>, String> {
    let conn = state.0.lock().map_err(map_err)?;
    let mut stmt = conn
        .prepare(
            "SELECT v.subcontractor_id, v.column_key, v.value \
             FROM subcontractor_grid_values v \
             JOIN subcontractors s ON s.id = v.subcontractor_id \
             WHERE s.project_id = ?1",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![project_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(map_err)?;
    let mut result: HashMap<i64, HashMap<String, String>> = HashMap::new();
    for row in rows {
        let (sub_id, key, val) = row.map_err(map_err)?;
        result
            .entry(sub_id)
            .or_default()
            .insert(key, val.unwrap_or_default());
    }
    Ok(result)
}
