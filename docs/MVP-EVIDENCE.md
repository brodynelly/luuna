# MVP requirement and evidence report

Date: 2026-10-21. This names what the usable single-repository MVP demonstrates against the binding requirements in [02-requirements.md](02-requirements.md), where the evidence is, and what the MVP deliberately omits. It is the report the roadmap's MVP gate asks for; it does not call anything full v1. Evidence lines point at [FOUNDATION-STATUS.md](FOUNDATION-STATUS.md) sections and the committed harnesses; a fixture result is labelled synthetic wherever it appears.

Platform of every recorded result: Linux cloud container (Rust 1.90.0, Node 24.19.0, Python 3.13, Git 2.43, Pi 1.3.0). No Mac or Windows result exists yet.

## Coverage by requirement

| ID | Requirement | MVP status | Evidence |
| --- | --- | --- | --- |
| R01 | Local Mac/Windows operation | **Omitted from the MVP demonstration.** The runtime, client and Tauri shell build; no native launch, service supervision or installer has run on a Mac or Windows host. | Open gap recorded in every status section since M1 |
| R02 | Browser/TUI parity | Browser client only; no TUI exists. | Desktop smoke (`scripts/mvp-ui-smoke.mjs`); M6 roadmap item |
| R03 | Pi with selected models | Met on Linux with OpenRouter (`openai/gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`); provider/model are runtime settings or per-action client fields; the credential never enters the client. | Status report M1 and M3 genuine-provider sections (sixty real runs, plus real run 61 on the MVP code, 61/61) |
| R04 | Import and creation | Import met (read-only inspection, discovery proposal, confirmed manifest revisions); scaffolding new projects is M5 and omitted. | M2a closure; walkthrough steps 2 and 3 |
| R05 | Multiple repositories | Omitted; the contract accepts relationships but one repository is scheduled. | M4 roadmap item |
| R06 | Coordination roles | Omitted beyond one writer and one independent reviewer per workflow. | M4 roadmap item |
| R07 | Approval before feature writes | Met: exact immutable plan hash, acknowledgment before approval, transactional revalidation at scheduling; missing or stale approval refused. | M2c closure; `luuna-storage` and `luuna-runtime` negative tests |
| R08 | Passing baseline before feature work | Met: baselines are supervised runs bound to manifest hash, commit, tree and host fingerprint; failed, blocked, empty, dirty and stale baselines block the writer. | M2b closure; `begin_implementation` gate |
| R09 | Real checks and fresh review | Met for tests and any command recipe: required recipes run in the owned worktree before a fresh read-only reviewer whose structured verdict the runtime enforces; static analysis and convention checks are whatever recipes the manifest confirms. | M3 implementation and genuine-provider sections; ADR 0009 |
| R10 | Bounded repair and useful pause | Met: manual and opt-in automatic repair under the immutable approval; attempt, time, cost and repair limits; infrastructure failures stop without edits; re-validation after an invalid review (October 21); reserved spend after interruption. | M3 sections; ADR 0009 points 4, 5 and 7 |
| R11 | Linked PRs | **Omitted.** No publication route exists; reviewed candidates are local commits in Luuna-owned worktrees. | M7 roadmap item |
| R12 | Human-controlled merge | Met by construction: no merge or push operation exists in the runtime. | Architecture, ADR 0009 |
| R13 | Stack profiles | Omitted beyond what the confirmed manifest's recipes run (Python and this repository's Rust/Node recipes have run). | M5 roadmap item |
| R14 | Scoped memory | Omitted; Atlas is not integrated. | M6 roadmap item |
| R15 | Runs independent of client lifetime | Met on Linux: closing or reloading the client cancels nothing; the client replays by cursor; hard kill and orderly shutdown record interruption and the work resumes after restart. | M1 closure; October 21 client-hardening section; desktop smoke recovery scenarios |

Engineering requirements E01 to E09 are met for the single-repository path (deterministic runtime gates, immutable revisions and hashes, bound evidence, fail-closed checks, idempotent creation and expected-revision guards, invalidation on change, untrusted repository content, preserved worktrees, loopback with bearer authentication). E10 is partial: migrations and pins are recorded; the OS matrix has not run.

## What a developer gets

Import a repository, confirm its checks, prove a baseline, write a ticket, approve an exact plan, let a scoped Pi writer change a Luuna-owned worktree, run the real checks and a fresh independent review on that exact candidate, inspect diffs, logs and findings, repair within approved budgets, and recover from cancellation, crash or shutdown with the evidence intact and the next step named. The result is a reviewed local commit the developer publishes and merges by hand.

## What the MVP omits, explicitly

- Native Mac and Windows operation, packaging and service supervision (R01). The last M3 exit; it needs a capable host.
- Publication: no push, no pull request, no CI observation (R11).
- Multi-repository projects, relationships and roles (R05, R06).
- Project scaffolding and the stack-profile matrix (R04 creation, R13).
- Missions, Atlas and Beacon integration and scoped memory (R14); tickets remain temporary local records (ADR 0003).
- A TUI and the shared capability catalog (R02).
- Any OS sandbox for native checks: checks run with host permissions under the developer-confirmed manifest (ADR 0009).
- A writer interrupted mid-session cannot be resumed under the same approval; the next plan revision is required (its worktree is preserved).
- Automatic runtime startup from the desktop shell; the service is started by hand.

## Evidence the MVP relies on, by kind

- Deterministic tests: `cargo test --locked --workspace` (Rust domain, storage, executor, Git, discovery, engine and runtime suites with the synthetic Pi fixture and real host commands), `npm test` (schema, scope guard, client, desktop).
- Lifecycle harnesses, synthetic: `node scripts/m1-smoke.mjs --mode fixture`, `node scripts/m3-smoke.mjs --mode fixture`, `node scripts/mvp-ui-smoke.mjs`.
- Client presentation: `apps/desktop/src/design/design-system.test.ts` under `npm test` (token-only stylesheets, contrast of every semantic pair in both schemes, tone taxonomy, screen structure) and the desktop smoke's presentation audit (rendered contrast in the dark and light schemes, no horizontal scroll at 760 px). See [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).
- Genuine provider: `node scripts/m1-smoke.mjs --mode real …` and `node scripts/m3-smoke.mjs --mode real …` with a configured credential; results are tabulated in the status report and never inferred from fixtures.
- Native hosts: none yet.
