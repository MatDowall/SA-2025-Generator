// Bridge for the frontend's Mapping-sheet recompute pipeline (see
// src/lib/hyperformulaEngine.ts, mappingFormulas.ts): the actual HyperFormula
// evaluation happens in the frontend, this just persists the resulting
// {field_name: value} map in one transaction instead of N separate
// set_field_value round-trips.
use crate::db::Db;
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn bulk_set_field_values(
    state: State<'_, Db>,
    subcontractor_id: i64,
    values: HashMap<String, String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    for (field_name, value) in values {
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
    }
    Ok(())
}
