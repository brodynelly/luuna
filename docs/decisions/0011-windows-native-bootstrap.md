# ADR 0011: automatic Windows development runtime connection

Date: 2026-10-21. Status: accepted for the checkout-based Windows app.

## Context

The native app required a separate launcher and copying a bearer token for every
new view. ADR 0004 requires the service to survive client closure; automatic
startup must retain that independent lifetime and the existing durable state.

## Decision

The bundled main window receives one narrowly scoped Tauri command,
`ensure_local_runtime`. It accepts no executable, arguments, endpoint, token or
filesystem path from the view. On Windows it invokes the fixed repository-owned
`scripts/ensure-windows-runtime.ps1` with hidden Windows PowerShell, independently
of the app's working directory. The helper uses a per-account named startup
mutex, verifies the occupied port's executable identity and authenticates before
reuse, or starts the built runtime on loopback port 4242 with the saved provider
configuration. Unknown listeners are refused before sending any HTTP request.

Connection and provider records use current-account Windows DPAPI in
`%USERPROFILE%\.luuna\credentials`. The resolver copies existing encrypted
LocalAppData records only when the new files are absent, leaving the originals
intact. This stable path avoids Store-host filesystem redirection. Runtime logs
are in `.luuna/logs`; the existing data directory and token survive restarts.
Token identity is persisted before spawning and the verified PID immediately
afterward so uncertain startup can be authenticated and reconciled. A bounded
helper failure does not force-kill a runtime.

The helper returns the runtime URL and token through a captured private stdout
pipe and local-window IPC. On Windows a descendant can retain an inherited pipe
handle; the native reader consumes one bounded JSON line with a timeout rather
than waiting for EOF from a runtime that intentionally stays alive.
The provider key never crosses that boundary. The
client holds the connection only in memory, deduplicates concurrent startup
calls and authenticates against the API before marking itself connected. Reload
and explicit retry request fresh startup/reuse checks. Explicit disconnect stays
disconnected until retry or reload. Browser connections remain manual. Only the
local main window has the custom command permission; no general shell or
filesystem plugin is enabled.

Normal window closure does not stop the runtime or cancel work. Authenticated
explicit shutdown remains ADR 0010. Runtime approval and execution policies are
unchanged. DPAPI and same-account IPC are credential handling, not a sandbox.

## Validation and limits

`scripts/windows-native-startup-smoke.mjs` drives the actual bundled WebView2
frontend: warm reuse, normal close, explicit runtime stop, refusal of a foreign
listener without transmitting credentials, retry/cold start, reload, concurrent
windows, disconnect, preserved history/key bytes and empty browser storage.
It uses temporary test-owned debugging profiles and makes no model calls.
Normal launch enables no debugging endpoint. Run only against idle development
state. See `docs/WINDOWS-VERIFICATION.md` for measured results.

The executable still depends on this checkout, its built runtime, pinned Pi
dependencies, Node and saved provider configuration. This is not an installed
Windows service, automatic login startup, signed installer or packaged portable
distribution. Other platforms retain manual startup pending their own proof.
