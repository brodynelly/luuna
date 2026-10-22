# ADR 0026: ticket and memory controls, and behaviour-level client parity

Date: 2026-10-22. Status: accepted. Closes the audit findings that a green
capability-catalog check (ADR 0020) established wiring but not the behaviour
R02/A33 require, and that the catalog could not establish the ticket-edit and
memory obligations of `docs/06-memory.md` and `docs/09-experience.md` because
the runtime served no such routes. Extends ADR 0014 (which left ticket editing
outside its slice) and ADR 0021 (promotion and the scope-safe project export).

## Context

`docs/06-memory.md` requires inspect, edit, export, delete and disable controls
for memory through both clients; `docs/09-experience.md` lists ticket editing
among the actions both clients support; R14 names scoped memory with provenance
and deletion; ADR 0017 added multi-repository registration, per-repository
baselines, task graphs with `max_workers` and resumption by `task_id`. The
catalog listed every served route with a desktop marker and a TUI command, but:
the desktop registration form and the TUI `register` built a one-repository
array; the desktop baselined only `repositories[0]`; the desktop plan form
always sent one `task`; the task graph display had no per-task resume; and no
route existed for editing a ticket, correcting a memory record, exporting the
personal user memory or retaining memory by age. A marker test proves a control
exists, not what it sends or when it appears.

## Decision

### Ticket edit {#ticket-edit}

`PUT /api/v1/tickets/{id}` takes `{expected_revision, title?, intent?,
acceptance_criteria?, repository_ids?}` and names at least one field. A legacy
SQLite ticket is revised in place (`Store::revise_ticket`), its revision
advances and `ticket.updated` records the previous revision and the fields
changed; an unregistered repository is refused. For an enabled project the
Missions adapter edits the issue's title and the versioned Luuna envelope
through the Missions CLI `update` under the durable component-operation ledger
(`ticket.update`, key `ticket-update:<ticket>:<revision>`): the intent is
recorded before the CLI write, a retry after an uncertain write recognises the
written title and envelope in the source instead of writing twice, a source
that changed outside Luuna or during the edit is refused rather than
overwritten, and the projection is then reconciled so its revision advances.
Either way an existing plan was made for the earlier ticket revision: the
scheduling gate (`check_ticket_binding`) refuses `implement`, the evidence
boundaries refuse validation and review consumption (`verify_plan_sources`),
and the publication gate refuses publication and reconciliation, now with a
durable `publication.refused` event of kind `source_changed` recorded before
the generic authorization refusal. Reconciliation never renews an old plan's
authorization (ADR 0014 point 4): the developer re-plans.

### Memory edit {#memory-edit}

`PUT /api/v1/projects/{id}/memory/{memory_id}` with `{idempotency_key,
expected_hash, content}` corrects a record in place through the Atlas CLI
`edit` under the same ledger (`memory.update`). The record keeps its identity
and scope; its provenance becomes `corrected from <previous hash>: <previous
provenance>` (clipped to the 1000-byte bound), so the fact's history stays
readable. A stale displayed hash is refused (409); a retry after an uncertain
write recognises the corrected content under that correction's provenance. A
corrected record that an approved plan selected no longer matches the plan's
`component_context`, so the existing source checks refuse implementation,
validation, review consumption and publication of that plan.

### Personal export {#user-export}

`GET /api/v1/memory/user/export` returns every user-scope record with its
provenance from the one private user store (`<data_dir>/components/user`),
never a project's memory, as `luuna-user-memory-export` with an `omitted`
list. It is the personal export ADR 0021's project export refuses to carry,
and it travels between machines too, so the same guard applies minus the
user-scope refusal: a record carrying a known credential value, the data
directory, any registered checkout path, the home directory or an absolute
path of this host's shapes refuses the whole export (409) rather than redacting
it.

### Retention {#retention}

A project-level policy, `GET`/`PUT /api/v1/projects/{id}/memory/retention`
(`{process_max_age_days, project_max_age_days}`, each `null` or 1..3650 days,
default none; `memory.retention_set` is durable), deletes nothing by itself.
`POST /api/v1/projects/{id}/memory/retention/apply` with `{idempotency_key}`
deletes every project or process record whose Luuna-recorded creation time is
older than the limit, each through the reconciled delete of ADR 0014 under the
ledger (`memory.retention.apply`), and records `memory.retention_applied`
naming the policy and every deleted record. Replaying the key returns the
recorded result; a retry after a crash deletes only what is still present.
User memory is personal and never subject to a project policy; the TUI
confirms before applying, the desktop requires an explicit acknowledgment.

### Client parity, behaviour level {#parity}

The catalog gains six entries (`tickets.update`, `memory.update`,
`memory.user.export`, `memory.retention.show`, `memory.retention.set`,
`memory.retention.apply`) and every entry a `required_by` list naming the
requirement, acceptance scenario or specification section it serves.
`scripts/check-contracts.mjs` traces a fixed list of required actions (ticket
edit; memory inspect, edit, export, delete, disable and promotion;
multi-repository registration and planning; per-repository baselines; task
resume; publication reconcile; cancel; recovery and reconnect) to catalog
entries whose desktop `data-capability` marker and TUI command both exist.

The request bodies both clients send come from builders in
`@luuna/api-client`: `registerProjectRequest` (every repository row, none
repeated) and `planRequestForTasks` (one `task` in its pre-M4 shape for a
single task, `tasks` with `depends_on` for a graph, `budgets.max_workers` only
when it is not the default, refusing a duplicate repository, a self or unknown
dependency and more workers than tasks before anything is sent). The desktop
registration form takes several repository rows; the TUI `register` keeps its
positional first repository and accepts repeated `--repository <id>=<path>`.
The desktop offers one baseline control per registered repository with that
repository's latest status and polls every pending baseline run; the TUI
`baseline <project> <repository>` and `baselines` already target each. The
desktop plan form keeps the single-task default and opens a task-graph editor
(repository, paths, dependencies among the other rows, concurrent writers) for
a multi-repository project; the TUI `plan --task … --workers` sends the same
body. The desktop task graph shows `Resume task <id>` for a `failed`,
`blocked` or `interrupted` task of a `failed` or `interrupted` run, carrying
the same `runs.implement` capability as Implement (a state-specific control of
one action); the TUI has `implement --task`. The desktop gains a ticket editor
per ticket that sends only changed fields at the displayed revision and names
the plan it stales, a per-record memory correction, the personal export as a
download and the retention policy with an acknowledged apply; the TUI gains
`edit-ticket`, `correct-memory`, `export-user-memory`, `retention`,
`set-retention` and `apply-retention`.

## Consequences and validation

- Runtime: `crates/luuna-runtime/tests/writer.rs` proves an edited legacy
  ticket advances its revision with `ticket.updated`, refuses the stale,
  empty and unregistered edits, refuses `implement` of the earlier plan with
  no attempt recorded and implements the next revision; and that the
  retention policy is durable per project while applying it fails closed
  without enabled components. `tests/publication.rs` proves editing the
  ticket after a passed review refuses publication and reconciliation with
  `publication.refused` of kind `source_changed`, nothing pushed and the
  reviewed evidence kept. The pure guard and expiry rules have unit tests.
  Real-CLI tests (`--ignored`) cover the memory correction staling the plan
  that selected it, the personal export with and without a leaking record,
  and retention deleting only the expired process record under the ledger;
  they need the pinned Bun and populated component checkouts and were not
  runnable on the authoring host (Bun 1.4.2 against the 1.4.3 pin, no
  component `node_modules`), so they remain evidence to collect.
- Clients: `packages/api-client/test` covers the new methods and the shared
  builders; `packages/tui/test/commands.test.mjs` asserts the bodies `register`,
  `plan`, `implement --task`, `edit-ticket`, `baseline`, `set-retention` and
  `correct-memory` send; `apps/desktop/src/*.test.tsx` asserts the desktop
  builds the same bodies through the same builders, renders one baseline
  control per repository with its status, shows the resume control only in
  the resumable states, and offers the edit, correction, export and retention
  controls; `apps/desktop/src/capabilities.test.ts` checks the state-specific
  `runs.implement` controls and the `required_by` trace.
- Still open: the real-CLI evidence above; terminal tones and the keyboard
  audit of ADR 0020; retention of raw transcripts and execution logs (this
  policy covers durable expertise records only); import of an export.
