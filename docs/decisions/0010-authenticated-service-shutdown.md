# ADR 0010: authenticated service shutdown and scheduling admission

Date: 2026-10-21. Status: accepted; implements ADR 0004's explicit service action.

## Context

Node process signals terminate Windows processes instead of delivering the
runtime's console Ctrl+C path. Hidden development services therefore lacked a
portable way to stop orderly. Windows browser smoke tests showed crash recovery,
but not the promised explicit shutdown interruption and clean process exit.

## Decision

`POST /api/v1/shutdown` is a bearer-authenticated, idempotent service action.
It returns 202 and notifies the main process to use the existing owned-worker
shutdown path. A fair admission lock drains previously accepted mutation
handlers before stopping workers; new mutations receive 503 after shutdown is
requested. Authenticated reads remain available while interruption is persisted.
The endpoint never publishes, merges, widens approval, or treats client closure
as shutdown. Main exits normally after the HTTP server drains.

The Windows stop command decrypts the existing local connection token with
DPAPI, submits the request only to the fixed loopback endpoint, and waits for the
verified runtime process to exit. It does not force-kill on failure. Launchers
reuse the encrypted connection token and data directory across restarts so an
open client can reconnect. Native desktop and runtime remain independent sibling
processes. This is a development launcher, not a signed installer or installed
Windows service.

Windows smoke harnesses use the authenticated action for orderly stops and
retain hard kills for crash scenarios. Unix SIGTERM coverage is retained.
Native smoke drives the actual bundled Tauri frontend through a temporary
test-owned WebView2 debugging endpoint; production launch enables no debugging
endpoint. Native form entry through CDP is not keyboard-only evidence.

## Validation

Tests must reject unauthenticated shutdown, accept repeated authorized requests,
block scheduling after admission closes, retain reads, record active work as
interrupted with the shutdown reason, and prove clean exit plus restart recovery.
Native launch must identify the executable and exercise its own embedded view,
not substitute the Vite browser client. Evidence is recorded separately in
`docs/WINDOWS-VERIFICATION.md`.
