mod compute;
mod contract_info;
mod db;
mod export;
mod fieldmap;
mod files;
mod grid_values;
mod import;
mod nzbn_api;
mod projectfile;
mod projects;
mod settings;
mod tp_companies;

use db::Db;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Finds a `.saproj` path among launch args (skips the exe path itself).
fn find_saproj_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".saproj"))
}

/// Returns the `.saproj` path passed on the command line at cold start, if any
/// (double-clicking a `.saproj` file launches the app with it as an argument).
#[tauri::command]
fn get_launch_file() -> Option<String> {
    find_saproj_arg(std::env::args())
}

/// Loads the bundled field-map.json (generated from the template PDF — the
/// single source of truth for AcroForm field names). Returned as a raw JSON
/// string so the frontend can parse it directly.
#[tauri::command]
fn get_field_map(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .resolve(
            "resources/field-map.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve field-map.json: {e}"))?;
    std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))
}

/// Returns the bundled blank template PDF as raw bytes (efficient binary IPC —
/// the frontend receives an ArrayBuffer and hands it to pdf.js).
#[tauri::command]
fn get_template_pdf(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = app
        .path()
        .resolve(
            "resources/SA-2025-Template.pdf",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve template: {e}"))?;
    let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Milestone-0 smoke check: confirms the database opened and the schema exists.
#[tauri::command]
fn db_health(state: tauri::State<'_, Db>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let table_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('projects','subcontractors','field_values')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(format!("ok: {table_count}/3 core tables present"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. double-clicking another .saproj) forwards
            // its args here instead of opening a new window.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            if let Some(path) = find_saproj_arg(argv) {
                let _ = app.emit("open-project-file", path);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Database lives in the per-user app data dir.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::init(&dir.join("sa2025.sqlite"))?;

            // One-time seed of settings/staff_directory from the bundled
            // legacy-workbook defaults, if the tables are still empty.
            match app.path().resolve(
                "resources/settings-seed.json",
                tauri::path::BaseDirectory::Resource,
            ) {
                Ok(seed_path) => match std::fs::read_to_string(&seed_path) {
                    Ok(seed_json) => {
                        if let Err(e) = settings::seed_settings_if_empty(&conn, &seed_json) {
                            eprintln!("settings seed failed: {e}");
                        }
                    }
                    Err(e) => eprintln!("could not read {}: {e}", seed_path.display()),
                },
                Err(e) => eprintln!("could not resolve settings-seed.json: {e}"),
            }

            // Same idempotent seed pattern for the TP Companies directory.
            match app.path().resolve(
                "resources/tp-companies-seed.json",
                tauri::path::BaseDirectory::Resource,
            ) {
                Ok(seed_path) => match std::fs::read_to_string(&seed_path) {
                    Ok(seed_json) => {
                        if let Err(e) = tp_companies::seed_tp_companies_if_empty(&conn, &seed_json) {
                            eprintln!("tp_companies seed failed: {e}");
                        }
                    }
                    Err(e) => eprintln!("could not read {}: {e}", seed_path.display()),
                },
                Err(e) => eprintln!("could not resolve tp-companies-seed.json: {e}"),
            }

            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_field_map,
            get_template_pdf,
            get_launch_file,
            db_health,
            projects::create_project,
            projects::list_projects,
            projects::rename_project,
            projects::delete_project,
            projects::add_subcontractor,
            projects::list_subcontractors,
            projects::rename_subcontractor,
            projects::delete_subcontractor,
            projects::set_last_project,
            projects::get_last_project,
            projects::get_csv_selection,
            projects::set_csv_selection,
            projects::get_field_values,
            projects::set_field_value,
            export::export_project_csv,
            import::analyze_import_csv,
            import::parse_import_csv,
            files::write_binary_file,
            projectfile::export_project_file,
            projectfile::import_project_file,
            contract_info::get_contract_info,
            contract_info::set_contract_info_value,
            contract_info::set_contract_info_bulk,
            settings::get_settings,
            settings::set_setting,
            settings::list_staff,
            settings::upsert_staff,
            settings::delete_staff,
            tp_companies::list_tp_companies,
            tp_companies::upsert_tp_company,
            tp_companies::delete_tp_company,
            tp_companies::seed_tp_companies,
            tp_companies::reorder_tp_companies,
            nzbn_api::search_nzbn_companies,
            nzbn_api::apply_nzbn_match,
            grid_values::get_grid_values,
            grid_values::set_grid_value,
            grid_values::get_grid_values_for_project,
            grid_values::bulk_set_grid_values,
            compute::bulk_set_field_values,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
