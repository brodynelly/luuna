# Current Luuna architecture

Date: 2026-10-16, updated 2026-10-17 for M2a, M2b and M2c. Status: authoritative foundation baseline; implementation evidence is required for each milestone.

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

The workspace should add crates when they contain a real contract or implementation: domain, storage, runtime/API, engine/Pi, Git, executor, validation, and external adapters. Shared frontend packages are created when an actual shared consumer needs them. Empty placeholders do not establish implementation progress.

## Runtime ownership

Only the Rust runtime may enforce state transitions, immutable plan hashes, approval scope, execution permissions, task dependencies, limits, retries, candidate identity, check evidence, review acceptance, and publication gates. Agents provide proposals and worker output. Deterministic runtime code produces authoritative domain events.

An approval binds to the complete canonical executable plan, its revision and hash, repository scope, base commits, check recipes, resource profiles, and budgets. Feature implementation requires a valid approval and a passing baseline. New code, rebases, dependency changes, and manual edits invalidate affected evidence. Review and publication refer to exact candidates; model text saying “passed” is never command evidence. The desktop displays the entire immutable plan and full hash and requires acknowledgment before enabling approval. Managed Git checkout, status, staging and commit disable configured clean, smudge and process filters with per-command overrides; these operations do not authorize repository-configured commands.

Native execution uses host permissions. Stronger isolation requires an explicitly configured execution profile with actual operating-system or container boundaries. Preserve developer changes and only clean up resources whose Luuna ownership is verified.

## Persistence and ticket authority

SQLite owns Luuna projects, immutable plan revisions, approvals, run/attempt lifecycle, sequenced events, check/review evidence, artifact references, and publication reconciliation. State mutation and emitted durable domain events must be committed consistently. Sensitive transcripts and provider data remain private artifacts with controlled access and retention.

Baselines are runs: `POST /api/v1/projects/{id}/baselines` executes a repository's confirmed required recipes through the supervised executor and records `CheckResult` evidence bound to the manifest hash, exact commit and tree, and an environment fingerprint, with private hashed artifacts. `Implementing` is entered only through the transactional gate that re-checks the approval, the current manifest and a passed matching baseline per repository; see [ADR 0007](decisions/0007-baseline-executor.md).

Projects are registered from existing repositories. The confirmed **project manifest** (`schemas/project.schema.json`, hashed with `luuna-json-v1`) is machine-independent and append-only by revision; the **machine registry** maps each repository ID to its local path and the identity observed at registration (redacted remote plus root commits). Discovery proposals and project-scoped events (`project.registered`, `repository.registered`, `discovery.proposed`, `manifest.confirmed`) are durable, and replaying the project stream reconstructs the confirmed map. Inspection never writes to a repository or executes its text; see [ADR 0006](decisions/0006-repository-import.md).

Before the Missions adapter is integrated, a minimal SQLite ticket record may support the M0/M1 demo. It is explicitly temporary. After integration, Missions (Seeds-derived) owns ticket intent, acceptance criteria, dependencies, and source revisions; SQLite stores a revision-aware projection and Luuna execution state. There must never be two independently writable authorities for the same ticket fields. External edits invalidate stale planning assumptions and block scheduling until reconciliation. See [ADR 0003](decisions/0003-ticket-authority.md).

## Pi and maintained components

Pi is the agent engine, not the scheduler or validation authority. The engine contract supervises process creation, assignments, followups, events, stop requests, inspection, and disposal. Use a tested pinned release, strict JSONL framing, command correlation, bounded buffers, timeouts, and owned child-process cleanup. Stderr is diagnostic data. Prompt acceptance and agent settlement are separate events. Persist attempts so interrupted processes cannot become successful runs after restart.

Luuna maintains three branded CLI distributions: **Missions** (`@luuna/missions-cli`, Seeds-derived), **Atlas** (`@luuna/atlas-cli`, Mulch-derived), and **Beacon** (`@luuna/beacon-cli`, Canopy-derived). They live under `components/missions`, `components/atlas`, and `components/beacon` as separate package and integration boundaries. Preserve compatible underlying APIs/data formats, upstream copyright and MIT notices. Prefer adapters over rewrites or direct SQLite access to their records.

The owner's explicit October 16, 2026 decision is to keep the application and all three components in `brodynelly/luuna` and defer separate repositories. Continue implementation in this monorepo; extraction is not a milestone prerequisite. No independent hosted repositories or published packages are claimed. Later extraction requires renewed scope, verified destination repositories, source/history provenance, preserved notices, CI/release ownership, and tested dependency consumption before deleting copies. See [ADR 0002](decisions/0002-supporting-components.md). Imported development metadata is not Luuna runtime data or permission to load stale instructions into agents.

## API and service lifetime

All application routes use `/api/v1`. Implemented project routes are `POST /api/v1/projects` (register existing repositories by absolute root path), `GET /api/v1/projects[/{id}]`, `POST /api/v1/projects/{id}/discover` (read-only proposal), `PUT /api/v1/projects/{id}/manifest` (confirm with `expected_revision`) and `GET /api/v1/projects/{id}/events`. The canonical create-ticket route is **`POST /api/v1/projects/{id}/tickets`** (implemented in M2c with an idempotency key; the record is the temporary local source of ADR 0003). Do not add a parallel `POST /api/v1/tickets` alias. Other operations address ticket, plan, and run identities: `POST /api/v1/tickets/{id}/plans` records the next immutable plan revision and opens its workflow run, `POST /api/v1/plans/{id}/approvals` approves one exact hash, `POST /api/v1/runs/{id}/implement` schedules the writer after transactional revalidation, and `GET /api/v1/runs/{id}/worktrees` and `/attempts` expose the Luuna-owned worktree leases and attempts (ADR 0008). Commands that can create work require idempotency; operations sensitive to stale state require expected revisions. SSE streams use durable event IDs/cursors for replay and deduplication. Artifacts use authorized IDs, never arbitrary request-supplied filesystem paths.

Bind the development service to loopback and authenticate protected API actions. A development launch may use an explicitly managed foreground process. The desktop reconnects to that service; closing a window or losing SSE does not decide run lifetime. Explicit shutdown stops or reconciles owned workers and persists interruption. A Tauri child/sidecar alone does not prove independent lifetime. Platform-specific startup, supervision, token storage, and shutdown must be tested before distribution. See [ADR 0004](decisions/0004-service-lifecycle.md).

## Milestone evidence

The initial executable implementation is a tool-free connectivity slice, not the approved implementation workflow. It exposes authenticated run creation/history, cursor event replay and SSE, and cancellation; the UI currently reconnects through replay polling. M2a adds read-only repository import, discovery proposals and confirmed manifest revisions; M2b adds supervised baselines with bound evidence; M2c adds temporary local tickets, immutable plan revisions, exact-hash approvals, Luuna-owned worktree leases and one scoped writer whose candidate waits in `validating`. Seeds/Missions reconciliation, candidate validation, independent review, and publication remain subsequent capabilities.

| Milestone | Required proof | Does not establish completion |
| --- | --- | --- |
| M0 | Locked build, schema fixtures, deterministic approval/transition rejection, durable state checks | Folder creation or documentation checks alone |
| M1 | Real pinned Pi/provider session, streamed API events, persistence, cancellation, error handling and restart evidence | Scripted worker or fixture-only protocol tests |
| M2a | Real and synthetic imports with byte-identical checkouts, rejected invalid/mismatched repositories, proposed (not executed) recipes, confirmed manifest replay after restart | A proposed manifest, a stored recipe, or any claim that a baseline ran |
| M2b | Genuine passing and failing baselines with commit/tree/environment-bound results and hashed artifacts; missing executable, empty suite, dirty checkout, deadline, cancellation and restart recorded as blocked/failed/cancelled/interrupted; stale baseline cannot enter implementation | A writer, a worktree, or any run that modifies a repository |
| M2c | One approved fixture feature changed only its Luuna-owned worktree with the developer checkout byte-identical; missing or stale approval, changed base, changed recipe, unrelated repository or path, stale baseline, second writer and exceeded budget refused; cancellation and restart preserve the worktree and void the attempt; a genuine pinned-Pi writer run through a real provider | Validation of the candidate, independent review, repair or any publication (M3+); any claim that prompt or guard scoping is an OS boundary |
| Desktop integration | Real service connection, run actions, streamed state and reconnection | Frontend build or decorative simulation alone |
| Full v1 | Original requirements/acceptance matrix including browser/TUI parity and supported platform evidence | Single-repository Linux demo |

Required foundation checks are schema validation, Rust formatting/tests/lint, frontend type/build checks, and relevant fixture integration tests. Native desktop compilation requires platform prerequisites. Real provider smoke tests require existing credentials/model access and are reported separately. Mac/Windows jobs provide compatibility evidence only when they have actually run.

Luuna's original code and documentation are MIT licensed. Derived component distributions retain separate upstream notices. The original `VALIDATION-REPORT.md` validates a documentation delivery; keep product evidence separate. Package publication, signed installers, remote access, and production release still require explicit operational decisions and evidence.
