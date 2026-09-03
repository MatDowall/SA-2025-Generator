// Integration with MBIE's NZBN API (api.business.govt.nz). Ported from the
// desktop app. The desktop passed a Tauri `State<Db>`; here each fn takes the
// r2d2 `Pool` so it can grab a short-lived connection before/after the async
// HTTP calls without holding one across an `.await`.
//
// The API key + environment are read from the server environment
// (`NZBN_API_KEY` / `NZBN_ENV`) - the secret stays out of the shared DB and out
// of the browser, and there is no per-user Settings entry for it.
use crate::db::Pool;
use crate::tp_companies::{get_company_by_id, TpCompany};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Grabs a pooled connection (used at each sync DB step).
fn conn(pool: &Pool) -> Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>, String> {
    pool.get().map_err(map_err)
}

fn base_url(env: &str) -> &'static str {
    if env == "production" {
        "https://api.business.govt.nz/gateway/nzbn/v5"
    } else {
        "https://api.business.govt.nz/sandbox/nzbn/v5"
    }
}

fn get_api_config() -> Result<(String, String), String> {
    // The key + environment come from the server environment only - the secret
    // stays out of the shared DB and out of the browser.
    let key = std::env::var("NZBN_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            "NZ Companies Register API key not configured on the server (set NZBN_API_KEY)."
                .to_string()
        })?;
    let env = std::env::var("NZBN_ENV")
        .ok()
        .filter(|e| !e.trim().is_empty())
        .unwrap_or_else(|| "sandbox".to_string());
    Ok((key, env))
}

fn auth_get(client: &reqwest::Client, url: &str, key: &str) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header("Ocp-Apim-Subscription-Key", key)
        .header("Accept", "application/json")
}

async fn get_json(req: reqwest::RequestBuilder) -> Result<Value, String> {
    let resp = req.send().await.map_err(map_err)?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("NZBN API error {status}: {body}"));
    }
    resp.json().await.map_err(map_err)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct NzbnSearchResult {
    pub nzbn: String,
    pub name: String,
    pub status: Option<String>,
}

fn str_at(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub async fn search_nzbn_companies(
    _pool: &Pool,
    query: String,
) -> Result<Vec<NzbnSearchResult>, String> {
    let (key, env) = get_api_config()?;
    let url = format!("{}/entities", base_url(&env));
    let client = reqwest::Client::new();
    let req = auth_get(&client, &url, &key)
        .query(&[("search-term", query.as_str()), ("page-size", "10")]);
    let body = get_json(req).await?;
    let items = body
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let results = items
        .iter()
        .filter_map(|item| {
            let nzbn = str_at(item, "nzbn")?;
            let name = str_at(item, "entityName")?;
            let status =
                str_at(item, "entityStatusDescription").or_else(|| str_at(item, "entityStatusCode"));
            Some(NzbnSearchResult { nzbn, name, status })
        })
        .collect();
    Ok(results)
}

fn derive_is_active(status: &Option<String>) -> Option<i64> {
    let s = status.as_deref()?;
    Some(if s.eq_ignore_ascii_case("registered") {
        1
    } else {
        0
    })
}

fn build_full_address(parts: [&Option<String>; 5]) -> Option<String> {
    let joined: Vec<&str> = parts
        .into_iter()
        .filter_map(|p| p.as_deref())
        .filter(|s| !s.is_empty())
        .collect();
    if joined.is_empty() {
        None
    } else {
        Some(joined.join(", "))
    }
}

fn person_name(p: &Value) -> Option<String> {
    let parts: Vec<String> = [
        str_at(p, "title"),
        str_at(p, "firstName"),
        str_at(p, "middleNames"),
        str_at(p, "lastName"),
    ]
    .into_iter()
    .flatten()
    .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

fn pick_address(
    detail: &Value,
) -> Option<(Option<String>, Option<String>, Option<String>, Option<String>)> {
    let list = detail.get("addresses")?.get("addressList")?.as_array()?;
    let chosen = list
        .iter()
        .find(|a| str_at(a, "addressType").as_deref() == Some("REGISTERED"))
        .or_else(|| list.first())?;
    Some((
        str_at(chosen, "address1"),
        str_at(chosen, "address2"),
        str_at(chosen, "address3"),
        str_at(chosen, "postCode"),
    ))
}

struct EntityDetail {
    name: Option<String>,
    nzbn: Option<String>,
    status: Option<String>,
    address_1: Option<String>,
    address_2: Option<String>,
    address_3: Option<String>,
    zip: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    directors: Option<String>,
}

async fn fetch_entity_detail(env: &str, key: &str, nzbn: &str) -> Result<EntityDetail, String> {
    let client = reqwest::Client::new();
    let detail_url = format!("{}/entities/{}", base_url(env), nzbn);
    let v = get_json(auth_get(&client, &detail_url, key)).await?;

    let name = str_at(&v, "entityName");
    let nzbn_val = str_at(&v, "nzbn");
    let status =
        str_at(&v, "entityStatusDescription").or_else(|| str_at(&v, "entityStatusCode"));

    let (address_1, address_2, address_3, zip) =
        pick_address(&v).unwrap_or((None, None, None, None));

    let phone = v
        .get("phoneNumbers")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|p| str_at(p, "phoneNumber"));
    let email = v
        .get("emailAddresses")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|e| str_at(e, "emailAddress"));

    let roles_url = format!("{}/entities/{}/roles", base_url(env), nzbn);
    let directors = match get_json(auth_get(&client, &roles_url, key)).await {
        Ok(roles) => {
            let names: Vec<String> = roles
                .as_array()
                .into_iter()
                .flatten()
                .filter(|r| str_at(r, "roleType").as_deref() == Some("Director"))
                .filter_map(|r| r.get("rolePerson").and_then(person_name))
                .collect();
            if names.is_empty() {
                None
            } else {
                Some(names.join("; "))
            }
        }
        Err(_) => None,
    };

    Ok(EntityDetail {
        name,
        nzbn: nzbn_val,
        status,
        address_1,
        address_2,
        address_3,
        zip,
        phone,
        email,
        directors,
    })
}

pub async fn apply_nzbn_match(
    pool: &Pool,
    company_id: i64,
    nzbn: String,
) -> Result<TpCompany, String> {
    let (key, env) = get_api_config()?;
    let detail = fetch_entity_detail(&env, &key, &nzbn).await?;

    let c = conn(pool)?;
    let mut existing = get_company_by_id(&c, company_id)?;

    if let Some(name) = &detail.name {
        existing.legal_name_register = Some(name.clone());
        existing.legal_name_nzbn = Some(name.clone());
    }
    if detail.nzbn.is_some() {
        existing.nzbn = detail.nzbn.clone();
    }
    if detail.address_1.is_some() {
        existing.address_1 = detail.address_1.clone();
    }
    if detail.address_2.is_some() {
        existing.address_2 = detail.address_2.clone();
    }
    if detail.address_3.is_some() {
        existing.address_3 = detail.address_3.clone();
    }
    if detail.zip.is_some() {
        existing.zip = detail.zip.clone();
    }
    if detail.phone.is_some() {
        existing.business_phone = detail.phone.clone();
    }
    if detail.email.is_some() {
        existing.email = detail.email.clone();
    }
    if detail.directors.is_some() {
        existing.directors = detail.directors.clone();
    }
    existing.full_address = build_full_address([
        &existing.address_1,
        &existing.address_2,
        &existing.address_3,
        &existing.city,
        &existing.zip,
    ])
    .or(existing.full_address.clone());
    existing.is_active = derive_is_active(&detail.status);
    existing.match_status = Some("matched".to_string());

    c.execute(
        "UPDATE tp_companies SET legal_name_register = ?1, nzbn = ?2, legal_name_nzbn = ?3, \
         address_1 = ?4, address_2 = ?5, address_3 = ?6, zip = ?7, full_address = ?8, \
         business_phone = ?9, email = ?10, directors = ?11, is_active = ?12, match_status = ?13 \
         WHERE id = ?14",
        params![
            existing.legal_name_register,
            existing.nzbn,
            existing.legal_name_nzbn,
            existing.address_1,
            existing.address_2,
            existing.address_3,
            existing.zip,
            existing.full_address,
            existing.business_phone,
            existing.email,
            existing.directors,
            existing.is_active,
            existing.match_status,
            company_id,
        ],
    )
    .map_err(map_err)?;

    Ok(existing)
}

fn normalize(s: &str) -> String {
    s.trim().to_lowercase()
}

fn set_match_status(pool: &Pool, id: i64, status: &str) -> Result<(), String> {
    let c = conn(pool)?;
    c.execute(
        "UPDATE tp_companies SET match_status = ?1 WHERE id = ?2",
        params![status, id],
    )
    .map_err(map_err)?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BulkCheckResult {
    pub id: i64,
    pub company: String,
    pub outcome: String,
    pub candidates: Vec<NzbnSearchResult>,
    pub message: Option<String>,
}

pub async fn bulk_check_tp_companies(pool: &Pool) -> Result<Vec<BulkCheckResult>, String> {
    let companies = {
        let c = conn(pool)?;
        crate::tp_companies::list_tp_companies(&c)?
    };
    let mut out = Vec::new();

    for company in companies {
        let search_name = company
            .legal_name_register
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string();
        if search_name.is_empty() {
            continue;
        }
        let display_name = company.company.trim().to_string();
        match search_nzbn_companies(pool, search_name.clone()).await {
            Ok(results) => {
                let exact: Vec<&NzbnSearchResult> = results
                    .iter()
                    .filter(|r| normalize(&r.name) == normalize(&search_name))
                    .collect();
                if results.is_empty() {
                    let _ = set_match_status(pool, company.id, "not_found");
                    out.push(BulkCheckResult {
                        id: company.id,
                        company: display_name,
                        outcome: "not_found".to_string(),
                        candidates: vec![],
                        message: None,
                    });
                } else if exact.len() == 1 {
                    let nzbn = exact[0].nzbn.clone();
                    match apply_nzbn_match(pool, company.id, nzbn).await {
                        Ok(_) => out.push(BulkCheckResult {
                            id: company.id,
                            company: display_name,
                            outcome: "matched".to_string(),
                            candidates: vec![],
                            message: None,
                        }),
                        Err(e) => {
                            let _ = set_match_status(pool, company.id, "error");
                            out.push(BulkCheckResult {
                                id: company.id,
                                company: display_name,
                                outcome: "error".to_string(),
                                candidates: vec![],
                                message: Some(e),
                            });
                        }
                    }
                } else {
                    let _ = set_match_status(pool, company.id, "ambiguous");
                    out.push(BulkCheckResult {
                        id: company.id,
                        company: display_name,
                        outcome: "ambiguous".to_string(),
                        candidates: results,
                        message: None,
                    });
                }
            }
            Err(e) => {
                let _ = set_match_status(pool, company.id, "error");
                out.push(BulkCheckResult {
                    id: company.id,
                    company: display_name,
                    outcome: "error".to_string(),
                    candidates: vec![],
                    message: Some(e),
                });
            }
        }
    }

    Ok(out)
}
