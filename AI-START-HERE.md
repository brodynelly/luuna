# Implementation handoff for a coding AI

You are implementing Luuna from a new codebase. Treat this package as the product and architecture baseline. Build reviewable vertical slices and preserve the user's requirements. The package is a design, not evidence that code already exists.

## Read first

Read README.md, docs/01-proposal.md, docs/02-requirements.md, docs/03-architecture.md, docs/04-orchestration.md, docs/07-contracts.md, docs/10-roadmap.md, and docs/11-acceptance.md. Read docs/05-pi-integration.md before touching Pi integration, docs/06-memory.md before persistence/retrieval, and docs/08-validation.md before implementing any gate. Use docs/13-references.md for current primary documentation.

Inspect the actual repository and any applicable repository instructions before making changes. If this pack has been copied into an existing repository later, preserve existing behavior and conventions unless the implementation plan authorizes a change.

## Product constraints

Luuna serves individual developers on Mac and Windows. Browser and TUI have product capability parity. A local runtime is sufficient; NAS, hosted execution, cloud account, and GPU are optional. Pi runs all v1 agents, using selected models. Projects can contain multiple independent repositories and can be imported or created from scratch.

Coordination uses a project orchestrator, on-demand repository leads, and bounded specialists. The runtime enforces scope, scheduling, permissions, and budgets. The user approves the executable plan before implementation. Testing setup and a passing baseline precede feature work. Tests, analysis, conventions, fresh review, and integration gate PR creation. Create linked PRs automatically; never automatically merge them.

## First assignment

Start with M0 and M1. Propose a concrete plan with files/modules, contracts, test strategy, dependencies, and a demo. After the developer approves that plan, implement those milestones. Do not attempt to code the entire roadmap in one unreviewed change.

M0 must complete the omitted core domain schemas and create tests. M1 must prove a real pinned Pi session through the proposed runtime with streaming, cancellation, errors, and persistence. Use fixture output for deterministic tests, but do not present mocks as a working Pi integration.

## Engineering rules

Keep business rules in the runtime, not separate browser/TUI copies. Validate plans and approvals transactionally. Preserve exact candidate identities. Distinguish worker text from verified domain events. New code, rebases, dependency changes, and manual edits invalidate affected evidence.

Use task worktrees; preserve developer changes. Native execution is host-permission execution. A shell is not constrained by a prompt or by a path-only tool wrapper. Container profiles require deliberate mounts and credential boundaries.

Keep secrets out of versioned config and model context. Keep personal memory private. Pin upstream interfaces and preserve user Pi configuration. Avoid forking upstream tools unless a documented compatibility need justifies it.

Use a new conversation for independent review. Provide diff, requirements, current code, and check evidence, not the implementation chat. A malformed reviewer report or missing check cannot count as passing.

Bound repair attempts and aggregate usage. Classify infrastructure failures separately. Publish idempotently and reconcile uncertain remote results before retrying.

## Recommended first implementation sequence

1. Establish the monorepo and tests; write ADRs and complete schemas.
2. Implement deterministic domain transitions and approval guards.
3. Prove Pi adapter lifecycle with real and fixture sessions.
4. Add local authenticated API and CLI.
5. Demonstrate one complete read-only planning run and safe cancellation.
6. Report evidence and remaining gaps before advancing to M2.

## Required milestone report

State the delivered behavior, relevant requirement IDs, changed modules, commands actually run, evidence locations, platform results, known gaps, and the next milestone. Report failing or unavailable checks explicitly. Do not say 'complete' when core behavior is stubbed or only a UI simulation exists.

When a material architecture change is justified, write an ADR explaining the implementation evidence and consequence. Ask only for information that blocks the current bounded plan; do not reopen settled product decisions without a reason.
