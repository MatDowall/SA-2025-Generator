// Global (not project-scoped) subcontractor directory. Seeded once on first
// run from resources/tp-companies-seed.json (extracted from the legacy
// workbook's hidden "TP Companies" sheet); future work repopulates via API.
use crate::db::Db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Deserialize)]
pub struct TpCompany {
    #[serde(default)]
    pub id: i64,
    pub company: String,
    pub legal_name_register: Option<String>,
    pub nzbn: Option<String>,
    pub legal_name_nzbn: Option<String>,
    pub address_1: Option<String>,
    pub address_2: Option<String>,
    pub address_3: Option<String>,
    pub city: Option<String>,
    pub zip: Option<String>,
    pub full_address: Option<String>,
    pub business_phone: Option<String>,
    pub email: Option<String>,
    pub directors: Option<String>,
    pub trades: Option<String>,
    pub standard_cost_code: Option<String>,
    #[serde(default)]
    pub ordering: i64,
}

fn row_to_company(r: &rusqlite::Row) -> rusqlite::Result<TpCompany> {
    Ok(TpCompany {
        id: r.get(0)?,
        company: r.get(1)?,
        legal_name_register: r.get(2)?,
        nzbn: r.get(3)?,
        legal_name_nzbn: r.get(4)?,
        address_1: r.get(5)?,
        address_2: r.get(6)?,
        address_3: r.get(7)?,
        city: r.get(8)?,
        zip: r.get(9)?,
        full_address: r.get(10)?,
        business_phone: r.get(11)?,
        email: r.get(12)?,
        directors: r.get(13)?,
        trades: r.get(14)?,
        standard_cost_code: r.get(15)?,
        ordering: r.get(16)?,
    })
}

const SELECT_COLUMNS: &str = "id, company, legal_name_register, nzbn, legal_name_nzbn, \
     address_1, address_2, address_3, city, zip, full_address, business_phone, \
     email, directors, trades, standard_cost_code, ordering";

#[tauri::command]
pub fn list_tp_companies(state: State<'_, Db>) -> Result<Vec<TpCompany>, String> {
    let conn = state.0.lock().map_err(map_err)?;
    let sql = format!("SELECT {SELECT_COLUMNS} FROM tp_companies ORDER BY ordering, id");
    let mut stmt = conn.prepare(&sql).map_err(map_err)?;
    let rows = stmt.query_map([], row_to_company).map_err(map_err)?;
    rows.collect::<Result<_, _>>().map_err(map_err)
}

#[tauri::command]
pub fn upsert_tp_company(state: State<'_, Db>, company: TpCompany) -> Result<TpCompany, String> {
    let name = company.company.trim().to_string();
    if name.is_empty() {
        return Err("Company name is required.".into());
    }
    let conn = state.0.lock().map_err(map_err)?;
    if company.id == 0 {
        let ordering: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(ordering), -1) + 1 FROM tp_companies",
                [],
                |r| r.get(0),
            )
            .map_err(map_err)?;
        conn.execute(
            "INSERT INTO tp_companies (company, legal_name_register, nzbn, legal_name_nzbn, \
             address_1, address_2, address_3, city, zip, full_address, business_phone, \
             email, directors, trades, standard_cost_code, ordering) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                name,
                company.legal_name_register,
                company.nzbn,
                company.legal_name_nzbn,
                company.address_1,
                company.address_2,
                company.address_3,
                company.city,
                company.zip,
                company.full_address,
                company.business_phone,
                company.email,
                company.directors,
                company.trades,
                company.standard_cost_code,
                ordering,
            ],
        )
        .map_err(map_err)?;
        Ok(TpCompany {
            id: conn.last_insert_rowid(),
            ordering,
            company: name,
            ..company
        })
    } else {
        conn.execute(
            "UPDATE tp_companies SET company = ?1, legal_name_register = ?2, nzbn = ?3, \
             legal_name_nzbn = ?4, address_1 = ?5, address_2 = ?6, address_3 = ?7, city = ?8, \
             zip = ?9, full_address = ?10, business_phone = ?11, email = ?12, directors = ?13, \
             trades = ?14, standard_cost_code = ?15 WHERE id = ?16",
            params![
                name,
                company.legal_name_register,
                company.nzbn,
                company.legal_name_nzbn,
                company.address_1,
                company.address_2,
                company.address_3,
                company.city,
                company.zip,
                company.full_address,
                company.business_phone,
                company.email,
                company.directors,
                company.trades,
                company.standard_cost_code,
                company.id,
            ],
        )
        .map_err(map_err)?;
        Ok(TpCompany {
            company: name,
            ..company
        })
    }
}

/// Re-syncs `ordering` for every id to match its position in `ordered_ids`.
/// Called after any insert/save in the grid so a row typed into the middle
/// of the table (e.g. via "insert row above") keeps that position on reload,
/// instead of upsert_tp_company's insert path always appending to the end.
#[tauri::command]
pub fn reorder_tp_companies(state: State<'_, Db>, ordered_ids: Vec<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    for (i, id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE tp_companies SET ordering = ?1 WHERE id = ?2",
            params![i as i64, id],
        )
        .map_err(map_err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_tp_company(state: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(map_err)?;
    conn.execute("DELETE FROM tp_companies WHERE id = ?1", params![id])
        .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn seed_tp_companies(state: State<'_, Db>, companies: Vec<TpCompany>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(map_err)?;
    insert_seed(&conn, &companies).map_err(map_err)?;
    Ok(companies.len())
}

fn insert_seed(conn: &rusqlite::Connection, companies: &[TpCompany]) -> rusqlite::Result<()> {
    for (i, c) in companies.iter().enumerate() {
        conn.execute(
            "INSERT INTO tp_companies (company, legal_name_register, nzbn, legal_name_nzbn, \
             address_1, address_2, address_3, city, zip, full_address, business_phone, \
             email, directors, trades, standard_cost_code, ordering) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                c.company,
                c.legal_name_register,
                c.nzbn,
                c.legal_name_nzbn,
                c.address_1,
                c.address_2,
                c.address_3,
                c.city,
                c.zip,
                c.full_address,
                c.business_phone,
                c.email,
                c.directors,
                c.trades,
                c.standard_cost_code,
                i as i64,
            ],
        )?;
    }
    Ok(())
}

/// One-time seed from the bundled legacy-workbook export, if the table is
/// still empty (mirrors settings::seed_settings_if_empty).
pub fn seed_tp_companies_if_empty(conn: &rusqlite::Connection, seed_json: &str) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM tp_companies", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    let companies: Vec<TpCompany> = match serde_json::from_str(seed_json) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("tp_companies seed JSON parse failed: {e}");
            return Ok(());
        }
    };
    eprintln!("tp_companies seed: inserting {} companies", companies.len());
    insert_seed(conn, &companies)
}
