fn main() {
    // Without this, Cargo won't re-run the resource-copy step (and won't
    // refresh target/debug/resources) just because a file was added under
    // resources/ — only tauri.conf.json or build.rs changes trigger it.
    println!("cargo:rerun-if-changed=resources");
    tauri_build::build()
}
