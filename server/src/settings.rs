// Global app settings + PM/BTM/QS staff directories. Ported from the desktop
// app; each fn takes a &Connection. Seeded once on first run from
// resources/settings-seed.json (see seed_settings_if_empty, called at startup).
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Deserialize)]
pub struct StaffMember {
    pub id: i64,
    pub role: String,
    pub name: String,
    pub mobile: Option<String>,
    pub email: Option<String>,
    pub ordering: i64,
    /// Base64 PNG data URL of the member's signature, used on Letters of Award.
    #[serde(default)]
    pub signature_png: Option<String>,
}

pub fn get_settings(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(map_err)?;
    let rows = stmt
        .query_map([], |r| {
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

pub fn set_setting(conn: &Connection, key: String, value: String) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(map_err)?;
    Ok(())
}

pub fn list_staff(conn: &Connection, role: String) -> Result<Vec<StaffMember>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, role, name, mobile, email, ordering, signature_png FROM staff_directory \
             WHERE role = ?1 ORDER BY ordering, id",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![role], |r| {
            Ok(StaffMember {
                id: r.get(0)?,
                role: r.get(1)?,
                name: r.get(2)?,
                mobile: r.get(3)?,
                email: r.get(4)?,
                ordering: r.get(5)?,
                signature_png: r.get(6)?,
            })
        })
        .map_err(map_err)?;
    rows.collect::<Result<_, _>>().map_err(map_err)
}

pub fn upsert_staff(conn: &Connection, member: StaffMember) -> Result<StaffMember, String> {
    let name = member.name.trim().to_string();
    if name.is_empty() {
        return Err("Staff member name is required.".into());
    }
    if member.id == 0 {
        let ordering: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(ordering), -1) + 1 FROM staff_directory WHERE role = ?1",
                params![member.role],
                |r| r.get(0),
            )
            .map_err(map_err)?;
        conn.execute(
            "INSERT INTO staff_directory (role, name, mobile, email, ordering, signature_png) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![member.role, name, member.mobile, member.email, ordering, member.signature_png],
        )
        .map_err(map_err)?;
        Ok(StaffMember {
            id: conn.last_insert_rowid(),
            ordering,
            name,
            ..member
        })
    } else {
        conn.execute(
            "UPDATE staff_directory SET name = ?1, mobile = ?2, email = ?3, signature_png = ?4 WHERE id = ?5",
            params![name, member.mobile, member.email, member.signature_png, member.id],
        )
        .map_err(map_err)?;
        Ok(StaffMember { name, ..member })
    }
}

pub fn delete_staff(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM staff_directory WHERE id = ?1", params![id])
        .map_err(map_err)?;
    Ok(())
}

// --- one-time startup seeding from resources/settings-seed.json ---

#[derive(Deserialize)]
struct SeedStaffMember {
    name: String,
    mobile: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
struct SeedFile {
    scalars: HashMap<String, String>,
    lists: HashMap<String, Vec<String>>,
    staff: HashMap<String, Vec<SeedStaffMember>>,
}

pub fn seed_settings_if_empty(conn: &Connection, seed_json: &str) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    let seed: SeedFile = match serde_json::from_str(seed_json) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("settings seed JSON parse failed: {e}");
            return Ok(());
        }
    };
    for (key, value) in seed.scalars {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
    }
    for (key, list) in seed.lists {
        let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params![key, json],
        )?;
    }
    for (role, members) in seed.staff {
        for (i, m) in members.into_iter().enumerate() {
            conn.execute(
                "INSERT INTO staff_directory (role, name, mobile, email, ordering) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![role, m.name, m.mobile, m.email, i as i64],
            )?;
        }
    }
    Ok(())
}
