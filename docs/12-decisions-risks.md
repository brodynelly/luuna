# Decisions, risks, and open implementation choices

## Architecture decision register

| ADR | Status | Decision and consequence |
| --- | --- | --- |
| ADR01 | Requirement | Individual installation; NAS and hosted execution optional |
| ADR02 | Requirement | Browser/TUI capability parity through one runtime |
| ADR03 | Requirement | Pi engine with selectable models; other CLI engines deferred |
| ADR04 | Recommended | Rust service/TUI with supervised Pi RPC; validate at M1 |
| ADR05 | Recommended | React/TypeScript browser application; no full IDE in v1 |
| ADR06 | Requirement | Multi-repository project coordination and explicit delegation |
| ADR07 | Recommended | Fixed-depth roles; deterministic scheduling outside model reasoning |
| ADR08 | Requirement | Plan approval before implementation, testing prerequisite, independent review |
| ADR09 | Recommended | Native execution default; container policy per repository |
| ADR10 | Recommended | Private shared user memory with project overrides |
| ADR11 | Recommended | Upstream tool adapters, not immediate rewrites of Mulch/Canopy/Seeds |
| ADR12 | Requirement | Automatic linked PRs; developer controls merge |
| ADR13 | Recommended | SQLite local runtime state; versioned project records and derived indexes |
| ADR14 | Recommended | Bounded concurrency and two repair attempts per task plus ticket limits |

Record context, alternatives, decision, evidence, and consequences when updating an ADR. User requirements are changed only through an explicit product decision.

## Principal risks

| Risk | Design response | Milestone proof |
| --- | --- | --- |
| Too much initial scope | Vertical milestones, fixed roles, no full editor/hosted service | M1-M4 demos |
| Pi or tool protocol drift | Pin releases, compatibility adapter, real smoke tests | M1, M6 |
| Upstream runtimes complicate install | Dependency inventory and managed/existing-tool options | M0, M7 |
| False success | Deterministic check records and commit-bound gates | M2-M4 |
| Agent permission overreach | Explicit native/container policy, trusted resources, separate publisher | M2, M7 |
| Conflicting simultaneous edits | Worktree ownership, leases, candidate invalidation | M3-M4 |
| Stale cross-repository assumptions | Confirmed graph, contract evidence, exact candidate integration | M4 |
| Multiple PRs cannot merge atomically | Compatibility plan, linked PRs, human merge order | M4, M7 |
| Hidden host requirements | Capability probes and explicit blockers | M5 |
| Split authority across JSONL and database | Clear ownership, serialized adapters, reconciliation | M6 |
| Personal memory leaks | Private store, scoped retrieval, explicit promotion | M6 |
| Native shell has broad host access | Honest mode disclosure; optional constrained container profile | M2, M8 |
| Runtime crash duplicates side effects | Durable attempts, idempotency, remote reconciliation | M3, M7 |

## Questions that need implementation evidence

Select exact supported Pi and upstream CLI releases, their runtime dependencies, and packaging strategy at M0-M1. Confirm which upstream tools are used directly versus through a thin compatibility layer. Establish a tested version matrix and preserve attribution for reused code.

Decide the first supported OS architectures, code-signing/update channel, and installer trust model before public distribution. Decide how GitHub credentials are obtained and scoped before publisher implementation.

Set user-adjustable token/time/spending limits and an initial aggregate repair ceiling. Determine the minimal meaningful baseline per stack profile using real fixture projects. Finalize runtime retention/backup policy and supported remote access transport before adding remote workers.

No estimate of development duration, exact cloud cost, universal model choice, or commercial licensing model has been established. These do not block the first local vertical slice, but public distribution requires explicit packaging and dependency decisions.

## Rollback and preservation

Cancellation preserves task branches, worktrees, logs, and evidence by default. Cleanup targets only Luuna-owned resources whose ownership has been verified. Never run destructive Git cleanup in a developer's checkout.

Database schema upgrades need backup and forward migration tests. Downgrade support must be explicit. Upstream tool upgrades should be tested against fixture corpora before changing a pinned profile. Failed updates retain the prior working profile where feasible.
