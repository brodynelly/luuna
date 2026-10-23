# ADR 0036: a custom in-app title bar on Windows

Date: 2026-10-22. Status: Accepted. Amends [ADR 0030](0030-desktop-shell-and-tailwind.md) (the top bar and the native menu on Windows) and [ADR 0034](0034-owned-component-library.md) (a new navigation-family component, `WindowControls`).

## Context

The owner asked that the Windows desktop app not show the Windows title bar and instead draw its own window chrome inside the app: a drag area and minimize, maximize or restore, and close buttons. The unmerged branch `audit/frontend-consistency` holds earlier work with the same goal (commits `72b1333` and `3aead86`); it was read as prior art only and none of it was merged or cherry-picked, because those commits carry unrelated changes.

## Decisions

1. **Windows only.** `src-tauri/tauri.windows.conf.json` removes the native caption (`decorations: false`) and keeps the window shadow. Tauri merges a platform file into `tauri.conf.json` as a JSON Merge Patch, which replaces arrays, so the file carries the complete window entry (label `main`, title, size and minimum size, as in `tauri.conf.json`) and the complete `security.capabilities` list. macOS and Linux keep the native frame and menu. The CSP is unchanged.
2. **The top bar is the title bar.** `TopBar` accepts a `windowControls` slot. With it, the bar, its spacer and the sidebar's brand row carry `data-tauri-drag-region` (the attribute applies to the element itself, so the search button, toggles and the controls stay separate buttons and never start a drag); a double-click on a drag region maximizes or restores natively. `AppShell` takes `titleBar` and then places the banner under the top bar so the bar owns the window's top edge.
3. **Library component.** `WindowControls` (`packages/ui/src/navigation/`) is presentational: `maximized`, `onMinimize`, `onToggleMaximize`, `onClose`. Buttons are 46 px wide at the bar's full height, flush to the right edge; close uses the danger role on hover and press (4.5:1 or better for its glyph in both schemes); the focus ring is drawn inside the buttons; forced colours use `Highlight`. Glyphs come from `Icon`. The library imports nothing from Tauri.
4. **Platform glue stays in the app.** `apps/desktop/src/shell/windowChrome.ts` detects "Tauri window on Windows" (`__TAURI_INTERNALS__` in `window` and a Windows client hint or user agent), imports `@tauri-apps/api/window` lazily on first use, and reads `isMaximized` at start and after each DOM `resize` (one read per frame), which covers the button, a double-click on the drag region, Win+Up and Snap without event permissions. `useWindowChrome` returns `null` in the browser, on macOS and on Linux, and then nothing extra renders or is reserved.
5. **Minimal capability.** `capabilities/windows-titlebar.json` is limited to `"platforms": ["windows"]` and the `main` window and grants exactly `core:window:allow-start-dragging`, `core:window:allow-internal-toggle-maximize` (the double-click), `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-is-maximized` and `core:window:allow-close`. No filesystem, shell, process or event permission.
6. **No native menu bar on Windows.** A native menu bar would add a second bar above the in-app title bar (or be attached to an undecorated frame), so `menu.rs` and its registration are compiled only off Windows. Every menu command already has a page answer: views are `Ctrl+1` to `Ctrl+6` and `Ctrl+,`, "Go to…" is `Ctrl+K`, the sidebar is `Ctrl+\`, Help is `Ctrl+6`; WebView2 handles the standard Edit keys without a menu; closing is the title bar's close button.

## Consequences and known limits

- The Windows 11 snap-layout flyout that appears when hovering the native maximize button is not available with custom buttons. Snap by keyboard (Win+Arrow) and by dragging to a screen edge still work.
- The window rounds, shadows and resizes as an undecorated Windows window does; whether the resize borders and rounded corners behave on every Windows build needs a check on the real window.
- The document scrolls, so a classic (non-overlay) scrollbar would sit to the left of the caption buttons while content scrolls. WebView2's overlay scrollbars do not reserve that space; this has not been checked in a real window.
- Window state restore (size, position, maximized across launches) is a separate plugin and out of scope; the window opens at its configured size.
- macOS and Linux are unchanged. The banner placement change applies only while the title bar is shown.

## Alternatives rejected

- **`titleBarStyle` overlay.** It is a macOS option and does not remove the Windows caption.
- **A separate title row above the top bar.** It spends 30 to 40 px of height on a second bar with nothing in it and duplicates the top bar's job.
- **Keeping the native bar.** It is what the owner asked to remove.
- **Event permissions to track maximize.** `core:window:allow-*` event grants widen the surface; a DOM resize and `is-maximized` are enough.
