# ADR 0004: independent service lifetime and explicit shutdown

Date: 2026-10-16. Status: accepted development contract; packaged supervision strategy pending platform proof. Amended 2026-10-21: the implementation note and the lifecycle hardening amendment below.

## Context

Runs must survive client disconnection. A desktop sidecar may inherit the application's lifetime, so merely spawning one does not establish runtime independence.

## Decision

The Rust service owns runs, workers, durable events, and lifecycle transitions. In development, launch it as an explicitly managed foreground process separate from the desktop. The client discovers/connects to an authenticated loopback endpoint and resumes event delivery by cursor. Window close, refresh, or dropped SSE does not request cancellation or service shutdown.

Shutdown is an explicit authenticated service action or an operating-system termination path. Stop or terminate only owned workers, preserve artifacts and work, and durably record interrupted attempts. On restart, reconcile incomplete attempts before scheduling or publishing; never infer success from a vanished process. Cancellation is a distinct run command and is idempotent.

Implementation note (2026-10-21): until this date the runtime's Ctrl+C/SIGTERM path reused the cancellation signal and so recorded work stopped by shutdown as `cancelled`, a terminal state with no recovery, while a hard kill left the same work `interrupted` and resumable. The runtime now sets a shutdown flag before signalling owned workers; every settlement that would have recorded `cancelled` records `interrupted` with the reason prefixed "interrupted by runtime shutdown" (demo runs, baselines, writers, candidate checks and reviews), so an orderly stop is never worse for the developer than a crash. Spend accounting is unchanged: a model turn stopped mid-flight still reserves the remaining approved cost. The desktop client treats a lost runtime as an outage shown beside the connection state, reconnects by itself, and reloads every panel when the runtime answers again.

Amendment (2026-10-21, lifecycle hardening): an orderly stop always ends. Every step is bounded: admitted mutation requests drain for at most five seconds (a request that never finishes its body cannot hold the stop open; work it registers later is still signalled), owned work settles for at most five seconds, and open connections drain for at most ten seconds, after which the process exits with status 1. Every SSE stream ends when shutdown begins, so a follower of an idle workflow no longer keeps the process, its port and the data-directory lock alive. A second Ctrl+C or SIGTERM exits at once (status 130) and leaves unsettled work to restart recovery, as the default signal action would. On Windows, Ctrl+Break, console close and system shutdown also take the orderly path, best effort because Windows ends the process within seconds; supervisors use the ADR 0010 endpoint. Once shutdown begins, every mutation is refused with 503 `{"error":"runtime is shutting down"}`. Each owned worker runs under a supervisor: a worker that panics settles its run `failed` with an internal-error reason, releases its concurrency slot, abandons an active lease with its files preserved, and reserves unreported spend exactly as restart recovery does (a running attempt takes the remaining approved time and cost; a candidate stage keeps its elapsed time and a review also the remaining cost), so no retry can exceed the approved budgets. Cancellation of a run whose worker already returned answers with the settled state instead of an error. A `failed` or `interrupted` workflow keeps its event stream open, because repair and re-validation continue on the same run id. On Unix an existing data directory and its `worktrees` directory are made owner-only at startup. Individual check results stopped by shutdown still carry the executor's `cancelled` check status beneath the `interrupted` baseline or candidate; recording `interrupted` at the check level belongs to the baseline and candidate check recording, not to this lifecycle path.

## Consequences and validation

The authenticated action and scheduling-admission implementation are specified
by [ADR 0010](0010-authenticated-service-shutdown.md). Windows development launch
and clean-stop evidence is recorded in `docs/WINDOWS-VERIFICATION.md`; installed
service supervision and signed distribution remain distinct requirements.

Distribution needs a tested Mac/Windows startup, supervision, token storage, and shutdown strategy. A Tauri sidecar is allowed only if measured lifecycle behavior satisfies the contract. Validate disconnect/reconnect, cancellation, forced process exit, restart reconciliation, and no duplicate external side effects. Do not claim these properties from unit fixtures alone.
