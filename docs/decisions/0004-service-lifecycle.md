# ADR 0004: independent service lifetime and explicit shutdown

Date: 2026-10-16. Status: accepted development contract; packaged supervision strategy pending platform proof.

## Context

Runs must survive client disconnection. A desktop sidecar may inherit the application's lifetime, so merely spawning one does not establish runtime independence.

## Decision

The Rust service owns runs, workers, durable events, and lifecycle transitions. In development, launch it as an explicitly managed foreground process separate from the desktop. The client discovers/connects to an authenticated loopback endpoint and resumes event delivery by cursor. Window close, refresh, or dropped SSE does not request cancellation or service shutdown.

Shutdown is an explicit authenticated service action or an operating-system termination path. Stop or terminate only owned workers, preserve artifacts and work, and durably record interrupted attempts. On restart, reconcile incomplete attempts before scheduling or publishing; never infer success from a vanished process. Cancellation is a distinct run command and is idempotent.

## Consequences and validation

Distribution needs a tested Mac/Windows startup, supervision, token storage, and shutdown strategy. A Tauri sidecar is allowed only if measured lifecycle behavior satisfies the contract. Validate disconnect/reconnect, cancellation, forced process exit, restart reconciliation, and no duplicate external side effects. Do not claim these properties from unit fixtures alone.
