// HTTP API: each former Tauri command is exposed as `POST /api/{command}`,
// taking the same JSON arg object the desktop `invoke` sent and returning the
// same JSON result. Arg structs use camelCase (matching the JS call sites);
// void commands return JSON `null`.
//
// Projects are private to their creator: project- and subcontractor-scoped
// handlers read the caller's identity from the auth guard (Extension<User>) and
// verify ownership before touching the DB. The shared directories (tp_companies,
// staff, settings) and NZBN lookup are company-wide and not owner-scoped.
//
// Two resource reads can't ride the JSON envelope, so they are plain GETs:
//   GET /api/field-map    -> the raw field-map.json
//   GET /api/template-pdf -> the blank template PDF bytes
use crate::db::PooledConn;
use crate::state::AppState;
use crate::{
    audit, auth, compute, contract_info, export, grid_values, import, nzbn_api, projectfile,
    projects, settings, tp_companies,
};
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Json, State};
use axum::http::{header, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Extension, Router};
use serde::Deserialize;
use std::collections::HashMap;

type ApiError = (StatusCode, String);

/// Upload cap for CSV / .saproj bodies (PDFs and zips are downloads, never
/// uploaded). Generous so large project snapshots import fine.
const MAX_UPLOAD_BYTES: usize = 64 * 1024 * 1024;

/// A logic-layer `Err(String)` (validation or DB failure) becomes a 400 with the
/// message as the body - the frontend surfaces that text directly.
fn logic_err(e: String) -> ApiError {
    (StatusCode::BAD_REQUEST, e)
}

/// Ownership/authorization failure -> 403.
fn forbid(e: String) -> ApiError {
    (StatusCode::FORBIDDEN, e)
}

/// Infrastructure failures (couldn't get a pooled connection, read a resource).
fn infra_err<E: std::fmt::Display>(e: E) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn db(s: &AppState) -> Result<PooledConn, ApiError> {
    s.pool.get().map_err(infra_err)
}

pub fn api_router() -> Router<AppState> {
    Router::new()
        // resources
        .route("/api/field-map", get(get_field_map))
        .route("/api/template-pdf", get(get_template_pdf))
        // projects & subcontractors
        .route("/api/create_project", post(create_project))
        .route("/api/list_projects", post(list_projects))
        .route("/api/rename_project", post(rename_project))
        .route("/api/delete_project", post(delete_project))
        .route("/api/add_subcontractor", post(add_subcontractor))
        .route("/api/list_subcontractors", post(list_subcontractors))
        .route("/api/rename_subcontractor", post(rename_subcontractor))
        .route("/api/delete_subcontractor", post(delete_subcontractor))
        .route("/api/set_last_project", post(set_last_project))
        .route("/api/get_last_project", post(get_last_project))
        .route("/api/get_csv_selection", post(get_csv_selection))
        .route("/api/set_csv_selection", post(set_csv_selection))
        .route("/api/get_field_values", post(get_field_values))
        .route("/api/set_field_value", post(set_field_value))
        // contract info
        .route("/api/get_contract_info", post(get_contract_info))
        .route("/api/set_contract_info_value", post(set_contract_info_value))
        .route("/api/set_contract_info_bulk", post(set_contract_info_bulk))
        // settings & staff (company-wide)
        .route("/api/get_settings", post(get_settings))
        .route("/api/set_setting", post(set_setting))
        .route("/api/list_staff", post(list_staff))
        .route("/api/upsert_staff", post(upsert_staff))
        .route("/api/delete_staff", post(delete_staff))
        // TP companies (company-wide)
        .route("/api/list_tp_companies", post(list_tp_companies))
        .route("/api/upsert_tp_company", post(upsert_tp_company))
        .route("/api/delete_tp_company", post(delete_tp_company))
        .route("/api/reorder_tp_companies", post(reorder_tp_companies))
        // NZBN lookup (async, company-wide)
        .route("/api/search_nzbn_companies", post(search_nzbn_companies))
        .route("/api/apply_nzbn_match", post(apply_nzbn_match))
        .route("/api/bulk_check_tp_companies", post(bulk_check_tp_companies))
        // grid values
        .route("/api/get_grid_values", post(get_grid_values))
        .route("/api/set_grid_value", post(set_grid_value))
        .route("/api/get_grid_values_for_project", post(get_grid_values_for_project))
        .route("/api/bulk_set_grid_values", post(bulk_set_grid_values))
        // mapping recompute
        .route("/api/bulk_set_field_values", post(bulk_set_field_values))
        // audit
        .route("/api/get_audit_for_project", post(get_audit_for_project))
        .route("/api/set_audit", post(set_audit))
        // files (upload/download)
        .route("/api/export_project_csv", post(export_project_csv))
        .route("/api/export_project_file", post(export_project_file))
        .route("/api/analyze_import_csv", post(analyze_import_csv))
        .route("/api/parse_import_csv", post(parse_import_csv))
        .route("/api/import_project_file", post(import_project_file))
        // self-service password change (any signed-in user)
        .route("/api/change_password", post(auth::change_password))
        // user management (admin-only; enforced inside the handlers)
        .route("/api/list_users", post(auth::list_users))
        .route("/api/list_auth_events", post(auth::list_auth_events))
        .route("/api/create_user", post(auth::create_user))
        .route("/api/create_reset_link", post(auth::create_reset_link))
        .route("/api/delete_user", post(auth::delete_user))
        .route("/api/cleanup_database", post(auth::cleanup_database))
        // Any other /api/* path is a real 404 (JSON), never the SPA shell.
        .route("/api/{*rest}", any(api_not_found))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
}

async fn api_not_found() -> (StatusCode, String) {
    (StatusCode::NOT_FOUND, "Unknown API endpoint".to_string())
}

// ---- resources ----

async fn get_field_map(State(s): State<AppState>) -> Result<Response, ApiError> {
    let path = s.resources_dir.join("field-map.json");
    let body = std::fs::read_to_string(&path).map_err(infra_err)?;
    Ok(([(header::CONTENT_TYPE, "application/json")], body).into_response())
}

async fn get_template_pdf(State(s): State<AppState>) -> Result<Response, ApiError> {
    let path = s.resources_dir.join("SA-2025-Template.pdf");
    let bytes = std::fs::read(&path).map_err(infra_err)?;
    Ok(([(header::CONTENT_TYPE, "application/pdf")], bytes).into_response())
}

// ---- arg structs (camelCase to match the JS call sites) ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectArgs {
    name: String,
    project_number: String,
}
#[derive(Deserialize)]
struct IdArgs {
    id: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameProjectArgs {
    id: i64,
    name: String,
    project_number: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddSubArgs {
    project_id: i64,
    name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIdArgs {
    project_id: i64,
}
#[derive(Deserialize)]
struct RenameSubArgs {
    id: i64,
    name: String,
}
#[derive(Deserialize)]
struct SetLastProjectArgs {
    id: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCsvSelectionArgs {
    project_id: i64,
    fields: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubIdArgs {
    subcontractor_id: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetFieldValueArgs {
    subcontractor_id: i64,
    field_name: String,
    value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetContractInfoValueArgs {
    project_id: i64,
    field_key: String,
    value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetContractInfoBulkArgs {
    project_id: i64,
    values: HashMap<String, String>,
}
#[derive(Deserialize)]
struct SetSettingArgs {
    key: String,
    value: String,
}
#[derive(Deserialize)]
struct RoleArgs {
    role: String,
}
#[derive(Deserialize)]
struct StaffArgs {
    member: settings::StaffMember,
}
#[derive(Deserialize)]
struct CompanyArgs {
    company: tp_companies::TpCompany,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReorderArgs {
    ordered_ids: Vec<i64>,
}
#[derive(Deserialize)]
struct SearchNzbnArgs {
    query: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyNzbnArgs {
    company_id: i64,
    nzbn: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetGridValueArgs {
    subcontractor_id: i64,
    column_key: String,
    value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BulkValuesArgs {
    subcontractor_id: i64,
    values: HashMap<String, String>,
}
#[derive(Deserialize)]
struct SetAuditArgs {
    audit: audit::Audit,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportCsvArgs {
    project_id: i64,
    fields: Vec<String>,
}

// ---- handlers: projects & subcontractors (owner-scoped) ----

async fn create_project(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<CreateProjectArgs>,
) -> Result<Json<projects::Project>, ApiError> {
    projects::create_project(&*db(&s)?, user.id, a.name, a.project_number)
        .map(Json)
        .map_err(logic_err)
}

async fn list_projects(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
) -> Result<Json<Vec<projects::Project>>, ApiError> {
    projects::list_projects(&*db(&s)?, user.id)
        .map(Json)
        .map_err(logic_err)
}

async fn rename_project(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<RenameProjectArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.id, user.id).map_err(forbid)?;
    projects::rename_project(&conn, a.id, a.name, a.project_number)
        .map(Json)
        .map_err(logic_err)
}

async fn delete_project(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<IdArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.id, user.id).map_err(forbid)?;
    projects::delete_project(&conn, a.id).map(Json).map_err(logic_err)
}

async fn add_subcontractor(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<AddSubArgs>,
) -> Result<Json<projects::Subcontractor>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    projects::add_subcontractor(&conn, a.project_id, a.name)
        .map(Json)
        .map_err(logic_err)
}

async fn list_subcontractors(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<ProjectIdArgs>,
) -> Result<Json<Vec<projects::Subcontractor>>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    projects::list_subcontractors(&conn, a.project_id)
        .map(Json)
        .map_err(logic_err)
}

async fn rename_subcontractor(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<RenameSubArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.id, user.id).map_err(forbid)?;
    projects::rename_subcontractor(&conn, a.id, a.name)
        .map(Json)
        .map_err(logic_err)
}

async fn delete_subcontractor(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<IdArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.id, user.id).map_err(forbid)?;
    projects::delete_subcontractor(&conn, a.id)
        .map(Json)
        .map_err(logic_err)
}

async fn set_last_project(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SetLastProjectArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    if let Some(id) = a.id {
        projects::assert_project_owner(&conn, id, user.id).map_err(forbid)?;
    }
    projects::set_last_project(&conn, user.id, a.id)
        .map(Json)
        .map_err(logic_err)
}

async fn get_last_project(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
) -> Result<Json<Option<i64>>, ApiError> {
    projects::get_last_project(&*db(&s)?, user.id)
        .map(Json)
        .map_err(logic_err)
}

async fn get_csv_selection(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<ProjectIdArgs>,
) -> Result<Json<Option<Vec<String>>>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    projects::get_csv_selection(&conn, a.project_id)
        .map(Json)
        .map_err(logic_err)
}

async fn set_csv_selection(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SetCsvSelectionArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    projects::set_csv_selection(&conn, a.project_id, a.fields)
        .map(Json)
        .map_err(logic_err)
}

async fn get_field_values(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SubIdArgs>,
) -> Result<Json<HashMap<String, String>>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.subcontractor_id, user.id).map_err(forbid)?;
    projects::get_field_values(&conn, a.subcontractor_id)
        .map(Json)
        .map_err(logic_err)
}

async fn set_field_value(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SetFieldValueArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.subcontractor_id, user.id).map_err(forbid)?;
    projects::set_field_value(&conn, a.subcontractor_id, a.field_name, a.value)
        .map(Json)
        .map_err(logic_err)
}

// ---- handlers: contract info (owner-scoped) ----

async fn get_contract_info(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<ProjectIdArgs>,
) -> Result<Json<HashMap<String, String>>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    contract_info::get_contract_info(&conn, a.project_id)
        .map(Json)
        .map_err(logic_err)
}

async fn set_contract_info_value(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SetContractInfoValueArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    contract_info::set_contract_info_value(&conn, a.project_id, a.field_key, a.value)
        .map(Json)
        .map_err(logic_err)
}

async fn set_contract_info_bulk(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SetContractInfoBulkArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    contract_info::set_contract_info_bulk(&conn, a.project_id, a.values)
        .map(Json)
        .map_err(logic_err)
}

// ---- handlers: settings & staff (company-wide) ----

async fn get_settings(
    State(s): State<AppState>,
) -> Result<Json<HashMap<String, String>>, ApiError> {
    settings::get_settings(&*db(&s)?).map(Json).map_err(logic_err)
}

async fn set_setting(
    State(s): State<AppState>,
    Json(a): Json<SetSettingArgs>,
) -> Result<Json<()>, ApiError> {
    settings::set_setting(&*db(&s)?, a.key, a.value)
        .map(Json)
        .map_err(logic_err)
}

async fn list_staff(
    State(s): State<AppState>,
    Json(a): Json<RoleArgs>,
) -> Result<Json<Vec<settings::StaffMember>>, ApiError> {
    settings::list_staff(&*db(&s)?, a.role)
        .map(Json)
        .map_err(logic_err)
}

async fn upsert_staff(
    State(s): State<AppState>,
    Json(a): Json<StaffArgs>,
) -> Result<Json<settings::StaffMember>, ApiError> {
    settings::upsert_staff(&*db(&s)?, a.member)
        .map(Json)
        .map_err(logic_err)
}

async fn delete_staff(
    State(s): State<AppState>,
    Json(a): Json<IdArgs>,
) -> Result<Json<()>, ApiError> {
    settings::delete_staff(&*db(&s)?, a.id)
        .map(Json)
        .map_err(logic_err)
}

// ---- handlers: TP companies (company-wide) ----

async fn list_tp_companies(
    State(s): State<AppState>,
) -> Result<Json<Vec<tp_companies::TpCompany>>, ApiError> {
    tp_companies::list_tp_companies(&*db(&s)?)
        .map(Json)
        .map_err(logic_err)
}

async fn upsert_tp_company(
    State(s): State<AppState>,
    Json(a): Json<CompanyArgs>,
) -> Result<Json<tp_companies::TpCompany>, ApiError> {
    tp_companies::upsert_tp_company(&*db(&s)?, a.company)
        .map(Json)
        .map_err(logic_err)
}

async fn delete_tp_company(
    State(s): State<AppState>,
    Json(a): Json<IdArgs>,
) -> Result<Json<()>, ApiError> {
    tp_companies::delete_tp_company(&*db(&s)?, a.id)
        .map(Json)
        .map_err(logic_err)
}

async fn reorder_tp_companies(
    State(s): State<AppState>,
    Json(a): Json<ReorderArgs>,
) -> Result<Json<()>, ApiError> {
    tp_companies::reorder_tp_companies(&*db(&s)?, a.ordered_ids)
        .map(Json)
        .map_err(logic_err)
}

// ---- handlers: NZBN lookup (async, company-wide) ----

async fn search_nzbn_companies(
    State(s): State<AppState>,
    Json(a): Json<SearchNzbnArgs>,
) -> Result<Json<Vec<nzbn_api::NzbnSearchResult>>, ApiError> {
    nzbn_api::search_nzbn_companies(&s.pool, a.query)
        .await
        .map(Json)
        .map_err(logic_err)
}

async fn apply_nzbn_match(
    State(s): State<AppState>,
    Json(a): Json<ApplyNzbnArgs>,
) -> Result<Json<tp_companies::TpCompany>, ApiError> {
    nzbn_api::apply_nzbn_match(&s.pool, a.company_id, a.nzbn)
        .await
        .map(Json)
        .map_err(logic_err)
}

async fn bulk_check_tp_companies(
    State(s): State<AppState>,
) -> Result<Json<Vec<nzbn_api::BulkCheckResult>>, ApiError> {
    nzbn_api::bulk_check_tp_companies(&s.pool)
        .await
        .map(Json)
        .map_err(logic_err)
}

// ---- handlers: grid values (owner-scoped) ----

async fn get_grid_values(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SubIdArgs>,
) -> Result<Json<HashMap<String, String>>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.subcontractor_id, user.id).map_err(forbid)?;
    grid_values::get_grid_values(&conn, a.subcontractor_id)
        .map(Json)
        .map_err(logic_err)
}

async fn set_grid_value(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SetGridValueArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.subcontractor_id, user.id).map_err(forbid)?;
    grid_values::set_grid_value(&conn, a.subcontractor_id, a.column_key, a.value)
        .map(Json)
        .map_err(logic_err)
}

async fn get_grid_values_for_project(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<ProjectIdArgs>,
) -> Result<Json<HashMap<i64, HashMap<String, String>>>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    grid_values::get_grid_values_for_project(&conn, a.project_id)
        .map(Json)
        .map_err(logic_err)
}

async fn bulk_set_grid_values(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<BulkValuesArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.subcontractor_id, user.id).map_err(forbid)?;
    grid_values::bulk_set_grid_values(&conn, a.subcontractor_id, a.values)
        .map(Json)
        .map_err(logic_err)
}

// ---- handlers: mapping recompute (owner-scoped) ----

async fn bulk_set_field_values(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<BulkValuesArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.subcontractor_id, user.id).map_err(forbid)?;
    compute::bulk_set_field_values(&conn, a.subcontractor_id, a.values)
        .map(Json)
        .map_err(logic_err)
}

// ---- handlers: audit (owner-scoped) ----

async fn get_audit_for_project(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<ProjectIdArgs>,
) -> Result<Json<HashMap<i64, audit::Audit>>, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    audit::get_audit_for_project(&conn, a.project_id)
        .map(Json)
        .map_err(logic_err)
}

async fn set_audit(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<SetAuditArgs>,
) -> Result<Json<()>, ApiError> {
    let conn = db(&s)?;
    projects::assert_sub_owner(&conn, a.audit.subcontractor_id, user.id).map_err(forbid)?;
    audit::set_audit(&conn, a.audit).map(Json).map_err(logic_err)
}

// ---- handlers: files (upload/download, owner-scoped) ----

/// Builds the project CSV and returns it as a download. The row count rides an
/// `X-Row-Count` response header (the frontend shim reports it to the user).
async fn export_project_csv(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<ExportCsvArgs>,
) -> Result<Response, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    let (csv, rows) =
        export::export_project_csv(&conn, s.resources_dir.as_path(), a.project_id, a.fields)
            .map_err(logic_err)?;
    let mut resp = Response::new(Body::from(csv));
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("text/csv"));
    resp.headers_mut().insert(
        HeaderName::from_static("x-row-count"),
        HeaderValue::from_str(&rows.to_string()).unwrap_or(HeaderValue::from_static("0")),
    );
    Ok(resp)
}

/// Builds the project's `.saproj` snapshot and returns it as a download.
async fn export_project_file(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    Json(a): Json<ProjectIdArgs>,
) -> Result<Response, ApiError> {
    let conn = db(&s)?;
    projects::assert_project_owner(&conn, a.project_id, user.id).map_err(forbid)?;
    let json = projectfile::export_project_file(&conn, a.project_id).map_err(logic_err)?;
    let mut resp = Response::new(Body::from(json));
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    Ok(resp)
}

/// Dry-run analysis of an uploaded CSV (raw bytes in the request body). No DB
/// access, so no ownership check.
async fn analyze_import_csv(
    State(s): State<AppState>,
    body: Bytes,
) -> Result<Json<import::ImportReport>, ApiError> {
    import::analyze_import_csv(s.resources_dir.as_path(), &body)
        .map(Json)
        .map_err(logic_err)
}

/// Parses an uploaded CSV (raw bytes) into {columns, rows}. No DB access.
async fn parse_import_csv(body: Bytes) -> Result<Json<import::ParsedCsv>, ApiError> {
    import::parse_import_csv(&body).map(Json).map_err(logic_err)
}

/// Imports an uploaded `.saproj` file (raw bytes) as a new project owned by the
/// caller.
async fn import_project_file(
    State(s): State<AppState>,
    Extension(user): Extension<auth::User>,
    body: Bytes,
) -> Result<Json<projects::Project>, ApiError> {
    let mut c = db(&s)?;
    projectfile::import_project_file(&mut c, user.id, &body)
        .map(Json)
        .map_err(logic_err)
}
