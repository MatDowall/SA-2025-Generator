// Global per-project "Contract Info" answers. Key/value shape mirrors
// field_values so the (later) recompute pipeline can treat both uniformly.
use crate::db::Db;
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn get_contract_info(
    state: State<'_, Db>,
    project_id: i64,
) -> Result<HashMap<String, String>, String> {
    let conn = state.0.lock().map_err(map_err)?;
    let mut stmt = conn
        .prepare("SELECT field_key, value FROM contract_info_values WHERE project_id = ?1")
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![project_id], |r| {
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
pub fn set_contract_info_value(
    state: State<'_, Db>,
    project_id: i64,
    field_key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    if value.is_empty() {
        conn.execute(
            "DELETE FROM contract_info_values WHERE project_id = ?1 AND field_key = ?2",
            params![project_id, field_key],
        )
        .map_err(map_err)?;
    } else {
        conn.execute(
            "INSERT INTO contract_info_values (project_id, field_key, value) VALUES (?1, ?2, ?3) \
             ON CONFLICT(project_id, field_key) DO UPDATE SET value = excluded.value",
            params![project_id, field_key, value],
        )
        .map_err(map_err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_contract_info_bulk(
    state: State<'_, Db>,
    project_id: i64,
    values: HashMap<String, String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    for (field_key, value) in values {
        if value.is_empty() {
            conn.execute(
                "DELETE FROM contract_info_values WHERE project_id = ?1 AND field_key = ?2",
                params![project_id, field_key],
            )
            .map_err(map_err)?;
        } else {
            conn.execute(
                "INSERT INTO contract_info_values (project_id, field_key, value) VALUES (?1, ?2, ?3) \
                 ON CONFLICT(project_id, field_key) DO UPDATE SET value = excluded.value",
                params![project_id, field_key, value],
            )
            .map_err(map_err)?;
        }
    }
    Ok(())
}
