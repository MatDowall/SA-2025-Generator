// Global per-project "Contract Info" answers. Ported from the desktop app;
// each fn takes a &Connection instead of a Tauri State. SQL is verbatim.
use rusqlite::{params, Connection};
use std::collections::HashMap;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn get_contract_info(
    conn: &Connection,
    project_id: i64,
) -> Result<HashMap<String, String>, String> {
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

pub fn set_contract_info_value(
    conn: &Connection,
    project_id: i64,
    field_key: String,
    value: String,
) -> Result<(), String> {
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

pub fn set_contract_info_bulk(
    conn: &Connection,
    project_id: i64,
    values: HashMap<String, String>,
) -> Result<(), String> {
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
