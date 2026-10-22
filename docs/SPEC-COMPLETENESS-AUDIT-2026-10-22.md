# Specification completeness audit — October 22, 2026

**Verdict: no, the complete specification has not been successfully addressed.**

Luuna has a substantial working foundation, including a real runtime, durable
approval and evidence machinery, supervised Pi integration, clients, component
adapters, multi-repository scheduling, scaffolding and a publisher. Full-v1
completion is blocked by both missing implementation and missing release
evidence. This audit also reproduced two publication-policy failures that the
existing publication suite does not test.

## Scope and method

- Audited checkout: `87a7e3fea0416551e9ba61195ec5fff8f90a1989`; initially clean.
- Environment: Windows x64; Rust 1.90.0. Exact tool versions are in the local
  check report. No Mac, clean Windows machine or mobile runner was exercised.
- Requirements: R01–R15, engineering requirements E01–E10, acceptance scenarios
  A01–A34, the numbered specification chapters and M0–M8 roadmap, with current
  architecture and accepted ADRs taking precedence over historical proposals.
- Inspected the eight Rust crates, runtime routes and policy boundaries,
  desktop/native shell, API client, terminal client, schemas, role contracts,
  test/harness sources, packaging/CI definitions and retained evidence.
- Component integration was checked through pinned submodules and real CLI
  tests. The three independent components' complete inherited test suites were
  not rerun, and their internals were not treated as Luuna-owned implementation.
- Existing status reports were treated as historical evidence. Passing fixture
  checks were not treated as provider, real GitHub, native GUI or installer proof.
- No product code was changed. No existing user runtime was stopped or upgraded, and no
  external repository, PR, commit or release was created. Publication probes used
  the existing synthetic harness with a fake HTTP server and local bare remotes.

This is a specification and implementation audit, not a claim that every source
line, every interleaving, every platform or every third-party package has been
exhaustively tested. The original `VALIDATION-REPORT.md` concerns documentation
delivery and is not product completion evidence.

The sanitized machine-readable summary is
[evidence/spec-audit-2026-10-22.json](evidence/spec-audit-2026-10-22.json).

## Findings requiring implementation work

### 1. Publication does not revalidate all approval and candidate inputs (high)

Two additional negative tests reproduced the following behavior:

| Probe | Required result | Observed result |
| --- | --- | --- |
| Complete review, manually change `src/main.py` in the candidate worktree, then publish the original candidate hash | Refuse publication and invalidate/report changed candidate evidence | HTTP 202; publication reached `pr_open`; one fake PR created |
| Complete review of plan r1, create plan r2, then publish r1's candidate | Refuse superseded authorization | HTTP 202; publication reached `pr_open`; one fake PR created |

The first probe pushed the frozen original commit, **not the unreviewed working
file**. Nevertheless it violates the specified requirement to detect manual
candidate changes between checks, review and push (A14/A26 and
`docs/07-contracts.md`). The second demonstrates that creating a newer plan does
not prevent publication from the earlier workflow.

`crates/luuna-runtime/src/publication.rs::prepare` checks candidate hash/status,
review verdict, manifest hash and active leases, but does not apply the latest
plan/approval guard or verify the worktree against the candidate. `publish` and
`reconcile` call `missions::ensure_current` on the current ticket; they do not
call `integrations::verify_plan_sources`, which compares the ticket revision to
the plan and re-resolves approved memory/prompt snapshots. Source inspection
therefore also identifies missing publication-time component-context freshness
checks; that additional case was not dynamically reproduced in this audit.
The validation storage path already centralizes authorization in
`crates/luuna-storage/src/validation.rs::current_plan` via `authorize_run`; the
publisher does not reuse that gate.

The current six publication tests cover a wrong candidate hash and publication
before review, but those cases do not establish the missing guards above.
Revalidate all authoritative inputs at publication admission and before external
side effects, and cover both initial publication and reconciliation with negative
tests. Preserve idempotent lookup of already-completed side effects.

### 2. Catalog coverage overstates browser/TUI capability parity (high)

`apps/desktop/src/capabilities.test.ts` checks static `data-capability` markers and
client method names. The contract checker compares catalog entries with served
routes. These tests establish useful wiring coverage, not equivalent parameters,
recovery states or all product requirements.

Concrete missing behavior:

- Desktop registration and TUI `register` construct a one-repository array.
  Neither provides the API's full multi-repository registration flow.
- `Projects.tsx` selects `view.repositories[0]` for baselines and passes that
  repository into workflows; the desktop cannot establish every repository's
  baseline for a multi-repository feature through those controls.
- `Workflows.tsx::plan` always sends one `task`. The TUI supports multiple
  `--task` values and `--workers`; the desktop does not expose their equivalent.
- TUI `implement --task` can request graph-task resumption. The desktop sends
  only model settings and exposes Implement only for an `approved` run. Its
  task graph display has no task-specific resume action.
- Ticket editing, memory editing and personal-memory export are absent from the
  runtime/client catalog, so a green catalog check cannot establish those spec
  obligations. ADR 0014 explicitly identifies ticket editing as outside its
  bounded slice; it does not complete the original full-v1 requirement.

R02/A33 are partial, not complete. Add behavior-level parity scenarios for
multi-repository onboarding, planning, all baseline targets and recovery, and
trace the catalog back to required actions in `docs/02-requirements.md`,
`docs/06-memory.md` and `docs/09-experience.md`.

### 3. Existing repositories without tests have no approved setup workflow (high)

The baseline gate correctly blocks feature implementation. However, P22/A06 and
`docs/08-validation.md` also require an offered prerequisite setup ticket and an
approved workflow that establishes tests before feature work. The runtime has
no corresponding setup execution path: ordinary writers require an already
passing baseline, and scaffolding creates a new project rather than repairing
the missing test setup in an imported project. `agents/testing-setup.md` is a
role contract, not an executable workflow.

This is an implementation gap rather than a reason to weaken the baseline gate.
The release report's A06 row covers the blocking half but not the offered
prerequisite or its execution.

### 4. Multi-repository coordination remains a bounded slice

The task DAG, concurrency limit, leases, candidate bindings and integration
fixture exist. ADR 0017 explicitly leaves these obligations open:

- P42: project orchestrator/repository-lead delegation and assignment traces.
  Plan creation hardcodes the task role to `implementer`.
- P44: validate plan dependencies against confirmed repository relationships and
  record justified overrides. An acyclic task DAG alone does not establish this.
- Shared contract artifacts beyond producer worktree/commit bindings.
- Genuine-provider multi-repository feature evidence.

Repair of a multi-repository set and repeated tasks in one repository use
re-planning by accepted decision; do not count that intentional limitation as an
unimplemented automatic-repair promise. R06 is still incomplete, however, and
M4 must not be called fully closed merely because its synthetic fixture passes.

### 5. Publication has additional incomplete obligations

- A24 is only partially implemented. `publication.rs::observe` records CI
  failures while explicitly retaining reviewed candidate evidence. ADR 0018
  states that CI-driven bounded repair is not wired into the repair workflow.
- The deterministic pre-push secrets/path policy check required by
  `docs/08-validation.md` is not present in the inspected publication path.
  Credential redaction and sanitized Git authentication do not scan candidate
  content before push. This is a source-inspection finding, not a claim that a
  real secret was published.
- The six publication integration tests operate on a single-repository harness.
  The three-repository scheduler suite and single-repository publisher suite do
  not together prove linked three-PR publication, partial-set recovery and the
  one-of-several-PRs-merged scenario end to end.
- Real GitHub authentication, push, PR creation, reconciliation and CI
  observation remain unverified. The audit intentionally created no external
  resources.

### 6. Stack support includes unavailable implementation as well as missing hosts

Discovery recognizes the advertised stacks, and real offline baselines exist
for Node, Node TypeScript, Python and Rust scaffolds. This does not establish the
complete stack matrix:

- Android and iOS scaffold functions unconditionally return `Blocked`; neither
  has a generator implementation, even on a capable host. ADR 0019 records this
  and directs users to Android Studio/Xcode followed by import.
- Go and Flutter need genuine capable-runner evidence. `flutter create` is
  implemented but the retained evidence does not demonstrate it succeeding.
- The React scaffold's refusal without network consent is tested; that does
  not prove successful React scaffolding and its installed dependencies.
- Next.js discovery exists; there is no dedicated Next.js scaffold profile.
- The Node TypeScript scaffold deliberately uses type stripping and asks the
  developer to add a typecheck; a passing template test is not a TypeScript
  static-analysis result.
- Android device availability and a booted iOS simulator are not established by
  detecting tool executables. Positive native build/test cases remain open.

These are bounded implementations described by ADR 0019, not evidence that R13
or all of M5 is complete.

### 7. Memory, portability and client experience remain partial

Real CLI adapters implement explicit selection, scope/provenance, retrieval,
creation, deletion, promotion and versioned prompts. Remaining obligations:

- Memory edit/correction and personal-memory export controls; retention rules
  and their operational enforcement. Explicit selection already prevents
  automatic use, but does not supply the complete management interface.
- Project export exists, but importing it on another machine is explicitly not
  implemented (ADR 0021). Machine rebinding alone is not export import.
- The full Home/Kanban/Help/settings experience and API-backed basic manual
  file editing/editor handoff in the experience spec are not established by the
  current panels. Task-list and plan-JSON views provide some of this information.
- Interactive TUI keyboard, terminal-width and accessibility evidence is open;
  the smoke drives its non-interactive command mode. Terminal status tones also
  remain open in ADR 0020.
- Container execution is explicitly rejected by the runtime. A32 remains
  partial; native execution must continue to be described as host permissions.
  Container support is optional in parts of the roadmap, so this should be
  resolved explicitly in the advertised acceptance scope, not silently passed.

### 8. Windows packaging omits required component/client distribution

This is more than an unperformed clean-machine test. Inspection of
`scripts/package-windows.ps1` shows staging of the desktop, runtime, helper
scripts and Pi tree, but no Missions/Atlas/Beacon trees, their manifest/gitlink
verification inputs, Bun, or terminal-client package. `Components::discover`
defaults to the compile-time source checkout unless `LUUNA_COMPONENTS_ROOT` is
provided, and its verifier requires actual pinned Git metadata. The packaged
bootstrap does not supply a portable replacement for that component layout.

Consequently the installer alone does not deliver the full integrated product
on a machine without the build checkout and separate component setup. Define a
verified distribution mechanism for components and the TUI, include their host
prerequisites in diagnostics/setup, and then perform the clean-machine test.
This finding is based on packaging and discovery code; no installation was
performed or altered during the audit.

## Missing release evidence

1. Mac ARM64 native lifecycle, credential handling, packaging and installation.
2. Clean-machine Windows installation and the complete documented walkthrough.
3. Production signing/update/supervision strategy and its platform verification;
   the unsigned Windows development installer is not that evidence.
4. Current-revision genuine Pi/provider M3 and a genuine multi-repository feature.
5. Real GitHub publication and coordinated recovery/CI/merge observation.
6. Positive Go/React/Flutter/native-mobile profile evidence as applicable.
7. A real-project pilot with the acceptance chapter's performance, resource,
   usage, repair and recovery measurements, plus release dependency/security
   evidence. Existing bounded benchmarks are useful historical observations.

No provider-backed run, real GitHub write, fresh installation or native GUI
launch was performed by this audit. Prior results remain limited to their
recorded revisions and hosts. CI workflow files are present; current hosted CI
execution/account eligibility was not checked.

## Requirement coverage

“Supported locally” below means implementation plus relevant deterministic or
fixture evidence. It is not a full release/platform certification.

| Milestone | Full-scope conclusion |
| --- | --- |
| M0 | Substantial foundation; schemas, contracts and local checks exist; supported-platform CI execution is not established here |
| M1 | Genuine-provider evidence exists historically; current fixture lifecycle passes; current genuine/supported-host evidence still required |
| M2 | Import, baseline and scoped writer implemented; P22 approved testing-prerequisite workflow remains incomplete |
| M3 | Current strict fixture passes; fresh review/repair/recovery implemented; current genuine-provider and full platform proof remain open |
| MVP gate | Local browser workflow and recovery demonstrated; Mac/native distribution and independent fresh-host walkthrough remain open |
| M4 | Synthetic multi-repository slice; P42/P44 and full client/genuine feature path incomplete |
| M5 | Selected scaffold baselines; full advertised stack/platform matrix incomplete |
| M6 | Real adapters and current catalog wiring; required actions, behavioral parity, portability and interactive TUI audit incomplete |
| M7 | Fake-server publisher with reproduced guard defects; complete portable distribution and real GitHub evidence incomplete |
| M8 | Report exists; release acceptance and real-project pilot are not complete |

| ID | Audit disposition | Evidence or remaining work |
| --- | --- | --- |
| R01 | Partial / release blocked | Windows development support; Mac and fresh-host installation unverified |
| R02 | Incomplete | Static catalog passes; multi-repository planning/recovery and required actions lack parity |
| R03 | Partial | Real pinned Pi adapter; historical genuine runs; no current genuine run or complete role-model workflow |
| R04 | Partial | Import and selected scaffolds; missing test-setup onboarding and incomplete scaffold matrix |
| R05 | Partial | Confirmed graphs and synthetic three-repository execution; client onboarding/dependency policy gaps |
| R06 | Incomplete | Per-task records exist; orchestrator/lead/specialist delegation not implemented |
| R07 | Supported locally with publication caveat | Writer exact-approval guards; publication can consume superseded plan evidence |
| R08 | Partial | Baseline enforcement exists; approved missing-test prerequisite workflow absent |
| R09 | Supported locally with invalidation caveat | Real commands, fresh reviewer, candidate checks; publication freshness gap |
| R10 | Partial full workflow | Local repair budgets/recovery implemented; CI-failure repair path incomplete |
| R11 | Incomplete | Fake-server publisher exists; guard defects, linked-set and real GitHub evidence missing |
| R12 | Supported locally | No merge route/operation; fake-server no-merge assertion |
| R13 | Partial / host blocked | Discovery and selected templates; complete capable-host matrix absent |
| R14 | Partial | Real scoped memory operations; edit/export/retention/portability obligations remain |
| R15 | Supported locally | Durable lifecycle/reconnect; supported-platform distribution evidence still open |

| ID | Audit disposition |
| --- | --- |
| E01 | Runtime rules implemented for current slices; full role/dependency policy and publication guards incomplete |
| E02 | Immutable hash-bound plan revisions and writer approvals exist; publication does not enforce latest revision |
| E03 | Bound check/artifact records exist; broad supported-environment evidence is incomplete |
| E04 | Missing/empty/blocked/cancelled checks have explicit outcomes; ordinary passing commands are not provider proof |
| E05 | Durable ledgers and stale-state checks exist; publication revalidation remains incomplete |
| E06 | Candidate validation detects drift; reproduced publication-time drift escape |
| E07 | Explicit resources, sanitized process environments and scoped native tools; no OS sandbox claim |
| E08 | Managed worktrees and preserved failed work; audit did not modify live project data |
| E09 | Authenticated loopback routes and bounded API behavior implemented |
| E10 | Pins, migrations and backup/restore exist; supported OS/architecture release matrix incomplete |

## Acceptance coverage

| ID | Disposition | Boundary |
| --- | --- | --- |
| A01 | Unverified | No fresh Mac installation |
| A02 | Unverified | Existing-host development evidence is not a clean Windows install |
| A03 | Supported locally | Local loopback fixtures; provider credentials are separate |
| A04 | Partial | Graph/import fixture exists; both client registration commands expose one repository |
| A05 | Partial | Selected scaffolds pass; not every advertised stack |
| A06 | Incomplete | Blocking works; prerequisite setup offer/execution absent |
| A07 | Supported locally | Empty/skip-only runner guards |
| A08 | Supported locally | Failed baseline blocks feature scheduling |
| A09 | Partial | Writer rejects stale plans; publication does not reject a newer plan revision |
| A10 | Supported for writer scope | Scope expansion changes plan hash; broader delegated execution is absent |
| A11 | Supported locally | Exclusive leases and writer contention tests |
| A12 | Fixture evidence | Synthetic parallel task graph; no genuine multi-repository run |
| A13 | Fixture evidence | Real consumer checks reject synthetic incompatible candidates |
| A14 | Reproduced failure | Post-review manual worktree drift does not block publication |
| A15 | Fixture plus historical genuine evidence | Fresh reviewer session and no implementation transcript |
| A16 | Fixture plus historical genuine evidence | Blocking findings prevent passing review and consume bounded repair |
| A17 | Supported locally | Exhaustion retains evidence and blocks further attempts |
| A18 | Supported locally | Missing tools/credentials classified as setup blockers |
| A19 | Partial platform evidence | Browser and command-mode TUI reconnect; interactive/native matrix incomplete |
| A20 | Fixture evidence | Strict M3 hard-kill recovery; backup drill; see retained shutdown-test failure below |
| A21 | Local process evidence | Windows executor/process tests and fixture lifecycle; full supported-host matrix open |
| A22 | Partial | Single-repository fake-server partial recovery; linked multi-PR/real-server evidence absent |
| A23 | Fake-server evidence | Timeout-after-remote-success reconciles without a duplicate |
| A24 | Incomplete | CI failure displayed; bounded repair/invalidation not connected |
| A25 | Incomplete evidence | All-merged predicate exists; one-of-several end-to-end PR scenario not established |
| A26 | Partial / reproduced failure | Validation detects manual drift; publication can still proceed after review |
| A27 | Bounded guard evidence | Untrusted source/resource policy tested; native host execution is not confinement |
| A28 | Real-CLI evidence | Explicit user-memory inclusion and isolated project stores |
| A29 | Real-CLI evidence | Export excludes/refuses private scope, credentials and host paths; import is separate and absent |
| A30 | Real-CLI evidence | Missions external edits and reconciliation invalidate stale work inputs |
| A31 | Negative evidence only | Incapable host blocks iOS; no positive Mac execution |
| A32 | Partial / scope decision needed | Native runs; container profile refused |
| A33 | Incomplete | Existing catalog checks miss parameter/state parity and uncataloged spec actions |
| A34 | Partial | Fake publisher creates PRs without merging; full policy and real integrated flow incomplete |

## Checks performed in this audit

Tool versions observed: Rust/Cargo 1.90.0, Git 2.55.0.windows.5, Python 3.11.9,
Node 26.10.0 and initially npm 11.19.1. Node meets the documented minimum.
The frontend checks were then repeated with the exact npm 11.9.0 pin through
`npm exec --yes --package=npm@11.9.0 -- npm <command>`; the version probe,
`test`, `run typecheck` and `run build` all passed. The global installation
and repository lockfiles were preserved.

| Actual command/check | Result and scope |
| --- | --- |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | Passed |
| `CARGO_TARGET_DIR=<isolated-build> cargo test --locked --workspace --no-fail-fast -- --test-threads=2` | **389 passed, 0 failed, 13 ignored**, 43 suites; exit 0 |
| `npm test` | Passed: 29 contract cases, 50-action catalog, 9 scope-guard passes/1 Windows skip, 8 component-pin tests, 7 harness tests, 251 desktop tests, 39 API-client tests, 60 TUI tests |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; web build only |
| `npm exec --yes --package=npm@11.9.0 -- npm test`, `... npm run typecheck`, `... npm run build` | All passed again with the exact npm pin |
| `node scripts/check-hygiene.mjs` | Passed |
| `git diff --check` | Passed |
| `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | Passed; compilation, not a native launch or installation |
| `node scripts/components-smoke.mjs` | Passed with pinned real component CLIs |
| `cargo test --locked -p luuna-runtime --lib components_real_ -- --ignored` | 6 passed |
| `cargo test --locked -p luuna-runtime --lib missions_real_ -- --ignored` | 3 passed |
| `cargo test --locked -p luuna-components --test real -- --ignored` | 1 passed; actual CLI workflows and large private arguments |
| Existing runtime writer integration binary, `--ignored --exact component_source_edits_during_writer_and_reviewer_cannot_accept_stale_work --nocapture` | 1 passed; real component source drift rejected during synthetic writer/reviewer execution |
| `node scripts/m3-smoke.mjs --mode fixture --out <m3-output>` | 69/69 passed; strict clean-revision provenance, synthetic Pi, real host checks |
| `node scripts/m1-smoke.mjs --mode fixture --runtime <isolated-runtime> --out <output>` | 19/19 passed; synthetic lifecycle |
| `node scripts/backup-recovery-drill.mjs --runtime <isolated-runtime> --out <output> --skip-migration-tests` | 30/30 passed; migration unit tests are separate |
| `node scripts/mvp-ui-smoke.mjs --runtime <isolated-runtime> --out <output>` | 64/64 passed in Chromium; synthetic model |
| `node scripts/m6-ui-smoke.mjs --runtime <isolated-runtime> --out <output>` | 23/23 passed; real component CLIs, synthetic writer/reviewer |
| `node scripts/tui-smoke.mjs --runtime <isolated-runtime> --out <output>` | 53/53 passed; command-mode terminal client, synthetic model |
| Disposable publication-policy probes against the current runtime library | **2 failed policy assertions**: both disallowed cases reached `pr_open` |

The complete Rust workspace rerun passed with two test threads. Eleven of its
13 normally ignored tests were explicitly exercised separately and passed
(6 runtime component tests, 3 Missions tests, 1 component adapter test and
1 writer/reviewer source-drift test). The large-index stress case excluded on
Windows and the manual history benchmark were not run. This does not erase the
earlier shutdown-test failure recorded below. The two additional publication
probes are outside the existing suite and still fail their required policy
assertions; the passing existing suite does not establish specification completion.

Failures retained separately:

- `cargo build --locked -p luuna-runtime` and the initial
  `cargo test --locked --workspace` could not replace the running
  `target/debug/luuna-runtime.exe` (`Access is denied`, Windows error 5).
  The live runtime was preserved. Subsequent product tests used
  `CARGO_TARGET_DIR=<temporary isolated build directory>`.
- The first isolated workspace run stopped at
  `explicit_shutdown_interrupts_a_running_baseline_instead_of_cancelling_it`
  (`crates/luuna-runtime/tests/baselines.rs:758`): zero check results were
  recorded where one was expected. The same existing test passed when run
  alone (1/1). The test polls up to five seconds for a spawn event before
  shutting down, so timing/load is a plausible explanation, not a proven
  diagnosis. Preserve this as a reliability concern.
- An attempted workspace rerun overlapped the audit's own smoke runtime and
  encountered the same executable lock in the isolated directory. The final
  workspace run was scheduled after those harnesses exited.
- The disposable probe crate initially failed to compile because the copied
  original test had a relative `include_str!` path. Correcting the probe's
  source reference, outside the repository, produced the two policy failures
  reported above. No product source was changed to obtain those results.

The repository's `scripts/release-evidence.mjs` ran the formatting, lint,
workspace, npm, build, hygiene, native and real-component checks above with
`--only fmt,clippy,cargo-test,npm-test,typecheck,build,hygiene,diff-check,native-check,components,components-real,missions-real`.
It correctly exited 1 because its default-target Cargo step was locked. The
separate isolated runs supplement that report; its failure was not rewritten.
Browser harnesses used the installed Edge executable via `LUUNA_CHROMIUM`.

Local raw evidence is deliberately outside Git:

- `%TEMP%/luuna-spec-audit-2026-10-22/`: command logs, aggregator report,
  browser/component/TUI and backup reports.
- `%TEMP%/luuna-spec-audit-m3-2026-10-22/`: strict M3 report and provenance.
- `%TEMP%/luuna-publication-audit-2026-10-22/`: disposable Rust probe package,
  lockfile and `results.log`. Reproduce with
  `cargo +1.90.0 test --offline --manifest-path <probe>/Cargo.toml audit_ -- --nocapture`.
  The probes copy the existing publication harness and assert the missing
  policy refusals; they contact only a local fake server and bare repositories.

## Completion order

1. Fix publication authorization, candidate/context freshness and pre-push policy;
   add the reproduced negative cases and reconciliation variants.
2. Close required workflow gaps: testing setup, multi-repository client actions
   and recovery, delegated roles/dependency overrides, ticket/memory controls.
3. Complete CI repair, linked multi-PR end-to-end scenarios, portable import and
   supported stack behavior; explicitly decide remaining advertised scope.
4. Run genuine-provider and real GitHub acceptance, then fresh-host platform and
   installation tests and the real-project pilot.
5. Update the release matrix only with revision-bound evidence. Keep historical
   reports intact and distinguish their bounded claims from current completion.

The existing release report correctly withholds the v1 label. Its closing
six-item blocker list is insufficient as a complete implementation backlog:
the reproduced publication failures, client parity, P22, P42/P44, A24 and memory
management gaps must also remain visible.

Final checkout inspection: only this audit report and its sanitized JSON summary
were added. Existing tracked files and component gitlinks remain unchanged.
