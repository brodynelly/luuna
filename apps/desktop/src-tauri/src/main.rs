#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// ADR 0036: on Windows the in-app top bar is the title bar and there is no native menu bar; every
// menu command is also a page shortcut or the palette. macOS and Linux keep the menu (ADR 0030).
#[cfg(not(target_os = "windows"))]
mod menu;
mod runtime;

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(not(target_os = "windows"))]
    let builder = builder
        .menu(menu::build)
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()));
    builder
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
