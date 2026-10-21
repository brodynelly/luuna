# Current Luuna architecture

Windows native development startup invokes a fixed local bootstrap command,
starts or authenticates/reuses the independent runtime and connects without
manual token entry. DPAPI records live in `%USERPROFILE%\.luuna\credentials`;
existing encrypted LocalAppData records migrate once without deleting them.
Tokens reach the view through local IPC and stay in memory. Closing the window
leaves the service running. See [ADR 0011](decisions/0011-windows-native-bootstrap.md)
for the command boundary, reconciliation and checkout-based distribution limits.

Date: 2026-10-16, updated 2026-10-17 for M2a, M2b, M2c and the M3 implementation, and 2026-10-21 for re-validation after a review that left no verdict, shutdown interruption, client hardening the desktop design system and explicit component runtime workflows. Status: authoritative foundation baseline; implementation evidence is required for each milestone.

## Purpose and precedence

Luuna is a local-first development workbench for one developer working across related repositories. Its runtime coordinates scoped Pi sessions, exact-plan approval, actual checks, independent review, durable evidence, and eventually linked pull requests. The developer decides when to merge.

For new work, apply the following order:

1. Explicit current user requirements and repository-wide safety/security rules.
2. This document and accepted records in `docs/decisions/`; a later accepted decision must update this summary.
3. `docs/02-requirements.md` for full-v1 functional requirements not explicitly revised here.
4. The desktop/Pi RPC proposal for detailed design rationale.
5. The numbered design chapters, complete reference reading copies, diagrams, and examples as historical material.

README and AI-START-HERE are entry points, not alternative specifications. Existing source and tests show implemented behavior; they do not silently override a requirement. When an implementation differs, record the gap or an explicit decision.

## Delivery and boundaries

The initial client is Tauri 2 with React and TypeScript. An independent Rust service uses Tokio, an authenticated Axum API, and local SQLite persistence. Pi RPC subprocesses execute agent assignments. A client cannot directly authorize tools or decide that validation succeeded.

```text
Tauri/React client ── authenticated HTTP + resumable SSE ── Rust runtime
                                                          ├── SQLite + private artifacts
                                                          ├── supervised Pi RPC workers
                                                          ├── Git/worktree ownership
                                                          ├── deterministic check executor
                                                          └── versioned external adapters
```

Desktop-first is a sequencing decision. Browser/TUI capability parity, multiple related repositories, scoped memory, and Mac/Windows support remain full-v1 obligations. They are not exit criteria for the first single-repository foundation demo. No hosted service, mandatory NAS, GPU, automatic merge, custom agent loop, or full IDE replacement is required.

The desktop client's presentation follows one token-based design system ([ADR 0013](decisions/0013-desktop-design-system.md), [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)): six outcome tones mapped from the API unions, where only passed evidence is green and interruption is never failure, both colour schemes and WCAG AA enforced by tests. It changes how runtime state is shown, never what the runtime decides.

The workspace should add crates when they contain a real contract or implementation: domain, storage, runtime/API, engine/Pi, Git, executor, validation, and external adapters. Shared frontend packages are created when an actual shared consumer needs them. Empty placeholders do not establish implementation progress.

## Runtime ownership

Only the Rust runtime may enforce state transitions, immutable plan hashes, approval scope, execution permissions, task dependencies, limits, retries, candidate identity, check evidence, review acceptance, and publication gates. Agents provide proposals and worker output. Deterministic runtime code produces authoritative domain events.

An approval binds to the complete canonical executable plan, its revision and hash, repository scope, base commits, check recipes, resource profiles, and budgets. Feature implementation requires a valid approval and a passing baseline. New code, rebases, dependency changes, and manual edits invalidate affected evidence. Review and publication refer to exact candidates; model text saying “passed” is never command evidence. The desktop displays the entire immutable plan and full hash and requires acknowledgment before enabling approval. Managed Git checkout, status, staging and commit disable configured clean, smudge and process filters with per-command overrides; these operations do not authorize repository-configured commands.

Native execution uses host permissions. Stronger isolation requires an explicitly configured execution profile with actual operating-system or container boundaries. Preserve developer changes and only clean up resources whose Luuna ownership is verified.

## Persistence and ticket authority

SQLite owns Luuna projects, immutable plan revisions, approvals, run/attempt lifecycle, sequenced events, check/review evidence, artifact references, and publication reconciliation. State mutation and emitted durable domain events must be committed consistently. Sensitive transcripts and provider data remain private artifacts with controlled access and retention.

The schema is versioned and append-only. At startup the runtime refuses a database that fails SQLite's quick check or was written by a newer schema, before writing anything to it. It applies only missing migrations, after an automatic pre-migration snapshot under `<data>/backups/`. `luuna-runtime backup` takes a consistent online snapshot. `luuna-runtime restore` needs the runtime stopped, verifies the snapshot, and moves the current database and its `-wal`/`-shm` aside before installing it. `luuna-runtime check` reports integrity and schema version. A snapshot covers the database only; artifacts and worktrees are files, so a complete backup is the data directory copied after an orderly stop. Startup recovery skips records it cannot decode, logs them by table and ID, and still settles their state where it can. See [ADR 0015](decisions/0015-storage-backup-and-schema-compatibility.md).

Baselines are runs: `POST /api/v1/projects/{id}/baselines` executes a repository's confirmed required recipes through the supervised executor and records `CheckResult` evidence bound to the manifest hash, exact commit and tree, and an environment fingerprint, with private hashed artifacts. `Implementing` is entered only through the transactional gate that re-checks the approval, the current manifest and a passed matching baseline per repository; see [ADR 0007](decisions/0007-baseline-executor.md). One baseline per repository runs at a time. Every check's process group is recorded; whatever a check leaves running is terminated before its result is recorded, and startup recovery terminates verified survivors of checks a hard-killed runtime left behind (Windows checks run in kill-on-close job objects). Missing tools or dependencies and checks cut short by the workflow budget are blocked infrastructure, never failures a repair is asked to fix (ADR 0007 amendment, 2026-10-21).

Projects are registered from existing repositories. The confirmed **project manifest** (`schemas/project.schema.json`, hashed with `luuna-json-v1`) is machine-independent and append-only by revision; the **machine registry** maps each repository ID to its local path and the identity observed at registration (the redacted configured remote plus the root commits reachable from HEAD). A later observation must show an equivalent remote and contain those roots; only an explicit, evented rebind changes a binding. A checkout is registered once and never overlaps the runtime data directory. Discovery proposals and project-scoped events (`project.registered`, `repository.registered`, `repository.rebound`, `discovery.proposed`, `manifest.confirmed`) are durable, and replaying the project stream reconstructs the confirmed map. Inspection never writes to a repository or executes its text, including filters configured in submodules; see [ADR 0006](decisions/0006-repository-import.md).

Legacy projects retain the explicitly temporary SQLite ticket source until component activation. `POST /api/v1/projects/{id}/components` durably initializes the private component workspace and migrates tickets while preserving IDs and numeric revisions. Enabled projects use Missions (Seeds-derived) as authority for ticket intent, acceptance criteria, status, dependencies and source fingerprints; SQLite stores its revision-aware projection and Luuna execution state. GET/list return the last reconciled projection; `GET /api/v1/tickets/{id}/source` reports actual source freshness and `POST /api/v1/tickets/{id}/reconcile` requires the expected projection revision. External edits advance the reconciled revision and invalidate stale plans; freshness, ticket readiness and dependencies are rechecked at runtime work/evidence boundaries. Missing components fail closed. There are never two independently writable authorities for these fields. See [ADR 0003](decisions/0003-ticket-authority.md) and [ADR 0014](decisions/0014-runtime-component-workflows.md).

## Pi and maintained components

Pi is the agent engine, not the scheduler or validation authority. The engine contract supervises process creation, assignments, followups, events, stop requests, inspection, and disposal. Use a tested pinned release, strict JSONL framing, command correlation, bounded buffers, timeouts, and owned child-process cleanup. Stderr is diagnostic data. Prompt acceptance and agent settlement are separate events. Persist attempts so interrupted processes cannot become successful runs after restart.

Luuna maintains three branded CLI distributions: **Missions** (`@luuna/missions-cli`, Seeds-derived), **Atlas** (`@luuna/atlas-cli`, Mulch-derived), and **Beacon** (`@luuna/beacon-cli`, Canopy-derived). They live under `components/missions`, `components/atlas`, and `components/beacon` as separate package and integration boundaries. Preserve compatible underlying APIs/data formats, upstream copyright and MIT notices. Prefer adapters over rewrites or direct SQLite access to their records.

The owner resumed extraction on October 21, 2026 and explicitly authorized public component repositories. Missions, Atlas and Beacon now live in `brodynelly/luuna-missions`, `brodynelly/luuna-atlas` and `brodynelly/luuna-beacon`; Luuna stays private and consumes exact-commit Git submodules at the existing components paths. The manifest and gitlinks bind dependency identity; setup uses frozen Bun locks without lifecycle scripts, and consumer smoke checks exercise real CLI/JSON operations. Each destination owns its CI and source; registry packages remain private and unpublished. See [ADR 0012](decisions/0012-independent-component-repositories.md), superseding ADR 0002's hosted-extraction deferral.

The runtime now invokes these pinned CLIs through `luuna-components` with bounded input/output, a fixed stdin bridge, isolated HOME/config, sanitized environment, source/toolchain verification and owned process cleanup. Explicit per-project activation uses `<data_dir>/components/projects/<id>`; explicit user memory uses `<data_dir>/components/user`. It never adopts developer or imported stores. Atlas memory exposes explicit scope and provenance; Beacon exposes versioned prompt preview/update. A user selects resources for a plan, whose canonical optional `component_context` contains their exact snapshots, identities and hashes. The runtime rejects changed selected sources at approval and execution/evidence boundaries and gives workers only approved bounded content. Durable intent ledgers reconcile uncertain component writes before retry. Imported development metadata is not runtime data or permission to load instructions into agents. See [ADR 0014](decisions/0014-runtime-component-workflows.md) for activation, ticket reconciliation, resource selection and native-process limits; broader M6 parity, privacy policy and supported-platform evidence remain obligations.

## Candidate validation and review

Migration 5 stores exact candidate commit/tree identities, append-only validation generations and structured independent reviews. `POST /api/v1/runs/{id}/validate` names the expected hash and optionally `auto_repair`; it executes the approved required recipes inside the owned candidate worktree and starts a fresh read-only Pi reviewer only after the checks pass. Checks and reviews cannot be reused across candidate revisions or interrupted generations. A `failed` candidate whose required checks all passed in its current generation and whose reviewer left no verdict (invalid or self-inconsistent output, a refused session) may re-enter validation in place as generation `n+1`: same revision, approval and budgets, fresh checks and a fresh reviewer, no writer attempt; `GET …/candidate` reports that decision as `revalidate_allowed`. `GET …/candidate` and `GET …/diff` expose authoritative evidence and exact diffs; `POST …/repair` rechecks current approval, baseline/host and remaining aggregate budgets before creating the next scoped candidate. Model output never supplies command evidence. Repair writers receive the previous candidate's reason, check records, review and a bounded tail of each failed check log, never the private artifact paths. See [ADR 0009](decisions/0009-candidate-validation-review.md).

Since the second 2026-10-21 amendment to ADR 0009, every validation generation starts from the candidate tree alone: the owned worktree is verified and its untracked and ignored paths are removed and recorded. Content drift fails the candidate with a reason naming the change and the next step and is never re-validated in place. Review diffs ignore attributes that hide changes and are bounded with every changed path listed; a non-passing review must name a finding; reviewer tool calls are recorded by tool and path. `GET …/candidate` reports `validate_allowed` and `decision_reasons` from the gates the routes apply.

Automatic repair is opt-in and bounded by both the immutable plan and project repair policy. Infrastructure errors stop without repeated edits. Interrupted check stages retain elapsed usage; interrupted model stages reserve unknown spend and require re-planning when headroom is exhausted. Review success is evidence for an exact candidate only; publication and human-controlled merge remain separate gates.

## API and service lifetime

All application routes use `/api/v1`. Implemented project routes are `POST /api/v1/projects` (register existing repositories by absolute root path), `GET /api/v1/projects[/{id}]`, `POST /api/v1/projects/{id}/discover` (read-only proposal), `PUT /api/v1/projects/{id}/manifest` (confirm with `expected_revision`), `POST /api/v1/projects/{id}/repositories/{repository_id}/rebind` (explicitly re-point a moved or re-identified checkout) and `GET /api/v1/projects/{id}/events`. The canonical create-ticket route is **`POST /api/v1/projects/{id}/tickets`** (implemented in M2c with an idempotency key; enabled projects use the Missions authority of ADRs 0003/0014). Do not add a parallel `POST /api/v1/tickets` alias. Other operations address ticket, plan, and run identities: `POST /api/v1/tickets/{id}/plans` records the next immutable plan revision and opens its workflow run, `POST /api/v1/plans/{id}/approvals` approves one exact hash, `POST /api/v1/runs/{id}/implement` schedules the writer after transactional revalidation, and `GET /api/v1/runs/{id}/worktrees` and `/attempts` expose the Luuna-owned worktree leases and attempts (ADR 0008). Commands that can create work require idempotency; operations sensitive to stale state require expected revisions. SSE streams use durable event IDs/cursors for replay and deduplication. Artifacts use authorized IDs, never arbitrary request-supplied filesystem paths.

Bind the development service to loopback and authenticate protected API actions. A development launch may use an explicitly managed foreground process. The desktop reconnects to that service; closing a window or losing SSE does not decide run lifetime. Explicit shutdown stops or reconciles owned workers and persists interruption: since 2026-10-21 work stopped by Ctrl+C or SIGTERM is recorded `interrupted` (resumable after restart), never `cancelled`, and the client shows a lost runtime as an outage, reconnects by itself and reloads authoritative state when the runtime answers again. A Tauri child/sidecar alone does not prove independent lifetime. Platform-specific startup, supervision, token storage, and shutdown must be tested before distribution. See [ADR 0004](decisions/0004-service-lifecycle.md).

## Milestone evidence

Windows orderly service stop is `POST /api/v1/shutdown`, authenticated with the
existing bearer token. The runtime closes scheduling admission, drains admitted
mutation handlers, interrupts owned work and exits cleanly; window closure is
still only a client disconnect. Windows scripts reuse the DPAPI-encrypted token
and data directory across restart. See [ADR 0010](decisions/0010-authenticated-service-shutdown.md).

The initial tool-free connectivity slice exposes authenticated run creation/history, cursor event replay and SSE, and cancellation. M2a adds read-only repository import, discovery proposals and confirmed manifest revisions; M2b adds supervised baselines with bound evidence; M2c adds temporary local tickets, immutable plan revisions, exact-hash approvals, Luuna-owned worktree leases and one scoped writer whose candidate waits in `validating`. M3 adds candidate-bound required checks, a fresh read-only reviewer, structured findings, optional bounded automatic repairs and conservative restart recovery; its genuine-provider exit is closed on Linux (see the status report) while native Mac/Windows lifecycle evidence remains open. The bounded M6 component slice adds explicit Missions migration/reconciliation and selected Atlas/Beacon plan resources. Publication, broader M6 parity and supported-platform exits remain separate capabilities.

| Milestone | Required proof | Does not establish completion |
| --- | --- | --- |
| M0 | Locked build, schema fixtures, deterministic approval/transition rejection, durable state checks | Folder creation or documentation checks alone |
| M1 | Real pinned Pi/provider session, streamed API events, persistence, cancellation, error handling and restart evidence | Scripted worker or fixture-only protocol tests |
| M2a | Real and synthetic imports with byte-identical checkouts, rejected invalid/mismatched repositories, proposed (not executed) recipes, confirmed manifest replay after restart | A proposed manifest, a stored recipe, or any claim that a baseline ran |
| M2b | Genuine passing and failing baselines with commit/tree/environment-bound results and hashed artifacts; missing executable, empty suite, dirty checkout, deadline, cancellation and restart recorded as blocked/failed/cancelled/interrupted; stale baseline cannot enter implementation | A writer, a worktree, or any run that modifies a repository |
| M2c | One approved fixture feature changed only its Luuna-owned worktree with the developer checkout byte-identical; missing or stale approval, changed base, changed recipe, unrelated repository or path, stale baseline, second writer and exceeded budget refused; cancellation and restart preserve the worktree and void the attempt; a genuine pinned-Pi writer run through a real provider | Validation of the candidate, independent review, repair or any publication (M3+); any claim that prompt or guard scoping is an OS boundary |
| M3 | Candidate commit/tree/hash frozen; required checks executed in the owned worktree before any review; a fresh, separately identified read-only reviewer whose structured verdict the runtime enforces; a seeded failing check needing a new repair revision with fresh evidence; bounded automatic repair pausing at the attempt budget; cancellation and hard-kill recovery with reaped children and reserved spend; a genuine provider-backed run of all of the above (closed on Linux, October 17, 2026) | Fixture reviewer verdicts as provider evidence; a model's self-assessment as check evidence; native Mac/Windows lifecycle, which stays open; any publication or merge |
| Desktop integration | Real service connection, run actions, streamed state and reconnection | Frontend build or decorative simulation alone |
| Full v1 | Original requirements/acceptance matrix including browser/TUI parity and supported platform evidence | Single-repository Linux demo |

Required foundation checks are schema validation, Rust formatting/tests/lint, frontend type/build checks, and relevant fixture integration tests. Native desktop compilation requires platform prerequisites. Real provider smoke tests require existing credentials/model access and are reported separately. Mac/Windows jobs provide compatibility evidence only when they have actually run.

Luuna's original code and documentation are MIT licensed. Derived component distributions retain separate upstream notices. The original `VALIDATION-REPORT.md` validates a documentation delivery; keep product evidence separate. Package publication, signed installers, remote access, and production release still require explicit operational decisions and evidence.
