// CSV export (Milestone 4). Columns = a leading "Subcontractor" identifier
// followed by the user-selected AcroForm field names. Rows = subcontractors.
use crate::db::Db;
use rusqlite::params;
use std::collections::HashMap;
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Identifier column written first in every export, used to match rows back to
/// subcontractors on import.
pub const ID_COLUMN: &str = "Subcontractor";

/// Label for the first cell of the type-hint row.
const TYPE_ROW_LABEL: &str = "Field type";

/// Builds the project's CSV and writes it to `path`. Returns the number of
/// subcontractor rows written.
///
/// Layout: a type-hint row (text/checkbox/radio/dropdown per column), then the
/// `Subcontractor` + field-name header, then one data row per subcontractor.
#[tauri::command]
pub fn export_project_csv(
    app: tauri::AppHandle,
    state: State<'_, Db>,
    project_id: i64,
    fields: Vec<String>,
    path: String,
) -> Result<usize, String> {
    let field_types = crate::fieldmap::load_field_types(&app)?;
    let conn = state.0.lock().map_err(map_err)?;

    // Subcontractors in display order.
    let mut stmt = conn
        .prepare(
            "SELECT id, name FROM subcontractors WHERE project_id = ?1 ORDER BY ordering, id",
        )
        .map_err(map_err)?;
    let subs: Vec<(i64, String)> = stmt
        .query_map(params![project_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(map_err)?
        .collect::<Result<_, _>>()
        .map_err(map_err)?;

    let mut wtr = csv::Writer::from_path(&path).map_err(map_err)?;

    // Type-hint row (helper for the reader; skipped on import).
    let mut type_row: Vec<&str> = Vec::with_capacity(fields.len() + 1);
    type_row.push(TYPE_ROW_LABEL);
    for f in &fields {
        type_row.push(field_types.get(f).map(|s| s.as_str()).unwrap_or("text"));
    }
    wtr.write_record(&type_row).map_err(map_err)?;

    // Header: identifier column + selected field names.
    let mut header: Vec<&str> = Vec::with_capacity(fields.len() + 1);
    header.push(ID_COLUMN);
    header.extend(fields.iter().map(|s| s.as_str()));
    wtr.write_record(&header).map_err(map_err)?;

    // One row per subcontractor.
    let mut value_stmt = conn
        .prepare("SELECT field_name, value FROM field_values WHERE subcontractor_id = ?1")
        .map_err(map_err)?;

    for (sub_id, sub_name) in &subs {
        let mut values: HashMap<String, String> = HashMap::new();
        let rows = value_stmt
            .query_map(params![sub_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(map_err)?;
        for row in rows {
            let (name, val) = row.map_err(map_err)?;
            values.insert(name, val.unwrap_or_default());
        }

        let mut record: Vec<String> = Vec::with_capacity(fields.len() + 1);
        record.push(sub_name.clone());
        for f in &fields {
            record.push(values.get(f).cloned().unwrap_or_default());
        }
        wtr.write_record(&record).map_err(map_err)?;
    }

    wtr.flush().map_err(map_err)?;
    Ok(subs.len())
}
