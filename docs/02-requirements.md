# Requirements and scope

## Binding functional requirements

| ID | Requirement | Required proof |
| --- | --- | --- |
| R01 | Install and operate locally on supported Mac and Windows targets without a NAS | Fresh-machine installation and smoke run |
| R02 | Browser and TUI expose equivalent product actions | Shared capability catalog and parity tests |
| R03 | Pi is the v1 agent engine with role-specific model selection | Real provider smoke test and reproducible configuration |
| R04 | Import existing repositories and scaffold new projects | Both onboarding acceptance scenarios |
| R05 | A project contains multiple repositories and explicit relationships | Confirmed project graph and integration fixture |
| R06 | Coordinate project, repository, and specialist roles | Traceable parent/child task records |
| R07 | Require approval before feature implementation | Runtime rejects a write task without a valid approval |
| R08 | Require a usable testing setup and passing baseline before feature work | Failed/missing baseline blocks scheduling |
| R09 | Run tests, static analysis, conventions, and fresh review | Recorded command evidence and structured reviewer result |
| R10 | Bound automatic repairs and pause with useful evidence | Exhaustion and infrastructure-blocker tests |
| R11 | Automatically create linked PRs after pre-publication gates pass | GitHub sandbox/repository integration test |
| R12 | Keep merging under developer control | No automatic merge operation in the v1 publication workflow |
| R13 | Support web, backend, Flutter, and native-mobile project profiles | Acceptance matrix on capable hosts |
| R14 | Support scoped user, project, and process memory | Scope, override, provenance, and deletion tests |
| R15 | Keep runs independent of browser/TUI connection lifetime | Disconnect/reconnect test |

## Proposed engineering requirements

| ID | Requirement |
| --- | --- |
| E01 | Deterministic runtime enforces permissions, budgets, dependencies, and transitions |
| E02 | Approved plans are immutable revisions with hashes and candidate base commits |
| E03 | Every result identifies repository, commit/tree, environment, command, outcome, and artifact references |
| E04 | Failed, interrupted, skipped, and unavailable checks never become passing checks |
| E05 | Requests that start work or publish artifacts use idempotency and stale-state guards |
| E06 | Repository changes invalidate affected evidence and review results |
| E07 | Treat repository content, imported memory, and agent findings as untrusted data |
| E08 | Preserve user changes and retain unfinished worktrees after failures |
| E09 | Bind local service to loopback by default and authenticate state-changing requests |
| E10 | Record migrations, pin tool dependencies, and test supported OS/architecture combinations |

## Distinguish capabilities from execution location

Browser parity means that project creation, planning, approval, editing task inputs, running work, inspecting diffs, cancellation, recovery, memory management, and publication are all available through both clients. It does not require identical layouts.

The browser controls a runtime installed on a computer. Browser access alone does not imply a hosted execution service. A runtime on a Mac can schedule its local platform tools; a Windows runtime uses its own installed tools. A remote worker is an additional capability, not a requirement for local operation.

An incapable host may inspect and plan a mobile project but cannot claim a successful required platform build. In initial local v1, the developer can run the project on a capable machine. Remote routing is a later milestone.

## Non-goals for local v1

No automatic merging, production deployment, multi-tenant SaaS, mandatory cloud account, mandatory GPU, custom model training, full IDE replacement, arbitrary recursive agent spawning, or permanent always-running lead agents. Separate native Codex or Claude Code engine adapters are deferred because Pi model selection satisfies the initial requirement.

No fabricated universal testing recipe is promised. Stack adapters discover and propose commands; the developer confirms them. Repo-specific testing still requires the correct dependencies, fixtures, and execution host.

## Decisions with proposal status

Rust service, React/Vite browser UI, Ratatui client, SQLite runtime state, use of upstream CLI adapters, exact storage layout, model assignments, concurrency defaults, and repair count are recommended choices. They can change through an architecture decision record if implementation evidence justifies it.

The three memory uses are the completed proposed interpretation of the conversation: personal continuity, project knowledge, and reusable process lessons. User memory was explicit; the other two were recommended and should be validated during the first product review.

## Requirements traceability

Milestones M0-M2 prove R03, R07, R08, and E01-E05. M3 proves R09-R10. M4 proves R05-R06. M5 proves R04 and R13. M6 proves R02 and R14-R15. M7 proves R01 and R11-R12. M8 validates the full release matrix and operational recovery. See docs/10-roadmap.md and docs/11-acceptance.md.
