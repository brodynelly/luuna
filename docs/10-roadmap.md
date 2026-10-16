# Implementation roadmap

## Delivery approach

Build vertical slices with observable exits. Do not begin by implementing every screen or every agent persona. The first slice proves Pi execution and the approval boundary; the final v1 includes multi-repository coordination, stack coverage, and browser/TUI parity.

No calendar completion promise is implied. Staffing, existing reusable code, installer requirements, platform access, and selected tool versions have not been established. Re-estimate after M1 using observed effort. Each milestone ends with a runnable demo, evidence, a short decision update, and a small reviewable PR.

## M0 - Contracts and bootstrap

Create the Luuna monorepo, Rust workspace, browser application skeleton, CI, fixtures, documentation, and development commands. Record the chosen stack and upstream dependency versions. Finish the domain schemas, event envelope, error taxonomy, approval hash definition, and API specification.

Work packages: P00 repository/CI bootstrap; P01 domain types and schemas; P02 threat and permission model; P03 dependency and license inventory; P04 shared capability catalog.

Exit: schema examples validate, domain transition tests reject invalid actions, Mac/Windows CI builds a skeleton binary, and a documented command runs the fixture suite. No real agent writes are enabled.

## M1 - Real Pi vertical slice

Implement the service shell, engine adapter, child-process supervision, event normalization, CLI client, private configuration, and one real provider connection. Test read-only exploration and structured output against a small fixture.

Work packages: P10 Pi compatibility probe; P11 supervised worker lifecycle; P12 streaming and cancellation; P13 model/credential profiles; P14 local API authentication.

Exit: a real Pi run streams through the API, cancellation stops its owned process tree, malformed output does not advance domain state, and restarting the service identifies the interrupted attempt. Pin a compatible Pi release based on this evidence.

Stop and revisit the Rust/RPC choice if the adapter cannot reliably support the required lifecycle or platform behavior. A TypeScript SDK host is the documented fallback; changing it requires ADR review, not a parallel second backend.

## M2 - Test prerequisite and approved single-repository work

Implement repository registration, baseline inspection, prerequisite setup tickets, immutable plans, approval records, task worktrees, command recipes, and one writer.

Work packages: P20 Git/worktree adapter; P21 check recipes and evidence; P22 testing prerequisite workflow; P23 plan hashing/approval; P24 scoped execution.

Exit: a missing test setup blocks feature edits; an approved prerequisite establishes meaningful tests; an approved feature modifies a fixture in a task worktree while preserving the original checkout. A stale approval and a mismatched baseline both fail closed.

## M3 - Independent review and bounded repair

Implement candidate freezing, check gates, new reviewer sessions, structured findings, repair limits, pause reports, and evidence invalidation.

Work packages: P30 review contract; P31 candidate/check binding; P32 repair accounting; P33 failure classification; P34 interruption reconciliation.

Exit: a deliberately introduced regression is found or rejected by required checks; repairs invalidate prior evidence; exhaustion pauses with artifacts; review cannot inherit the implementer's transcript. A model's unsupported claim of success cannot pass the gate.

## M4 - Multi-repository coordination

Implement the confirmed project graph, project orchestrator, on-demand repository leads, task dependency scheduling, shared contract artifacts, and integration candidate sets.

Work packages: P40 manifest and discovery; P41 graph confirmation; P42 delegated assignments; P43 scheduler and locks; P44 dependency overrides; P45 cross-repository integration.

Exit: a three-repository fixture changes an API, shared package, and consumer; independent tasks run concurrently within limits; a deliberately incompatible consumer blocks integration; checks bind to the exact three candidate commits.

## M5 - Project creation and stack profiles

Implement new-project planning/scaffolding and profiles for React/Next.js/TypeScript, Go, Node.js, Python, Flutter, native Android, and native iOS. Profiles discover and propose commands; confirmation and execution remain common runtime behavior.

Work packages: P50 new-project setup; P51 web profiles; P52 backend profiles; P53 Flutter profile; P54 native platform profiles; P55 capability probing.

Exit: each advertised profile establishes or verifies a meaningful baseline on a capable runner. Mac-specific checks are demonstrated on a Mac. An unavailable required native capability blocks work with a useful explanation. UI support alone does not qualify a profile as validated.

## M6 - Complete clients and knowledge integration

Deliver project selection, Home, Kanban, plan approval, run dashboard, diff/review, memory management, and settings through browser and TUI. Add Mulch/Canopy/Seeds adapters, portable config, private user memory, and the first lexical retrieval path.

Work packages: P60 shared client contract; P61 browser workflow; P62 TUI workflow; P63 upstream tool adapters; P64 memory scopes; P65 generated process prompts.

Adapters may be stubbed in earlier slices, but stubs must be replaced here. Upstream schema mismatches produce explicit compatibility failures. External record edits are reconciled with revisions.

Exit: all cataloged product actions have both client implementations and parity scenarios. Restart/reconnect preserves the same view of work. No user memory or credential appears in exported project files.

## M7 - PR publication and portable installation

Implement GitHub authentication through a tested credential mechanism, branch push, linked PR creation, per-repository publication recovery, CI status observation, and human-controlled merge tracking. Ship installers and a doctor command for supported Mac/Windows targets.

Work packages: P70 publisher; P71 partial-failure recovery; P72 CI observation; P73 installer/update policy; P74 platform smoke matrix; P75 support diagnostics.

Exit: an end-to-end three-repository run automatically creates linked PRs after gates; retries do not duplicate them; no automatic merge occurs; a clean supported computer can install, configure, and complete a fixture run without a NAS.

## M8 - Release candidate and reliability

Run the full acceptance suite, real-project pilot, recovery drills, documentation review, supported-version matrix, resource profiling, and dependency/security review. Test optional container execution on supported hosts and document exact capability limits.

Exit: all binding requirements have evidence, known limitations are explicit, no required path depends on mocks, and browser/TUI capabilities match. Measure task completion, repairs, failures by cause, resource use, and review outcomes during the pilot.

## Later extensions

Authenticated remote worker transport; optional NAS and Mac worker routing; no-install hosted workspaces; desktop packaging; optional local model/GPU profiles; semantic retrieval; additional coding-engine adapters; multi-ticket scheduling; shared-team operation. Each extension preserves approval, evidence, and identity boundaries.

## Critical path and parallel development

M0 -> M1 -> M2 -> M3 -> M4 is the execution core. Stack profiles and client work can begin against stable contracts after M2, but M5-M7 depend on real core behavior for acceptance. UI work should use realistic fixtures rather than invented states.

Within implementation, separate contract, runtime, and client tasks only when APIs are stable. Limit simultaneously changing the scheduler, event protocol, and UI state model. Integration ownership must be explicit.

## Scope controls

Do not defer multi-repository coordination or browser/TUI parity while still labeling a release v1. Do not promote remote hosting, a full editor, GPU integration, embeddings, or additional engines ahead of missing core gates. If a milestone expands materially, revise the plan and acceptance criteria before implementation.
