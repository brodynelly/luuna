# Feature: Desktop frame-coalesced live event stream

## Metadata

- Type: feature
- Source: request; smooth-render scouting of the desktop live session view, October 22
- Date: 2026-10-22
- Orchestration: run smooth-render-20261022-0801, wave 1, item D1

## Feature Description

The desktop session view currently follows a live run by polling `client.eventPage` back to back (0 ms while pages arrive). Each HTTP page triggers its own React commit of the event window and the assistant text, which can be up to 1 MiB. With Pi's per-token `pi.message_update` events, rendering is driven by network arrival instead of by display frames. This feature follows the Neovide principle and decouples the two. Unsettled runs consume the runtime's resumable SSE stream, which `docs/CURRENT-ARCHITECTURE.md` already describes for the desktop. A small frame-coalescing buffer applies all records that arrive within one animation frame as one batch and commits at most one React update per frame. Settled and historic replay keep the existing cursor paging.

## User Story

As a Luuna developer watching a live session, I want assistant output to stream smoothly at display rate without the window stuttering or re-rendering per network page, while replay, reconnection and workflow controls behave exactly as they do today.

## Solution Statement

Split today's loop in `apps/desktop/src/sessions/useSessionReplay.ts` into three parts:

1. **`frameCoalescer.ts` (new, pure).** `createFrameCoalescer({ schedule, cancel, commit, maxPending })` accumulates `EventEnvelope`s. It schedules one frame callback while records are pending. On that frame it hands the whole batch to `commit` once. It exposes `push`, `flush` (synchronous, used on settle, fallback and batch-cap overflow) and `cancel` (drops the pending frame, permanently disables commits and is idempotent). The scheduler is injected:
   - The default uses `globalThis.requestAnimationFrame`/`cancelAnimationFrame`.
   - If those are absent (Node/vitest), it falls back to `setTimeout(…, 16)`.
   - Tests pass a fake scheduler.
2. **`followSession.ts` (new, React-free).** `followSession(client, runId, options, sink)` owns the follow loop. Its injected values are `signal`, `isWorkflow`, `runState()` (reads the latest run state from `runsRef`), `wait` (default `pause` from `../shell/runtime`) and a coalescer factory. It emits through a sink: `{ commit(events, text), candidate(active), live(text) }`.
   - **Live leg.** It runs only when `runState()` is known and not `isTerminal`, and the SSE retry backoff has elapsed. It iterates `client.streamEvents(runId, replay.cursor, signal)`, which is already in `packages/api-client/src/index.ts` (~1358) and resumes through `Last-Event-ID`. It pushes each record into the coalescer. The commit callback calls `replay.append(batch)` on a single `EventWindow` once per frame. This keeps EventWindow's whole-batch gap, identity and sequence validation, the 200-record and ~1 MiB window, and the exact 1 MiB `clip` semantics. It also replaces the per-token `concat`/`slice`/`JSON.stringify` window recomputation with one recomputation per frame.
     - Before pushing a record, the loop checks contiguity against a `pendingCursor` (`record.sequence === pendingCursor + 1` and the same `run_id`). A violation is treated as a stream failure, so a gap can never reach `EventWindow` mid-frame.
     - For workflows, a concurrent candidate ticker calls `client.candidate` every 700 ms and is aborted with the leg.
   - **Fallback.** Any of these flushes the coalescer synchronously and drops to the existing polling iteration, resuming from `replay.cursor`: an `ApiError` (including 429 "stream slots full" and 401/403/404), a network or parse error, a contiguity violation, or a normal stream end (the run settled or the runtime is stopping). After an error it sets an SSE retry backoff of 2500 ms (the existing error backoff) and reports `Reconnecting · replay will resume from sequence N · <describeFailure>`, the same text as today. A normal end sets no backoff, and the next iteration re-reads run state.
   - **Polling iteration.** This is the unchanged body of today's loop: `Promise.all([eventPage, candidate])`, immediate commit through the sink (pages are already batched), and `pause(0 | 700 | 5000)`. The error path is `pause(2500)`. While the run stays unsettled and the backoff has elapsed, the loop returns to the live leg.
   - We call `streamEvents` directly instead of `followEvents`. The reason is that `followEvents` has its own internal reconnect loop, which would hide 429 and outage events behind its hooks and bypass the required fallback to cursor polling.
3. **`useSessionReplay.ts` (thinned).** Keeps the same signature and return shape (`{ events, output, candidateActive }`). Its effect creates the `AbortController` and calls `followSession`. The sink maps to `setEvents`, `setOutput` (called only when the text identity changed), `setCandidateActive` and `setLive`. On cleanup it aborts and calls `coalescer.cancel()`, so no frame commits after unmount or selection change. `Sessions.tsx` does not change.

`EventWindow` in `@luuna/api-client` is not changed. Its `text` getter returns a string that is already maintained by concatenation and clipped once at the limit. Text is therefore appended incrementally per batch and is never rebuilt from the full record list. Committing it at most once per frame removes the per-page O(n) render cost without touching the shared client used by the TUI.

## Out of Scope

- Any change to `schemas/`, `crates/` (including `luuna-runtime` SSE at `crates/luuna-runtime/src/lib.rs` ~1254-1316), the `run_event` event name, `scripts/check-contracts.mjs` or runtime bounds.
- Any change to `packages/api-client/src/index.ts` (`streamEvents`, `followEvents`, `EventWindow`, `assistantText`). If the implementer finds a real defect there, they report it instead of patching it in this item.
- Virtualizing or restyling `EventList.tsx`/`SessionParts.tsx`, or memoizing the output render. Other smooth-render items own those.
- TUI streaming, the runs list polling (`watchRuns`) and candidate review UI.
- Any claim of real WebView frame timing, provider streaming or platform success. The vitest suites prove scheduling logic only.
- Committing, pushing or integration. The orchestrator owns those.

## Relevant Files

- `AGENTS.md`, `AI-START-HERE.md`, `docs/CURRENT-ARCHITECTURE.md` (lines ~39 and ~137: desktop over authenticated HTTP plus resumable SSE; "streamed state and reconnection"), `docs/decisions/0015-bounded-runtime-and-history.md` (16 SSE slots, 200-record and ~1 MiB client window), `docs/decisions/0030-desktop-shell-and-tailwind.md` (no front-end file over 300 lines). Read these before implementing.
- `apps/desktop/src/sessions/useSessionReplay.ts`: current 0 ms page loop (lines 20-59). Becomes a thin React adapter over `followSession`.
- `apps/desktop/src/sessions/Sessions.tsx`: sole consumer (`useSessionReplay(client, selected, runs, refresh, setLive)`). Must not need changes.
- `apps/desktop/src/shell/runtime.ts`: `pause(ms, signal)` (line ~27) is reused as the default `wait`. `watchRuns` shows the injectable-wait pattern to follow.
- `apps/desktop/src/failures.ts`: `describeFailure` for the reconnect text.
- `packages/api-client/src/index.ts`: `LuunaClient.streamEvents` (~1358), `followEvents` (~1388, deliberately not used), `eventPage` (~1443), `candidate`, `ApiError`, `isTerminal`, `EventWindow` (~1873). Read-only.
- `apps/desktop/src/sessions/frameCoalescer.ts` (new): pure coalescer and default rAF/timeout scheduler.
- `apps/desktop/src/sessions/followSession.ts` (new): React-free SSE-first follow loop with polling fallback.
- `apps/desktop/src/sessions/frameCoalescer.test.ts` (new): coalescer unit tests.
- `apps/desktop/src/sessions/followSession.test.ts` (new): fake-client tests for SSE, the fallback and the polling cadence.
- `apps/desktop/src/shell/runtime.ts` tests and `apps/desktop/src/App.test.tsx`: existing desktop tests that must stay green.

## Implementation Plan

### Foundation

Run `git status` and record the starting commit. Confirm that `apps/desktop` tests run under vitest in the Node environment (no jsdom). New tests must not need the DOM or `requestAnimationFrame`.

Define these types in `frameCoalescer.ts`:

```ts
export type FrameScheduler = { request(callback: () => void): unknown; cancel(handle: unknown): void };
export function animationFrameScheduler(): FrameScheduler; // rAF when present, else setTimeout 16 ms
export function createFrameCoalescer<T>(options: { scheduler: FrameScheduler; commit: (batch: T[]) => void; maxPending?: number /* default 1000 */ }): {
  push(item: T): void; flush(): void; cancel(): void; readonly pending: number;
};
```

Required semantics:

- At most one scheduled frame at any time.
- `flush` with nothing pending is a no-op and never calls `commit([])`.
- Reaching `maxPending` flushes synchronously. This bounds memory when rAF is throttled in a hidden window.
- After `cancel`, `push` and `flush` are no-ops and any scheduled frame is cancelled.
- If `commit` throws, the pending batch is dropped and the error is passed to an optional `onError(error)` option. `followSession` uses that option to end the live leg and fall back to polling.

### Core

Implement `followSession` as described in the Solution Statement:

- A single `EventWindow` per follow. Both legs advance and read `replay.cursor`.
- In the live leg, `pendingCursor` starts at `replay.cursor` and advances on every push.
- On any leg exit, call `coalescer.flush()` before the polling iteration, so that `replay.cursor` reflects everything received before `eventPage(…, replay.cursor)`.
- `setLive("Connected")` is emitted after the first SSE record or the first successful page. It is not emitted per record, which matches the existing "announced only when it changes" intent (the caller deduplicates).
- The candidate ticker only runs when `isWorkflow` is true. Its failures go through the same reconnect reporting but do not end the SSE leg.
- An `EventWindow.append` error during a frame commit, or a contiguity violation, ends the leg through an internal `AbortController` that is chained to the outer signal. The loop then falls back to polling. If paging returns valid records, `EventWindow` validates them as before. Gap or identity errors from paging keep today's behavior (reconnect message and 2500 ms backoff).
- When the outer signal is aborted, return without emitting anything else.

### Integration

Rewrite `useSessionReplay.ts` so that:

- State reset on `[client, selected, workflow, refresh]` is unchanged.
- The effect creates the controller and calls `followSession`. `runState` reads `runsRef.current`.
- Cleanup calls `controller.abort()` and cancels the coalescer.

Keep each new or edited file under 300 lines. Keep the doc comment on the hook accurate: it now describes SSE first with replay repair.

## Step by Step Tasks

1. Read the instruction and ADR files listed above. Record `git status` and `git rev-parse HEAD`.
2. Create `apps/desktop/src/sessions/frameCoalescer.ts` with the scheduler abstraction, the coalescer and the default `animationFrameScheduler()`.
3. Create `apps/desktop/src/sessions/frameCoalescer.test.ts`. Cover:
   - N pushes before the frame produce exactly one commit with all N items in order.
   - Pushes after a frame produce a second commit.
   - `flush` commits synchronously and cancels the scheduled frame.
   - An empty `flush` does nothing.
   - `cancel` stops all later commits, including a frame that is already scheduled.
   - `maxPending` forces a synchronous flush.
   - A throwing `commit` is routed to `onError`.
   - The default scheduler works without `requestAnimationFrame`.
4. Create `apps/desktop/src/sessions/followSession.ts` with the live leg, the fallback and the unchanged polling iteration. Use an injected `wait` and a coalescer factory.
5. Create `apps/desktop/src/sessions/followSession.test.ts`. Use a fake client (`streamEvents` as an async generator, `eventPage`, `candidate`), a fake scheduler driven manually, and a fake `wait` that records requested delays. Cover:
   - An unsettled run streams many `pi.message_update` records within one frame, and the sink receives one commit whose text equals the concatenated deltas.
   - SSE `ApiError(429)` falls back to `eventPage(run, cursor)` with the cursor equal to the last committed sequence. The reconnect text is reported and a 2500 ms backoff is requested.
   - A network error mid-stream flushes the records already pushed before fallback. No record is lost or duplicated, and the polling resumes from the correct cursor.
   - A normal stream end, with the run now terminal, flushes immediately and continues with settled paging (5000 ms cadence). `streamEvents` is never called for a terminal run.
   - A non-contiguous SSE sequence triggers fallback and is never committed.
   - A workflow run still reports `candidate(active)` during SSE.
   - Aborting the signal stops all commits and sink calls.
   - The polling-only path still uses the 0/700/5000/2500 ms cadence.
6. Refactor `apps/desktop/src/sessions/useSessionReplay.ts` into a thin adapter over `followSession`. Keep the exported signature and return shape, abort plus `cancel` on cleanup, and `setOutput` only on a text change.
7. Check file lengths (`wc -l`) for every touched file (300 or fewer). Run `git diff --stat` to confirm that nothing outside `apps/desktop/src/sessions/` changed.
8. Run the Validation Commands, fix any failures this change introduced, and report unrelated baseline failures separately.

## Testing Strategy

- Unit (`frameCoalescer.test.ts`): batching per frame, a single scheduled frame, synchronous flush, cancel, the overflow cap, error routing and the scheduler fallback in Node.
- Behavior (`followSession.test.ts`): SSE-first for unsettled runs, every fallback trigger (429, other `ApiError`, network error, contiguity violation, commit validation error, normal end), cursor continuity across legs, candidate polling during SSE, abort, and the preserved polling cadence. All with a fake client, fake scheduler and fake wait. No real timers or network.
- Regression: the existing desktop suites (`App.test.tsx`, `workflows/*.test.tsx`, others) and the api-client suite stay green and unchanged.
- Edge cases: an empty stream that ends at once; the first record arriving when the cursor is already above 0 (resume); text at or beyond the 1 MiB clip, where the suffix appears exactly once because `EventWindow.clip` is unchanged and applied per batch; selection change mid-frame (the old coalescer is cancelled and the new run starts clean).
- Not proven: real WebView/Tauri frame pacing, real runtime SSE under load, and real provider token streams. Report these as unverified.

## Acceptance Criteria

- [ ] WHEN the selected run is not terminal THE SYSTEM SHALL read events through `client.streamEvents(run, replay.cursor, signal)` and not through back-to-back `eventPage` calls.
- [ ] WHEN multiple records arrive before one animation frame THE SYSTEM SHALL perform exactly one `EventWindow.append` and one sink/React commit for them.
- [ ] WHEN SSE fails (429, other API or network error, out-of-sequence record) THE SYSTEM SHALL flush pending records, report the existing reconnect text, and continue by cursor paging from the last committed sequence, with no lost or duplicated records.
- [ ] WHEN the stream ends or the run settles THE SYSTEM SHALL flush immediately and continue with the existing settled paging cadence (5000 ms) and candidate polling.
- [ ] WHEN the view unmounts or the selection changes THE SYSTEM SHALL abort the request and stream and SHALL NOT commit any pending frame.
- [ ] Workflow candidate activity still updates while streaming. `setLive` semantics and the "Connected" announcement are unchanged.
- [ ] The 200-record and ~1 MiB window and the 1 MiB text clip behave exactly as before, because `EventWindow` is unchanged.
- [ ] No changes under `schemas/`, `crates/`, `packages/`, `scripts/`. No new or edited file exceeds 300 lines.
- [ ] New coalescer and follow tests exist and pass under vitest without jsdom.

## Validation Commands

There is no TAC section. These commands come from `package.json`, `apps/desktop/package.json` and `packages/api-client/package.json`.

- `npm run typecheck --workspace @luuna/desktop`
- `npm run test --workspace @luuna/desktop` (includes the new `src/sessions/frameCoalescer.test.ts` and `src/sessions/followSession.test.ts`)
- `npx vitest run src/sessions --root apps/desktop` (focused check for this change)
- `npm run test --workspace @luuna/api-client --if-present` (shared client is unchanged and green)
- `npm run build`
- `git diff --stat -- schemas crates packages scripts` (must print nothing)
- `wc -l apps/desktop/src/sessions/*.ts apps/desktop/src/sessions/*.tsx` (every file 300 lines or fewer)
- `git diff --check`

## Notes

- These tests prove scheduling and fallback logic with fakes. Real WebView frame timing, real runtime SSE behavior with 16 slots and genuine provider token streaming are not established by this item. Record them as unverified until a native session smoke observes them.
- Risk: in a hidden or minimized window, rAF may pause. The `maxPending` synchronous flush (default 1000) bounds memory, and the hook commits normally when the window is visible again.
- Risk: 16 SSE slots are shared with TUI and other followers. Fallback to paging on 429 is intentional. The 2500 ms retry backoff avoids hammering the runtime, which keeps answering 429 while full.
- Follow-up candidates (separate items): memoizing or virtualizing the output and event list render, and an api-client-level incremental text API if profiling shows `EventWindow` window recomputation per frame is still costly.
