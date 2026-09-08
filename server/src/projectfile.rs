// Project export/import. A `.saproj` file is a self-contained, versioned JSON
// snapshot of a project. Ported from the desktop app; export returns the JSON
// text (server streams it as a download) and import reads uploaded bytes.
use crate::projects::Project;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const FORMAT_TAG: &str = "saproj";
const FORMAT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Default)]
struct SaAudit {
    loa_sent_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fa_sent_date: Option<String>,
    sa_sent_date: Option<String>,
    sa_returned_date: Option<String>,
    notes: Option<String>,
}

impl SaAudit {
    fn is_empty(&self) -> bool {
        self.loa_sent_date.is_none()
            && self.fa_sent_date.is_none()
            && self.sa_sent_date.is_none()
            && self.sa_returned_date.is_none()
            && self.notes.is_none()
    }
}

#[derive(Serialize, Deserialize)]
struct SaSubcontractor {
    name: String,
    ordering: i64,
    fields: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    audit: Option<SaAudit>,
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

/// Builds the project's `.saproj` JSON snapshot as a string.
pub fn export_project_file(conn: &Connection, project_id: i64) -> Result<String, String> {
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

    let mut audit_stmt = conn
        .prepare(
            "SELECT loa_sent_date, fa_sent_date, sa_sent_date, sa_returned_date, notes \
             FROM subcontractor_audit WHERE subcontractor_id = ?1",
        )
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
        let audit = audit_stmt
            .query_row(params![sub_id], |r| {
                Ok(SaAudit {
                    loa_sent_date: r.get(0)?,
                    fa_sent_date: r.get(1)?,
                    sa_sent_date: r.get(2)?,
                    sa_returned_date: r.get(3)?,
                    notes: r.get(4)?,
                })
            })
            .ok()
            .filter(|a: &SaAudit| !a.is_empty());
        subcontractors.push(SaSubcontractor {
            name,
            ordering,
            fields,
            audit,
        });
    }

    let doc = SaProject {
        format: FORMAT_TAG.into(),
        version: FORMAT_VERSION,
        exported_at: chrono_now(conn)?,
        project_name,
        project_number,
        csv_export_selection,
        subcontractors,
    };

    serde_json::to_string_pretty(&doc).map_err(map_err)
}

/// SQLite-provided timestamp (avoids pulling in a date crate).
fn chrono_now(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT datetime('now')", [], |r| r.get::<_, String>(0))
        .map_err(map_err)
}

/// Imports a `.saproj` file (uploaded bytes) as a NEW project. Returns the
/// created project so the frontend can open it.
pub fn import_project_file(
    conn: &mut Connection,
    owner_user_id: i64,
    bytes: &[u8],
) -> Result<Project, String> {
    let raw = std::str::from_utf8(bytes).map_err(|e| format!("Not a valid .saproj file: {e}"))?;
    let doc: SaProject =
        serde_json::from_str(raw).map_err(|e| format!("Not a valid .saproj file: {e}"))?;
    if doc.format != FORMAT_TAG {
        return Err("Not a SA-2025 project file.".into());
    }

    let selection_json = match &doc.csv_export_selection {
        Some(v) => Some(serde_json::to_string(v).map_err(map_err)?),
        None => None,
    };

    let tx = conn.transaction().map_err(map_err)?;

    tx.execute(
        "INSERT INTO projects (name, project_number, csv_export_selection, owner_user_id) \
         VALUES (?1, ?2, ?3, ?4)",
        params![doc.project_name, doc.project_number, selection_json, owner_user_id],
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
        if let Some(a) = sub.audit.as_ref().filter(|a| !a.is_empty()) {
            tx.execute(
                "INSERT INTO subcontractor_audit \
                   (subcontractor_id, loa_sent_date, fa_sent_date, sa_sent_date, sa_returned_date, notes) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    sub_id,
                    a.loa_sent_date,
                    a.fa_sent_date,
                    a.sa_sent_date,
                    a.sa_returned_date,
                    a.notes,
                ],
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
