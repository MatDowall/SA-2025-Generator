// Per-subcontractor "Subcontractor Details" grid columns. Ported from the
// desktop app; each fn takes a &Connection. SQL is verbatim.
use rusqlite::{params, Connection};
use std::collections::HashMap;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn get_grid_values(
    conn: &Connection,
    subcontractor_id: i64,
) -> Result<HashMap<String, String>, String> {
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

pub fn set_grid_value(
    conn: &Connection,
    subcontractor_id: i64,
    column_key: String,
    value: String,
) -> Result<(), String> {
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

pub fn bulk_set_grid_values(
    conn: &Connection,
    subcontractor_id: i64,
    values: HashMap<String, String>,
) -> Result<(), String> {
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

pub fn get_grid_values_for_project(
    conn: &Connection,
    project_id: i64,
) -> Result<HashMap<i64, HashMap<String, String>>, String> {
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
