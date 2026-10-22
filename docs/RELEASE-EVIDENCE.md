# Release evidence: M8 acceptance report (October 21, 2026)

This is the M8 report the roadmap requires: every binding requirement
(R01–R15) and acceptance scenario (A01–A34) linked to the evidence that exists,
with the platform matrix, known limitations and the checks that still block the
v1 label. It is written against the tree described in
[FOUNDATION-STATUS.md](FOUNDATION-STATUS.md); counts and results below are the
ones actually observed on the named host, never inferred from fixtures or from
a model's own statement. **The v1 label is not granted by this report.** The
blocking items are listed at the end.

Evidence kinds, as used in the tables:

- *deterministic*: `cargo test --locked --workspace` and `npm test` suites
  (synthetic Pi fixture, real Git, real host commands, real component CLIs
  where marked);
- *harness*: a lifecycle harness against a built runtime (`scripts/m1-smoke.mjs`,
  `scripts/m3-smoke.mjs`, `scripts/mvp-ui-smoke.mjs`, `scripts/tui-smoke.mjs`,
  `scripts/backup-recovery-drill.mjs`), synthetic unless marked *genuine*;
- *genuine*: a real pinned Pi 1.3.0 session through a real provider, recorded in
  the status report with sanitized identifiers;
- *native*: the bundled Windows WebView2 executable or the Windows runtime
  service, as recorded in [WINDOWS-VERIFICATION.md](WINDOWS-VERIFICATION.md)
  and [PR-11-WINDOWS-VERIFICATION.md](PR-11-WINDOWS-VERIFICATION.md);
- *none*: no evidence exists; the row blocks the label it belongs to.

## October 22, 2026 update (Linux development container)

The [October 22 specification audit](SPEC-AUDIT-2026-10-22.md) found eight
implementation gaps beyond the blocker list below. The
[response](SPEC-AUDIT-RESPONSE-2026-10-22.md) records what the
`fix/vibrant-knuth-xt945c` branch implemented (ADRs 0018 amendments,
0022–0027) and the dispositions below replace the corresponding rows of the
October 21 tables for the audited items; every other row stands as written.
The October 21 tables are kept unchanged as the Windows-host record.

| Item | October 22 disposition | Evidence (Linux, this branch) |
| --- | --- | --- |
| R02 / A33 client parity | behaviour-level parity for multi-repository registration, per-repository baselines, task-graph planning with roles, derivation and dependency overrides, task resume, ticket editing, memory correction, personal export and retention, the testing-setup offer and setup plan, and the Home summary, Kanban projection, Help panel, editor handoff and the Settings panel (the runtime's doctor report, ADR 0027 point 4); 16 specification obligations and 5 required surfaces traced through the catalog | 59-action catalog against 49 routes, `check-contracts.mjs` required-action and required-surface traces, desktop/client/TUI suites below, `scripts/tui-smoke.mjs`; the interactive TUI audit remains open (ADR 0027 point 5) |
| R06 delegated roles (P42) | implemented for v1: advisory roles, traces, no runtime-created children (ADR 0023); only candidate repositories' checks are required of a mixed plan | `multirepo.rs` 14 scenarios, domain tests |
| R05 dependency overrides (P44) | implemented: confirmed-relationship check with justified `waive`/`add` overrides in the hashed plan (ADR 0023) | `multirepo.rs` |
| R07 / R09 / E02 / E05 / E06 publication guards | superseded plan revision, worktree drift, source change and the pre-push policy refuse publication and reconciliation before any side effect; the policy scans every commit the push would publish and a repair after a refusal starts history-clean (ADR 0018 amendment) | `publication.rs` 15 scenarios (including a credential in an ancestor commit), policy unit tests, four Codex review rounds fixed |
| R08 / A06 testing prerequisite | offered prerequisite, approved `testing_setup` workflow admitted without a baseline, real-test pass rule (ADR 0022); both clients show the offer and send the setup plan | `testing_setup.rs` 3 scenarios; desktop, client and TUI tests |
| R10 / A24 CI-failure repair | bounded repair from an observed CI failure invalidates the published candidate; the repaired revision publishes a superseding pull request (ADR 0018 second amendment) | `publication.rs` |
| R11 / A22 / A25 linked sets | three-repository linked publication, partial-set recovery without duplicates, one-of-several merged is not integrated | `publication_multirepo.rs` 5 scenarios; real GitHub still **not established** |
| R13 / A05 stacks | Next.js scaffold profile; Android and iOS advertised as import plus capability-gated checks, Go/Flutter/React complete only with capable-runner evidence (ADR 0027 points 2 and 3, accepted on best estimate) | `scaffold.rs`; capable runners still absent, so those profiles stay **blocked** |
| R14 / A29 memory and portability | project import on another machine (ADR 0021 amendment), memory correction, personal export, retention policy (ADR 0026) | `projects.rs` synthetic import tests; real-CLI runtime tests 9/9, Missions 3/3, adapter 1/1, component smoke 14/14 with Bun 1.4.3 |
| R01 / A02 packaging | portable component layout with digest verification, Bun and the terminal client with a compiled API client staged by the packager (ADR 0024) | `stage-components` tests, `luuna-components` portable-layout tests, doctor; the installer was **not built** and no clean machine ran it (no Windows host here) |
| A14 / A26 drift after review | reproduced probe now refused; candidate invalidated, nothing pushed | `publication.rs` |
| A09 superseded revision | reproduced probe now refused for publication and reconciliation | `publication.rs` |
| Acceptance chapter measurements (pilot) | first pilot on a real repository (a fresh Luuna Beacon clone, 459 real tests) with the synthetic model: map, latency, large log, cancellation, overhead, memory, usage and SIGKILL recovery measured and inside the proposed targets ([PILOT-2026-10-22.md](PILOT-2026-10-22.md)) | `scripts/pilot-measurements.mjs` 8/8; genuine-provider pilot on a release host still owed |
| A32 container profile | out of v1 scope (ADR 0027 point 1, accepted on best estimate): established for the native profile, the `container` refusal stays as a scope decision, not a gap | execution-profile tests |

Checks on the branch's final revision, all local (hosted CI could not start):

| Check | Result |
| --- | --- |
| `cargo fmt --all -- --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings` | passed |
| `cargo test --locked --workspace -- --test-threads=2` | 460 passed, 0 failed, 16 ignored (the ignored tests are the real-CLI and genuine-provider tests run separately below) |
| `npm test` | 29 contract checks; 59-action catalog with 16 required actions and 5 required surfaces traced; 8 scope-guard, 8 component-pin, 8 harness; 291 desktop; 48 API-client; 83 TUI |
| `npm run typecheck`, `npm run build`, `node scripts/check-hygiene.mjs`, `git diff --check` | passed |
| `node scripts/components-smoke.mjs` (Bun 1.4.3) | 14/14 |
| `cargo test -p luuna-runtime --lib components_real_ -- --ignored` / `missions_real_` / `luuna-components --test real` | 9 / 4 / 1 passed |
| `node scripts/tui-smoke.mjs --runtime <release>` | 51/51 |
| `node scripts/m1-smoke.mjs --mode fixture` | 19/19 |
| `node scripts/backup-recovery-drill.mjs --skip-migration-tests` | 30/30 |
| `node scripts/mvp-ui-smoke.mjs` (Chromium) | 64/64 (Chromium, synthetic model, recovery and accessibility audit; rerun with the Home, Kanban and Help panels present) |
| `node scripts/m6-ui-smoke.mjs` (real component CLIs) | 23/23 (real Missions, Atlas and Beacon CLIs, Chromium) |
| `node scripts/m3-smoke.mjs --mode fixture` (strict) | 69/69 on committed revision `55e50ba` (an earlier run on `bb074bd` failed only its Luuna-checkout integrity check because a concurrent worktree was committing into the same `.git`; rerun on a quiet tree) |
| Genuine provider steps, real GitHub, native Windows/Mac, installer build | not run: no provider credential, no GitHub token or repository for the publisher, no Windows or Mac host |

Blocking the v1 label after this update: items 1–6 of the October 21 list
below still hold (the publication guard defects, client parity, P22, P42/P44,
A24 and the memory management gaps the audit added are closed), plus the
owner's decision on ADR 0027 and the interactive terminal audit it names (its point-4 surfaces now exist).

## Platform matrix

| Host | OS | Architecture | Git | Rust | Node / npm | Bun | Python | Pi | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Windows development host | Windows 11 Home 10.0.26300 | x64 | 2.55.0.windows.5 | 1.90.0 | 26.10.0 / 11.19.1 (pins 24.19.0 / 11.9.0 accepted as "or newer") | 1.4.3 | 3.11.9 | 1.3.0 (`tools/pi`, `npm ci --ignore-scripts`) | this report's Windows rows |
| Linux cloud container | Ubuntu (container) | x64 | 2.43.0 | 1.90.0 | 24.19.0 / 11.9.0 | 1.4.3 | 3.13.16 | 1.3.0 | historical M1–M3 and MVP gate rows in the status report |
| macOS | — | arm64 | — | — | — | — | — | — | **none**; Mac rows below are blocked |

## Requirement coverage (R01–R15)

| Requirement | Evidence | Kind | Status |
| --- | --- | --- | --- |
| R01 Local Mac/Windows operation without a NAS | Windows native lifecycle smoke (62/62 bundled WebView2, PR 11), authenticated shutdown (ADR 0010), bootstrap (ADR 0011), `scripts/package-windows.ps1` NSIS development installer built on this host (unsigned; packaged layout verified: runtime, helper scripts, launchers, pinned Pi tree beside the executable), `luuna-runtime doctor` (ADR 0018), backup/restore drill 31/31 on Windows | native, harness | Windows: development distribution on the development host. Mac: **blocked** (no host). Clean-machine and signed installation: **not established** |
| R02 Browser/TUI parity | capability catalog of 50 actions validated against the 43 served routes and the typed client (strict), 251 desktop, 39 client and 59 TUI tests, `scripts/tui-smoke.mjs` 53/53 (ADR 0020) | deterministic, harness | established for the cataloged actions; interactive-TUI keyboard audit open |
| R03 Pi with selected models | M1 20/20 genuine OpenRouter (Windows, PR 11); M3 genuine 61/61 at `fd42d59` on Linux and 59/61 at `631ed21` on Windows | genuine | established for the recorded revisions; a genuine run on the current tree is owed |
| R04 Import and creation | M2a import evidence; approved scaffolding with real baselines for the profiles this host can run (ADR 0019) | deterministic | import established; scaffolding established per profile only where a capable runner ran it |
| R05 Multiple repositories with explicit relationships | relationship proposals, acyclic confirmed graph, three-repository fixture with exact candidate commits (ADR 0017) | deterministic | established with the synthetic writer; no genuine multi-repository provider run |
| R06 Scoped coordination roles | task-level roles recorded per plan task and attempt; project orchestrator / repository-lead delegation (P42) | deterministic | partial: traceable per-task records exist; delegated role assignments remain M4 follow-up |
| R07 Approval before feature writes | M2c negative cases, maintained by every later suite | deterministic, genuine | established |
| R08 Meaningful passing baseline | M2b evidence; blocked infrastructure classification (ADR 0007 amendment) | deterministic, genuine | established |
| R09 Real checks and fresh review | M3 candidate-bound checks and reviewer (ADR 0009) | deterministic, genuine | established for the recorded revisions |
| R10 Bounded repair and useful pause | M3 budgets, interruption, re-validation in place | deterministic, genuine | established |
| R11 Automatic linked PRs | publisher with durable intents, reconciliation, CI observation against a fake GitHub API and a local bare remote (ADR 0018) | deterministic | **not established against GitHub**; fake-server evidence only |
| R12 Developer controls merging | no merge route or operation; router test asserts it; merge observed, never performed | deterministic | established by construction |
| R13 Supported stack profiles | discovery recipes for every advertised profile, host capability probing, blocked-capability questions (ADR 0019) | deterministic | established on this host for the tools it has; Flutter, Android, iOS: **blocked** unless a capable runner ran them |
| R14 Scoped memory | ADR 0014 scopes/provenance/deletion/retrieval; ADR 0021 promotion and scope-safe export with a real-CLI regression | deterministic (real CLIs) | established for the implemented scope policy; retention policy remains documentation |
| R15 Runtime outlives clients | M1 reconnect/restart, MVP gate outage reconnection, Windows native lifetime | harness, native | established on Linux and Windows |

## Acceptance scenarios (A01–A34)

| ID | Scenario | Evidence | Status |
| --- | --- | --- | --- |
| A01 | Fresh supported Mac installation | none | **blocked**: no Mac host |
| A02 | Fresh supported Windows installation | `scripts/package-windows.ps1` output and `luuna-runtime doctor`; existing-host native smoke | partial: development installer built on the development host; a clean machine has not run it |
| A03 | No NAS or cloud account | every harness runs on loopback with a local data directory | established |
| A04 | Existing three-repository import with proposed graph | relationship proposals from package/Cargo/go.mod evidence; unconfirmed relationships refused at confirmation (ADR 0017) | established (deterministic) |
| A05 | New project: approved scaffolding establishes tests first | scaffold proposal/confirmation with a real baseline before registration (ADR 0019) | established for the profiles run on this host |
| A06 | Missing tests block feature execution | M2b/M2c baseline gate; empty-suite guard | established |
| A07 | Empty or skip-only baseline does not pass | executor test-count heuristics incl. `unittest` | established |
| A08 | Existing failing baseline blocks | M2b failing baseline evidence | established |
| A09 | Unapproved or stale plan rejected | M2c negative cases | established |
| A10 | Material scope expansion needs new approval | exact-hash approval; new revision required | established |
| A11 | Two tasks compete for a worktree | one active lease per repository; multi-task scheduler respects it (ADR 0017) | established |
| A12 | Parallel repository tasks within limits | independent tasks concurrent up to `max_workers` with the hold fixture (ADR 0017) | established (synthetic) |
| A13 | Incompatible candidates block integration | consumer check failure fails the candidate set with the integration reason | established (synthetic writer, real checks) |
| A14 | Code changes after check/review go stale | content drift fails the candidate; publication requires a reviewed candidate | established |
| A15 | Independent reviewer | fresh session, no implementer transcript | established, genuine |
| A16 | Reviewer finds a blocking regression | M3 blocking review and repair | established, genuine (Linux) |
| A17 | Repair budget exhausted pauses with evidence | M3 attempt budget pause | established |
| A18 | Missing executable or credential is a setup blocker | blocked infrastructure classification; capability probing; doctor | established |
| A19 | Browser/TUI disconnect | MVP gate outage reconnection; TUI smoke restart | established |
| A20 | Service killed mid-task | hard-kill recovery, reserved spend, interrupted tasks | established |
| A21 | Cancel shell with grandchildren | process-group/Job Object termination | established on Linux and Windows |
| A22 | Publication partially succeeds | push succeeds, PR creation fails, reconcile retries only the PR step (fake GitHub) | established against a fake server |
| A23 | Publication times out after remote success | delayed fake response, reconcile finds the PR, no duplicate | established against a fake server |
| A24 | PR-created CI fails | CI observation reported distinctly | established against a fake server |
| A25 | One of several PRs merged | integrated only when all PRs are merged | established against a fake server |
| A26 | Manual edit in a task worktree | content drift fails the candidate and names the next step | established |
| A27 | Imported repository text requests a secret upload | inspection never executes repository text; writer scope guard; secrets redacted from repair feedback | established |
| A28 | Personal memory from another project | user memory listed only with explicit opt-in; export excludes it (ADR 0021) | established (real CLIs) |
| A29 | Project export without credentials or paths | export guard refuses credentials, host paths and user memory (ADR 0021) | established (real CLIs) |
| A30 | External Missions edit during a run | ADR 0014 source drift tests | established (real CLIs) |
| A31 | Required iOS check on an incapable host | capability probing marks `xcode` missing and blocks with an explanation | established on Windows; a Mac has not run the positive case |
| A32 | Native and container profiles | only `native` executes; `container` is accepted by the contract and refused at execution | established for the native profile; container execution is out of v1 scope by ADR 0027 point 1 (October 22) |
| A33 | Every client capability | catalog-driven parity tests | established for the cataloged actions |
| A34 | Automatic PR completion keeps human merge | publisher without a merge path | established against a fake server |

## Whole-tree checks on the final revision (Windows 11 x64)

| Check | Result |
| --- | --- |
| `cargo fmt --all -- --check` | passed |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | passed |
| `cargo test --locked --workspace` | 388 passed, 0 failed, 13 ignored (explicit real-CLI and platform tests) across 43 suites |
| `npm test` | 29 contract checks and the strict 50-action catalog; 10 scope-guard (9 passed, 1 Windows skip); 8 component-pin; 7 harness; 251 desktop; 39 API-client; 59 TUI |
| `npm run typecheck`, `npm run build`, `node scripts/check-hygiene.mjs`, `git diff --check` | passed |
| `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | passed |
| `node scripts/release-evidence.mjs` (sanitized report: [evidence/release-evidence-2026-10-21.json](evidence/release-evidence-2026-10-21.json)) | real component CLIs: component smoke passed, 6 explicit real-component and 3 real-Missions runtime tests passed; synthetic harnesses: M1 fixture passed, backup drill 30/30, browser walkthrough 64/64, component workflows 23/23, TUI walkthrough 53/53. The strict M3 fixture harness refuses an uncommitted tree; run after the commit on revision `e39b2b5` it passed 69/69 ([evidence/m3-fixture-e39b2b5-2026-10-21.json](evidence/m3-fixture-e39b2b5-2026-10-21.json)). Genuine steps were not run (no provider named). The first browser-smoke attempts failed for harness reasons (no Chromium path, a bare Bun name, a duplicated form label) and passed on the rerun after those fixes; one earlier walkthrough run failed a single check on a run-state badge race and passed on the rerun. |

## Known limitations

- No Mac evidence of any kind. Every Mac row is blocked, not failed.
- Publication has been exercised only against a local fake GitHub API and a
  local bare remote. Real GitHub evidence requires a repository and credential
  the owner provides and is reported separately when run.
- Installers are unsigned development distributions; SmartScreen will warn.
- Container execution profiles are a contract only.
- Repair of a multi-repository candidate set is re-planning; see ADR 0017.
- Import of a project export on another machine is not implemented.
- Pilot measurements (task completion, repairs, failures by cause, resource use)
  exist only for the bounded harnesses; no real-project pilot has run.
  (October 22: a synthetic-model pilot on a real repository has since run,
  [PILOT-2026-10-22.md](PILOT-2026-10-22.md); the genuine-provider pilot is
  still owed.)

## Blocking the v1 label

1. Mac installation and lifecycle (A01, R01).
2. Clean-machine Windows installation from the produced installer (A02).
3. Real GitHub publication, reconciliation and CI observation (R11, A22–A25).
4. Capable-runner evidence for Flutter, Android and iOS profiles (R13, A31).
5. A genuine-provider run of the M3 harness on the current tree, and a genuine
   multi-repository feature.
6. A real-project pilot with the measurements the acceptance chapter asks for
   (October 22: done with the synthetic model on a real repository; owed with
   a genuine provider on a release host).
