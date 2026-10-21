# ADR 0004: independent service lifetime and explicit shutdown

Date: 2026-10-16. Status: accepted development contract; packaged supervision strategy pending platform proof. Amended 2026-10-21: the implementation note below.

## Context

Runs must survive client disconnection. A desktop sidecar may inherit the application's lifetime, so merely spawning one does not establish runtime independence.

## Decision

The Rust service owns runs, workers, durable events, and lifecycle transitions. In development, launch it as an explicitly managed foreground process separate from the desktop. The client discovers/connects to an authenticated loopback endpoint and resumes event delivery by cursor. Window close, refresh, or dropped SSE does not request cancellation or service shutdown.

Shutdown is an explicit authenticated service action or an operating-system termination path. Stop or terminate only owned workers, preserve artifacts and work, and durably record interrupted attempts. On restart, reconcile incomplete attempts before scheduling or publishing; never infer success from a vanished process. Cancellation is a distinct run command and is idempotent.

Implementation note (2026-10-21): until this date the runtime's Ctrl+C/SIGTERM path reused the cancellation signal and so recorded work stopped by shutdown as `cancelled`, a terminal state with no recovery, while a hard kill left the same work `interrupted` and resumable. The runtime now sets a shutdown flag before signalling owned workers; every settlement that would have recorded `cancelled` records `interrupted` with the reason prefixed "interrupted by runtime shutdown" (demo runs, baselines, writers, candidate checks and reviews), so an orderly stop is never worse for the developer than a crash. Spend accounting is unchanged: a model turn stopped mid-flight still reserves the remaining approved cost. The desktop client treats a lost runtime as an outage shown beside the connection state, reconnects by itself, and reloads every panel when the runtime answers again.

## Consequences and validation

Distribution needs a tested Mac/Windows startup, supervision, token storage, and shutdown strategy. A Tauri sidecar is allowed only if measured lifecycle behavior satisfies the contract. Validate disconnect/reconnect, cancellation, forced process exit, restart reconciliation, and no duplicate external side effects. Do not claim these properties from unit fixtures alone.
