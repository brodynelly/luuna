//! Native window behaviour (ADR 0039): one running instance, and the main window reopening where
//! the developer left it. Both plugins are Rust-only. The capability grants the page neither
//! plugin's commands, so the page cannot read or move the window state.

#![cfg(desktop)]

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_window_state::StateFlags;

/// Size, position and maximized state are restored. Visibility and decorations stay with
/// `tauri.conf.json`, so a stored state can never start the window hidden. The plugin only
/// restores a position whose window rectangle reaches a connected monitor; otherwise the OS
/// places the window.
const RESTORED: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);

pub fn state_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_window_state::Builder::new()
        .with_state_flags(RESTORED)
        .build()
}

/// A second launch brings the running window forward; it never starts another runtime helper.
pub fn reveal_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_geometry_but_never_visibility_or_decorations() {
        assert!(RESTORED.contains(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED));
        assert!(!RESTORED.intersects(StateFlags::VISIBLE | StateFlags::DECORATIONS));
    }
}
