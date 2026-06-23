// Shared access to the bundled field-map.json (the AcroForm field names are the
// single source of truth). Used by CSV export (field types) and import (valid
// field-name validation).
use std::collections::HashMap;
use tauri::Manager;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Returns a map of field name -> field type ("text", "checkbox", "radio",
/// "dropdown", "signature").
pub fn load_field_types(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = app
        .path()
        .resolve(
            "resources/field-map.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(map_err)?;
    let raw = std::fs::read_to_string(&path).map_err(map_err)?;
    let json: serde_json::Value = serde_json::from_str(&raw).map_err(map_err)?;
    let mut map = HashMap::new();
    if let Some(fields) = json.get("fields").and_then(|f| f.as_array()) {
        for f in fields {
            if let Some(name) = f.get("name").and_then(|n| n.as_str()) {
                let ty = f
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("text")
                    .to_string();
                map.insert(name.to_string(), ty);
            }
        }
    }
    Ok(map)
}
