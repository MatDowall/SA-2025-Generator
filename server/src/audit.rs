// Per-subcontractor send/return audit trail. Ported from the desktop app;
// each fn takes a &Connection. Logic is verbatim.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// One subcontractor's audit record. Dates are ISO strings (YYYY-MM-DD); any
/// field may be absent (None) when it hasn't been set.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Audit {
    pub subcontractor_id: i64,
    pub loa_sent_date: Option<String>,
    pub sa_sent_date: Option<String>,
    pub sa_returned_date: Option<String>,
    pub notes: Option<String>,
}

/// Blank strings coming from the frontend's date/textarea inputs are treated as
/// "unset" so an emptied field doesn't linger in the DB.
fn nz(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.trim().is_empty())
}

impl Audit {
    fn is_empty(&self) -> bool {
        self.loa_sent_date.is_none()
            && self.sa_sent_date.is_none()
            && self.sa_returned_date.is_none()
            && self.notes.is_none()
    }
}

pub fn get_audit_for_project(
    conn: &Connection,
    project_id: i64,
) -> Result<HashMap<i64, Audit>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT a.subcontractor_id, a.loa_sent_date, \
                    a.sa_sent_date, a.sa_returned_date, a.notes \
             FROM subcontractor_audit a \
             JOIN subcontractors s ON s.id = a.subcontractor_id \
             WHERE s.project_id = ?1",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![project_id], |r| {
            Ok(Audit {
                subcontractor_id: r.get(0)?,
                loa_sent_date: r.get(1)?,
                sa_sent_date: r.get(2)?,
                sa_returned_date: r.get(3)?,
                notes: r.get(4)?,
            })
        })
        .map_err(map_err)?;
    let mut result = HashMap::new();
    for row in rows {
        let a = row.map_err(map_err)?;
        result.insert(a.subcontractor_id, a);
    }
    Ok(result)
}

pub fn set_audit(conn: &Connection, audit: Audit) -> Result<(), String> {
    let audit = Audit {
        subcontractor_id: audit.subcontractor_id,
        loa_sent_date: nz(audit.loa_sent_date),
        sa_sent_date: nz(audit.sa_sent_date),
        sa_returned_date: nz(audit.sa_returned_date),
        notes: nz(audit.notes),
    };
    if audit.is_empty() {
        conn.execute(
            "DELETE FROM subcontractor_audit WHERE subcontractor_id = ?1",
            params![audit.subcontractor_id],
        )
        .map_err(map_err)?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO subcontractor_audit \
           (subcontractor_id, loa_sent_date, sa_sent_date, sa_returned_date, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(subcontractor_id) DO UPDATE SET \
           loa_sent_date = excluded.loa_sent_date, \
           sa_sent_date = excluded.sa_sent_date, \
           sa_returned_date = excluded.sa_returned_date, \
           notes = excluded.notes",
        params![
            audit.subcontractor_id,
            audit.loa_sent_date,
            audit.sa_sent_date,
            audit.sa_returned_date,
            audit.notes,
        ],
    )
    .map_err(map_err)?;
    Ok(())
}
