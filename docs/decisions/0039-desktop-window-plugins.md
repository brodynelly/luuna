# ADR 0039: one desktop instance and a remembered window (single-instance and window-state plugins)

Date: 2026-10-23. Status: Accepted. Builds on [ADR 0030](0030-desktop-shell-and-tailwind.md) (native shell), [ADR 0011](0011-windows-native-bootstrap.md) (Windows bootstrap) and [ADR 0038](0038-custom-windows-title-bar.md) (the in-app title bar).

## Context

Launching the desktop twice opened a second window that ran `ensure_local_runtime` again, so a second startup helper raced the first for the same runtime and port. Every launch also opened at the configured 1160 x 800 in a position the OS chose, and the window painted white before the page loaded. These are native-shell concerns, not runtime policy: nothing here changes what the runtime decides or what the page may do.

The unmerged branch `audit/frontend-consistency` (commit `72b1333`, formerly numbered ADR 0034 there) holds the original work. It was read as prior art and only this part was ported; its fonts, styling and title bar are superseded by [ADR 0035](0035-mantine-theme-and-outfit.md) and ADR 0038.

## Decisions

1. **Single instance.** `tauri-plugin-single-instance` `=2.5.4` (official, Tauri plugins workspace) is registered first in the builder. A second launch hands its arguments to the running process and exits before it creates a window, so it never calls `ensure_local_runtime`. The running process unminimizes, shows and focuses its `main` window (`src-tauri/src/window.rs`). Arguments and working directory from the second launch are ignored; no deep links are accepted.
2. **Window state.** `tauri-plugin-window-state` `=2.5.0` (official) restores the `main` window's size, position and maximized state and saves them on exit. Visibility and decorations are excluded, so a stored state can never start the window hidden and `tauri.conf.json` and `tauri.windows.conf.json` stay authoritative for them. A saved position is restored only when the saved rectangle has a corner on a connected monitor; otherwise the OS places the window. That check is per corner, so a window saved mostly off a monitor can return mostly off it; the developer can still move it, and the minimum size still applies. The state file is the plugin's default `.window-state.json` in the app config directory (`dev.luuna.desktop`) and holds geometry only.
3. **Least privilege.** Both plugins are used from Rust only. No JavaScript API package is added and no capability grants a plugin permission, so the page cannot call the window-state commands the plugin registers. Both are desktop-only dependencies (`cfg(any(windows, macos, linux))`) and the code is `cfg(desktop)`. Native execution still has host permissions; neither plugin is a sandbox.
4. **Window configuration.** The `main` window gets `backgroundColor` `#ffffff`, the Mantine light body colour, so the default light theme shows no white-then-page flash. Tauri has no per-theme window background, so a dark-scheme user sees a brief light frame; that is accepted. The minimum size stays 760 x 600: the earlier branch lowered it to 640 x 480, which the current layout has not been checked at, so it is not taken.
5. **CSP unchanged.**

## Platform behaviour

- **Windows.** Single instance uses a named mutex and a window message; a second `luuna-desktop.exe` exits immediately. Window state uses physical pixels, so a different scale factor on the next launch restores the saved physical size.
- **macOS and Linux.** The plugins also apply; neither has been run here.

## Alternatives rejected

- **`tauri-plugin-store`** for window or UI state: geometry is covered by window-state, and a store adds a writable file reachable from JavaScript.
- **`tauri-plugin-updater`**: there is no signed release channel or update endpoint, and an updater downloads and runs code, so it needs its own decision first.
- **A hand-written mutex or lock file**: the official plugin covers all three desktop platforms and hands focus to the first instance.
- **Merging `audit/frontend-consistency`**: it carries unrelated and superseded changes, including the Söhne fonts.
