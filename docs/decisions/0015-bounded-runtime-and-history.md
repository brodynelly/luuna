# ADR 0015: Bounded runtime dispatch, display history and check progress

Date: 2026-10-21. Status: accepted for the existing foundation.

## Decision

Preserve SQLite's synchronous, transactional authority and FULL durability. Run
authenticated handlers on at most 32 admitted blocking tasks; admission remains
owned by the task if its HTTP caller disconnects. Run the already capped four
workers and baseline relays on blocking tasks too. This prevents synchronous
SQLite contention from occupying Tokio's I/O threads. Public health and
authenticated shutdown remain reachable when request capacity is exhausted.
SSE admits at most 16 streams, uses bounded blocking reads, and drains terminal
history fully before closing. Capacity exhaustion returns a retryable error.

Existing complete-history routes remain compatible. Optional `limit` on runs
and events selects pages of at most 200 records. Runs use `(created_at DESC,id)`
keyset order, indexed globally and by project, with `before` naming the last run
of the preceding page. Events support ascending `after` or descending `before`
(returned in ascending order), with approximately 1 MiB of encoded envelopes
per page. One oversized historical event is returned alone to guarantee forward
progress; no stored event is discarded or silently skipped.

The session client uses these pages, retains at most 200 live event payloads and
approximately 1 MiB of UTF-16 JSON (one oversized event is permitted), and loads
one historical page on demand. Assistant text is accumulated incrementally,
with a clearly marked 1 Mi-character display limit; complete records stay in
SQLite. Initial replay still reads every page to reconstruct assistant output.
The session list holds one page; idle refresh slows to five seconds. Workflow
requests have concurrency four. Settled display snapshots are reused while
active runs advance; manual refresh, actions, reconnect and component changes
invalidate them. Component-source observations are snapshots; all existing
approval/execution freshness and immutable identity guards remain mandatory.

Check progress uses a 64-message nonblocking channel and at most 100 excerpts
per stream. Display excerpts may be dropped under load and explicitly identify
themselves as truncated/display-only. File capture still drains both pipes,
stores up to 16 MiB per stream and hashes the actual recorded artifacts. Version
probes have bounded output too. Windows checks start suspended, join an owned
kill-on-close Job Object, then resume; cancellation, deadlines and cleanup stop
the descendant tree. Unix checks retain dedicated process groups. Neither is a
sandbox or a new authorization mechanism.

## Consequences

This bounds active request/thread pressure and normal session display memory
without splitting transactions or changing execution evidence. Legacy callers
can still request complete history. Workflow ticket enumeration and the first
assistant replay remain proportional to history size; future projections or
workflow pagination must preserve discovery of every ticket and approval.
Measured performance and platform/provider coverage belong in the performance
review, separately from historical documentation validation.
