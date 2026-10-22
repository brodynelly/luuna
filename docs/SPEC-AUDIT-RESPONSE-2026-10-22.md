# Response to the October 22, 2026 specification audit

Date: 2026-10-22. Audited revision: `87a7e3fea0416551e9ba61195ec5fff8f90a1989`
([SPEC-AUDIT-2026-10-22.md](SPEC-AUDIT-2026-10-22.md)). This document records,
per finding, what was implemented on the `fix/vibrant-knuth-xt945c` branch, the
evidence that ran on the Linux development container, and what still needs a
host, a credential or a decision this branch could not supply. It does not grant
the v1 label; [RELEASE-EVIDENCE.md](RELEASE-EVIDENCE.md) carries the updated
matrix and the remaining blockers.

Host: Linux x64 container, Rust 1.90.0, Node 22.22.0, Bun 1.4.3 (installed
beside the host's 1.4.2 for the real component CLIs), Python 3, Git. Hosted CI
on GitHub could not start any job on this branch or on `main` (the jobs end in
seconds with no log; the merges of PR 12 and 13 record the same account-level
condition), so every result below is a local run.

## Findings requiring implementation work

### 1. Publication revalidates every authoritative input — done

ADR 0018, 2026-10-22 amendment. Publication and reconciliation reuse the
validation/repair authorization gate (`Store::authorize_workflow`: the approval
must authorize the latest plan revision; ticket and manifest bindings must hold),
re-resolve the ticket revision and approved component context
(`verify_plan_sources`), verify every repository's Luuna-owned worktree against
the frozen candidate (`content_drift`; drift invalidates the candidate through
`invalidate_reviewed_candidate`, `candidate.invalidated`, run `reviewed ->
failed`), and run a deterministic pre-push policy over the exact patch
(`crates/luuna-runtime/src/policy.rs`: approved scope by the writer task,
credential-store paths, credential-shaped content on added lines including
Git-quoted paths and hunk content, binary blobs read and scanned, known runtime
credential values; findings never carry values; a refused candidate is failed so
`POST …/repair` is admitted). Refusals are `publication.refused` events.

Evidence: `crates/luuna-runtime/tests/publication.rs` (13 scenarios, including
both reproduced probes and their reconciliation variants, the `write_secret`
policy scenario, ticket editing after review as `source_changed`, and the CI
repair of finding 5) and `crates/luuna-runtime/tests/publication_multirepo.rs`
(5 linked-set scenarios). Codex's review of the scanner found five defects
(multibyte key boundary, quoted JSON keys, Git-quoted headers, binary
summaries, no repair after refusal), three more on the second round (hunk
content that looks like a header, advisory task selected for scope, packaged
TypeScript under `node_modules`) and, on the fourth round, that a repair of a
refused candidate kept the credential-bearing commit as a published ancestor:
the policy now scans every commit the push would publish on its own patch, and
a repair after a policy refusal starts history-clean from the approved base
(`policy_refused` on the candidate). All are fixed with tests (the ancestor
case is reproduced end to end in `publication.rs`).

### 2. Client parity — implemented at behaviour level; interactive audit open

ADR 0026. Multi-repository registration (desktop rows, TUI repeated
`--repository`), per-repository baselines with status, task-graph planning with
`max_workers` and dependencies through one shared request builder used by both
clients, per-task resume from the task graph, ticket editing
(`PUT /api/v1/tickets/{id}`, legacy and Missions), memory correction
(`PUT …/memory/{id}`), personal memory export (`GET /api/v1/memory/user/export`)
and a per-project retention policy with explicit application. The catalog grew
from 50 to 58 actions (59 with the later `doctor` read of the settings surface), every entry carries `required_by`, and
`scripts/check-contracts.mjs` traces 14 specification obligations to cataloged
actions with desktop and TUI controls. Behaviour-level tests assert request
bodies and state-specific controls. The desktop and terminal clients also
surface the testing-setup offer and setup plan (finding 3), task roles,
derivation and dependency overrides with assignment traces and advisory
results (finding 4), and the Home summary, the Kanban projection, the Help
panel and the editor handoff (ADR 0027 point 4, dated note) through a shared
projection module and read-only cataloged reads, and the Settings panel as the
runtime's own doctor report (`GET /api/v1/doctor`); `check-contracts` traces 16
required actions and 5 required surfaces. Still open: the interactive terminal
keyboard and width audit (ADR 0027 point 5).

### 3. Testing-setup prerequisite workflow — done

ADR 0022. A blocked baseline with no usable testing setup (no required checks,
or every required check exiting 0 with no recognised test) offers a prerequisite
(`baseline.prerequisite_offered`, `prerequisite` on the implement refusal, the
baselines list and the project view). A `testing_setup` ticket and plan (purpose
hashed into the plan; the `testing-setup` role; the check recipes proposed in
the plan) are admitted to implementation without a passing baseline; all other
gates hold. The candidate's required checks must execute at least one recognised
test (`tests_detected > 0`), so a skip-only harness settles `testing_blocked`.
The handoff to the baseline (confirm the manifest with the recipes, merge, run
the baseline) is explicit on the candidate view; feature plans made before that
remain refused. Evidence: `crates/luuna-runtime/tests/testing_setup.rs` (3
scenarios, full loop from refusal to a feature writer admitted with a real
baseline). Both clients show the offer, create the setup ticket and send the
setup plan with its check recipes through the shared request builder.

### 4. Delegated roles and dependency overrides — done for v1 scope

ADR 0023. Task roles `implementer`, `repository_lead`, `project_orchestrator`
(and `testing-setup` from ADR 0022) with `agents/` contracts as system prompts;
advisory roles read only, record a bounded structured advisory result and fail
on any change; assignment traces (`assigned_by`, `derived_from_task`, role,
dependencies, overrides, attempt) on every task row and `task.*` event; plans
checked against confirmed relationships with justified `waive`/`add`
`dependency_overrides` in the hashed plan. No runtime-created child tasks: a
proposal becomes a task only through a developer-approved revision naming its
parent. Evidence: four new scenarios in `crates/luuna-runtime/tests/multirepo.rs`
and domain unit tests. Open: specialist sub-roles as plan tasks, shared contract
artifacts beyond producer worktree and commit, and a genuine-provider
multi-repository run.

### 5. Publication obligations — CI repair and linked sets done; real GitHub open

ADR 0018 second amendment. `POST /api/v1/runs/{id}/publication/repair` refreshes
the CI observation, requires an observed failure, applies the repair gate while
the candidate is still reviewed, invalidates the candidate naming the failing
checks, marks the record `superseded_by_repair`, and starts the repair writer
with a `ci_failure` evidence section; the repaired revision publishes a new pull
request whose body names the superseded one. Pre-push policy: finding 1. Linked
three-repository publication, partial-set recovery without duplicates, one-of-
several merged (not integrated) and all merged (integrated once) are tested
end to end against the fake GitHub API with real bare remotes
(`publication_multirepo.rs`). Real GitHub authentication, push, PR creation,
reconciliation and CI observation remain unverified: no credential or
repository was available, and the branch created no external resource other
than its own pull request.

### 6. Stack support — Next.js profile added; capable-host evidence open

A Next.js scaffold profile (offline template, network step by consent, hashed
confirmation; `crates/luuna-runtime/tests/scaffold.rs`) and the Node TypeScript
typecheck gap stated on the proposal. ADR 0027 proposes the v1 scope for
Android, iOS, Go, Flutter and React: discovery plus import and capability-gated
checks, with positive evidence required from a capable runner before R13 is
called complete. No such runner exists here.

### 7. Memory, portability and experience — import, controls and retention done

ADR 0021 amendment: `POST /api/v1/projects/import` imports an export on another
machine from local checkouts with the same identity, under the export's refusal
rules and the component intent ledgers; real-CLI round trip passed. Memory
correction, personal export and retention: finding 2. Container execution and
the experience surfaces are resolved as proposed decisions in ADR 0027.

### 8. Windows packaging — portable components and terminal client staged

ADR 0024. `scripts/stage-components.mjs` stages the pinned Missions, Atlas and
Beacon trees with a deterministic digest manifest and Bun 1.4.3;
`luuna-components` verifies that portable layout at discovery and before every
call; `doctor` reports the layout kind and Bun; the startup helper points the
runtime at the packaged components; the terminal client and a compiled
`@luuna/api-client` are staged and started once by the packager. The clean-
machine installer test is documented in [PACKAGING.md](PACKAGING.md) and has
not been executed: no Windows host and no PowerShell were available here.

## Defects found on the way

- Discovery named one missing Python tool twice on Unix (`python` and
  `python3`), failing a unit test on Linux only.
- The TUI package's test script could not resolve its test directory on
  Node 22 (`node --test test/`).
- Atlas's content-similarity guard refused any second short memory in a
  workspace, surfacing as an opaque 503; Luuna now records with `--force` and
  logs the component's structured error to the operator's log.
- A `node_modules` symlink committed by a worktree was not covered by the
  ignore rule (`**/node_modules/` matches directories only); the rule now
  covers links.
- Found by the fourth review round: a Missions ticket edit whose response was
  lost was refused on retry as an external edit before its ledger entry was
  consulted (now reconciled from the recorded intent); a mixed plan required
  the checks of an advisory-only repository that has no candidate commit (now
  only candidate repositories' checks are required, and an advisory-only plan
  needs none); the desktop's per-repository baseline control chose the oldest
  record because the API lists newest first.

## Checks run on this branch (Linux x64)

See the "October 22, 2026 update" section of
[RELEASE-EVIDENCE.md](RELEASE-EVIDENCE.md) for the counts. The hosted CI
condition and the local verification are also recorded on the pull request.

## Still blocked, in the audit's completion order

1. Genuine-provider runs (M3 harness on the current tree; a multi-repository
   feature) need a provider credential.
2. Real GitHub publication, reconciliation, CI observation and a human merge
   need a repository and token the owner provides.
3. Fresh-host Mac and clean-machine Windows installation, signing and update
   strategy, and the capable-runner stack evidence need those hosts.
4. The real-project pilot with the acceptance chapter's measurements.
5. The owner's decision on ADR 0027.
