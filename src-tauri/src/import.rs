// CSV import (Milestone 5). Reads a CSV whose first column identifies the
// subcontractor and whose remaining columns are AcroForm field names. Rows are
// matched to existing subcontractors by name (created if missing); recognised
// field columns are written to field_values.
//
// The header is located by scanning for the `Subcontractor` row, so an optional
// type-hint row above it (written by export) is skipped, and older files
// without that row still import.
use crate::db::Db;
use crate::export::ID_COLUMN;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashSet;
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn valid_field_names(app: &tauri::AppHandle) -> Result<HashSet<String>, String> {
    Ok(crate::fieldmap::load_field_types(app)?
        .into_keys()
        .collect())
}

/// Reads the file as text, tolerating non-UTF-8 encodings. Strips a UTF-8 BOM
/// and falls back to Windows-1252 (what Excel commonly writes) rather than
/// failing on bytes like curly quotes, en-dashes or ™.
fn read_text(path: &str) -> Result<String, String> {
    let mut bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        bytes.drain(0..3);
    }
    match String::from_utf8(bytes) {
        Ok(s) => Ok(s),
        Err(e) => {
            let bytes = e.into_bytes();
            let (text, _, _) = encoding_rs::WINDOWS_1252.decode(&bytes);
            Ok(text.into_owned())
        }
    }
}

/// Reads all rows verbatim (no implicit header handling).
fn read_records(path: &str) -> Result<Vec<csv::StringRecord>, String> {
    let text = read_text(path)?;
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut out = Vec::new();
    for r in rdr.records() {
        out.push(r.map_err(map_err)?);
    }
    Ok(out)
}

/// Index of the header row (first cell == ID_COLUMN), if present.
fn find_header(records: &[csv::StringRecord]) -> Option<usize> {
    records
        .iter()
        .position(|r| r.get(0).map(|c| c.trim() == ID_COLUMN).unwrap_or(false))
}

#[derive(Serialize)]
pub struct ImportReport {
    pub columns: Vec<String>,
    pub recognised: Vec<String>,
    pub unknown: Vec<String>,
    pub has_id_column: bool,
    pub row_count: usize,
}

/// Dry run: validate the CSV's columns and count rows without writing anything.
#[tauri::command]
pub fn analyze_import_csv(app: tauri::AppHandle, path: String) -> Result<ImportReport, String> {
    let valid = valid_field_names(&app)?;
    let records = read_records(&path)?;
    let header_idx = find_header(&records);

    let columns: Vec<String> = match header_idx {
        Some(i) => records[i].iter().map(|s| s.to_string()).collect(),
        None => records
            .first()
            .map(|r| r.iter().map(|s| s.to_string()).collect())
            .unwrap_or_default(),
    };

    let mut recognised = Vec::new();
    let mut unknown = Vec::new();
    if header_idx.is_some() {
        for c in columns.iter().skip(1) {
            if valid.contains(c) {
                recognised.push(c.clone());
            } else {
                unknown.push(c.clone());
            }
        }
    }

    let row_count = match header_idx {
        Some(i) => records[i + 1..]
            .iter()
            .filter(|r| r.get(0).map(|c| !c.trim().is_empty()).unwrap_or(false))
            .count(),
        None => 0,
    };

    Ok(ImportReport {
        columns,
        recognised,
        unknown,
        has_id_column: header_idx.is_some(),
        row_count,
    })
}

#[derive(Serialize)]
pub struct ImportResult {
    pub created: usize,
    pub updated: usize,
    pub fields_set: usize,
    pub unknown_columns: Vec<String>,
}

/// Commit the import into `project_id`. Rows matched to existing subcontractors
/// (by name, case-insensitive) are updated; otherwise a new subcontractor is
/// created. Only recognised field columns are written.
#[tauri::command]
pub fn import_project_csv(
    app: tauri::AppHandle,
    state: State<'_, Db>,
    project_id: i64,
    path: String,
) -> Result<ImportResult, String> {
    let valid = valid_field_names(&app)?;
    let records = read_records(&path)?;
    let header_idx = find_header(&records).ok_or_else(|| {
        format!("No \"{ID_COLUMN}\" header column found — this doesn't look like a SA-2025 export.")
    })?;
    let header = &records[header_idx];

    // Columns that map to real fields (skip column 0 = identifier).
    let field_cols: Vec<(usize, String)> = header
        .iter()
        .enumerate()
        .skip(1)
        .filter(|(_, name)| valid.contains(*name))
        .map(|(i, name)| (i, name.to_string()))
        .collect();
    let unknown_columns: Vec<String> = header
        .iter()
        .skip(1)
        .filter(|name| !valid.contains(*name))
        .map(|s| s.to_string())
        .collect();

    let mut conn = state.0.lock().map_err(map_err)?;
    let tx = conn.transaction().map_err(map_err)?;

    let mut created = 0usize;
    let mut updated = 0usize;
    let mut fields_set = 0usize;

    for record in &records[header_idx + 1..] {
        let sub_name = record.get(0).unwrap_or("").trim().to_string();
        if sub_name.is_empty() {
            continue;
        }

        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM subcontractors WHERE project_id = ?1 \
                 AND name = ?2 COLLATE NOCASE",
                params![project_id, sub_name],
                |r| r.get(0),
            )
            .ok();

        let sub_id = match existing {
            Some(id) => {
                updated += 1;
                id
            }
            None => {
                let ordering: i64 = tx
                    .query_row(
                        "SELECT COALESCE(MAX(ordering), -1) + 1 FROM subcontractors WHERE project_id = ?1",
                        params![project_id],
                        |r| r.get(0),
                    )
                    .map_err(map_err)?;
                tx.execute(
                    "INSERT INTO subcontractors (project_id, name, ordering) VALUES (?1, ?2, ?3)",
                    params![project_id, sub_name, ordering],
                )
                .map_err(map_err)?;
                created += 1;
                tx.last_insert_rowid()
            }
        };

        for (col_idx, field_name) in &field_cols {
            let value = record.get(*col_idx).unwrap_or("").to_string();
            if value.is_empty() {
                tx.execute(
                    "DELETE FROM field_values WHERE subcontractor_id = ?1 AND field_name = ?2",
                    params![sub_id, field_name],
                )
                .map_err(map_err)?;
            } else {
                tx.execute(
                    "INSERT INTO field_values (subcontractor_id, field_name, value) VALUES (?1, ?2, ?3) \
                     ON CONFLICT(subcontractor_id, field_name) DO UPDATE SET value = excluded.value",
                    params![sub_id, field_name, value],
                )
                .map_err(map_err)?;
                fields_set += 1;
            }
        }
    }

    tx.commit().map_err(map_err)?;

    Ok(ImportResult {
        created,
        updated,
        fields_set,
        unknown_columns,
    })
}
