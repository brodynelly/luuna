#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod menu;
mod runtime;

fn main() {
    tauri::Builder::default()
        .menu(menu::build)
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![runtime::ensure_local_runtime])
        .run(tauri::generate_context!())
        .expect("failed to start Luuna desktop");
}
