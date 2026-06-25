// CSV import. Reads a CSV whose first column identifies the subcontractor and
// whose remaining columns are AcroForm field names. Parsing only happens
// here (analyze_import_csv for the preview, parse_import_csv for the actual
// commit) — the frontend's CSV reverse-map (src/lib/csvReverseMap.ts) does
// subcontractor matching/creation and writes into subcontractor_grid_values /
// contract_info_values, since those are now the single source of truth
// field_values is computed from (see useMappingRecompute). This file no
// longer writes to field_values directly.
//
// The header is located by scanning for the `Subcontractor` row, so an optional
// type-hint row above it (written by export) is skipped, and older files
// without that row still import.
use crate::export::ID_COLUMN;
use serde::Serialize;
use std::collections::HashSet;

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
pub struct ParsedCsv {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// Parses the CSV into raw {columns, rows} with no DB writes at all — the
/// frontend's CSV reverse-map (see src/lib/csvReverseMap.ts) does the actual
/// subcontractor matching/creation and reverse-mapped writes into
/// subcontractor_grid_values / contract_info_values, since the grid + Contract
/// Info are now the single source of truth field_values is computed from
/// (see useMappingRecompute) — CSV import is just another way to fill those
/// in, not a parallel writer of field_values.
#[tauri::command]
pub fn parse_import_csv(path: String) -> Result<ParsedCsv, String> {
    let records = read_records(&path)?;
    let header_idx = find_header(&records).ok_or_else(|| {
        format!("No \"{ID_COLUMN}\" header column found — this doesn't look like a SA-2025 export.")
    })?;
    let columns: Vec<String> = records[header_idx].iter().map(|s| s.to_string()).collect();
    let rows: Vec<Vec<String>> = records[header_idx + 1..]
        .iter()
        .filter(|r| r.get(0).map(|c| !c.trim().is_empty()).unwrap_or(false))
        .map(|r| r.iter().map(|s| s.to_string()).collect())
        .collect();
    Ok(ParsedCsv { columns, rows })
}

