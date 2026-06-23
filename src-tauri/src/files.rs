// Writes raw bytes (a filled PDF or a zip) to a user-chosen path. The PDF
// generation itself happens in the frontend with pdf-lib; the backend only
// owns the filesystem write.

#[tauri::command]
pub fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| format!("write {path}: {e}"))
}
