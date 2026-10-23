//! The native menu bar (ADR 0030): every view and the sidebar toggle are reachable from a menu,
//! with the same shortcuts the page answers, and the platform's standard Edit commands make copy
//! and paste work in the web view. A menu command reaches the page as a `luuna:command` DOM event
//! through `eval`, so the frontend needs no additional Tauri permission. macOS and Linux only: on
//! Windows the in-app top bar is the title bar and there is no menu bar (ADR 0036); the page answers
//! the same shortcuts itself, and WebView2 handles the standard Edit keys without a menu.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};

/// The views in sidebar order with their shortcuts; the ids match `src/content/views.ts`.
const VIEWS: [(&str, &str, &str); 6] = [
    ("home", "Home", "CmdOrCtrl+1"),
    ("board", "Board", "CmdOrCtrl+2"),
    ("projects", "Projects", "CmdOrCtrl+3"),
    ("sessions", "Sessions", "CmdOrCtrl+4"),
    ("settings", "Settings", "CmdOrCtrl+5"),
    ("help", "Help", "CmdOrCtrl+6"),
];

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings = MenuItemBuilder::with_id("app:settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Luuna")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let mut view = SubmenuBuilder::new(app, "View");
    for (id, label, accelerator) in VIEWS {
        view = view.item(
            &MenuItemBuilder::with_id(format!("view:{id}"), label)
                .accelerator(accelerator)
                .build(app)?,
        );
    }
    let palette = MenuItemBuilder::with_id("palette:open", "Go to…")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let toggle = MenuItemBuilder::with_id("sidebar:toggle", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+\\")
        .build(app)?;
    let view = view.separator().item(&palette).item(&toggle).build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("app:help", "Luuna Help").build(app)?)
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &view, &help])
        .build()
}

/// Forwards a menu command to the page; ids are fixed strings from `build`, never user input.
pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    // The app and Help menus repeat two views under ids of their own (menu ids are unique).
    let id = match id {
        "app:settings" => "view:settings",
        "app:help" => "view:help",
        other => other,
    };
    let known = id == "sidebar:toggle"
        || id == "palette:open"
        || VIEWS
            .iter()
            .any(|(view, _, _)| id == format!("view:{view}"));
    if !known {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('luuna:command', {{ detail: '{id}' }}))"
        ));
    }
}
