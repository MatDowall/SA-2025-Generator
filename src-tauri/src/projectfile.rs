// Project export/import (Milestone 7). A `.saproj` file is a self-contained,
// versioned JSON snapshot of a project — its details, subcontractors, and every
// field value — so a project round-trips with 100% data integrity.
use crate::db::Db;
use crate::projects::Project;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const FORMAT_TAG: &str = "saproj";
const FORMAT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct SaSubcontractor {
    name: String,
    ordering: i64,
    /// AcroForm field name -> value (BTreeMap keeps output stable/diffable).
    fields: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct SaProject {
    format: String,
    version: u32,
    exported_at: String,
    project_name: String,
    project_number: String,
    csv_export_selection: Option<Vec<String>>,
    subcontractors: Vec<SaSubcontractor>,
}

/// Writes the project as a `.saproj` snapshot to `path`.
#[tauri::command]
pub fn export_project_file(
    state: State<'_, Db>,
    project_id: i64,
    path: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;

    let (project_name, project_number, selection_json): (String, String, Option<String>) = conn
        .query_row(
            "SELECT name, project_number, csv_export_selection FROM projects WHERE id = ?1",
            params![project_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(map_err)?;

    let csv_export_selection: Option<Vec<String>> = match selection_json {
        Some(s) => serde_json::from_str(&s).ok(),
        None => None,
    };

    let mut sub_stmt = conn
        .prepare(
            "SELECT id, name, ordering FROM subcontractors WHERE project_id = ?1 ORDER BY ordering, id",
        )
        .map_err(map_err)?;
    let subs: Vec<(i64, String, i64)> = sub_stmt
        .query_map(params![project_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(map_err)?
        .collect::<Result<_, _>>()
        .map_err(map_err)?;

    let mut value_stmt = conn
        .prepare("SELECT field_name, value FROM field_values WHERE subcontractor_id = ?1")
        .map_err(map_err)?;

    let mut subcontractors = Vec::with_capacity(subs.len());
    for (sub_id, name, ordering) in subs {
        let mut fields = BTreeMap::new();
        let rows = value_stmt
            .query_map(params![sub_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(map_err)?;
        for row in rows {
            let (fname, val) = row.map_err(map_err)?;
            fields.insert(fname, val.unwrap_or_default());
        }
        subcontractors.push(SaSubcontractor {
            name,
            ordering,
            fields,
        });
    }

    let doc = SaProject {
        format: FORMAT_TAG.into(),
        version: FORMAT_VERSION,
        exported_at: chrono_now(&conn)?,
        project_name,
        project_number,
        csv_export_selection,
        subcontractors,
    };

    let json = serde_json::to_string_pretty(&doc).map_err(map_err)?;
    std::fs::write(&path, json).map_err(|e| format!("write {path}: {e}"))?;
    Ok(())
}

/// SQLite-provided timestamp (avoids pulling in a date crate).
fn chrono_now(conn: &rusqlite::Connection) -> Result<String, String> {
    conn.query_row("SELECT datetime('now')", [], |r| r.get::<_, String>(0))
        .map_err(map_err)
}

/// Imports a `.saproj` file as a NEW project. Returns the created project so the
/// frontend can open it.
#[tauri::command]
pub fn import_project_file(state: State<'_, Db>, path: String) -> Result<Project, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?;
    let doc: SaProject = serde_json::from_str(&raw)
        .map_err(|e| format!("Not a valid .saproj file: {e}"))?;
    if doc.format != FORMAT_TAG {
        return Err("Not a SA-2025 project file.".into());
    }

    let selection_json = match &doc.csv_export_selection {
        Some(v) => Some(serde_json::to_string(v).map_err(map_err)?),
        None => None,
    };

    let mut conn = state.0.lock().map_err(map_err)?;
    let tx = conn.transaction().map_err(map_err)?;

    tx.execute(
        "INSERT INTO projects (name, project_number, csv_export_selection) VALUES (?1, ?2, ?3)",
        params![doc.project_name, doc.project_number, selection_json],
    )
    .map_err(map_err)?;
    let project_id = tx.last_insert_rowid();

    for sub in &doc.subcontractors {
        tx.execute(
            "INSERT INTO subcontractors (project_id, name, ordering) VALUES (?1, ?2, ?3)",
            params![project_id, sub.name, sub.ordering],
        )
        .map_err(map_err)?;
        let sub_id = tx.last_insert_rowid();
        for (fname, value) in &sub.fields {
            if value.is_empty() {
                continue;
            }
            tx.execute(
                "INSERT INTO field_values (subcontractor_id, field_name, value) VALUES (?1, ?2, ?3)",
                params![sub_id, fname, value],
            )
            .map_err(map_err)?;
        }
    }

    tx.commit().map_err(map_err)?;

    Ok(Project {
        id: project_id,
        name: doc.project_name,
        project_number: doc.project_number,
    })
}
