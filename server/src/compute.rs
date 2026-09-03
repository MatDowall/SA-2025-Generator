// Persists the frontend Mapping-sheet recompute result ({field_name: value})
// in one transaction. Ported from the desktop app; takes a &Connection.
use rusqlite::{params, Connection};
use std::collections::HashMap;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn bulk_set_field_values(
    conn: &Connection,
    subcontractor_id: i64,
    values: HashMap<String, String>,
) -> Result<(), String> {
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
