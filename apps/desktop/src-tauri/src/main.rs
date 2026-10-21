#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime::ensure_local_runtime])
        .run(tauri::generate_context!())
        .expect("failed to start Luuna desktop");
}
