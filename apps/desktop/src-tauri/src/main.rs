#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod menu;
mod runtime;

fn main() {
    tauri::Builder::default()
        .menu(menu::build)
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()))
        .setup(|_app| {
            // Development builds open the WebView inspector so rendering and console issues are visible.
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![runtime::ensure_local_runtime])
        .run(tauri::generate_context!())
        .expect("failed to start Luuna desktop");
}
