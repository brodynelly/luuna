# ADR 0017: multi-repository coordination (M4)

Date: 2026-10-22. Status: accepted; implements the M4 slice of
`docs/IMPLEMENTATION-ROADMAP.md` (P40 manifest and discovery, P41 graph
confirmation, P43 scheduler and locks, P45 cross-repository integration) on
top of ADR 0008 (approval, worktrees, one scoped writer) and ADR 0009
(candidate-bound checks, review and repair). P42 (delegated roles) and P44
(dependency overrides) remain open; see "What remains".

## Context

M3 runs one writer in one repository, validates its candidate with that
repository's required recipes and reviews it in a fresh session. R05 requires
a confirmed repository graph and an integration candidate across repositories;
R06 requires scoped coordination with traces; A12 and A13 require independent
work to overlap within limits and an incompatible consumer to block
integration; A20 requires a killed service to leave recoverable evidence. The
contracts already carried `PlanTask.depends_on`, `Relationship.confirmed` and
`CandidateSet.dependency_bindings`, but nothing validated the task DAG,
discovered relationships, scheduled more than one task, or ran checks against
another repository's candidate.

## Decision

1. **The plan's task graph is a validated contract.** `PlanRevision`
   validation now names what is wrong with the graph: a task that depends on
   itself, on an unknown task or on the same task twice, and any dependency
   cycle (`task dependencies contain a cycle: a -> c -> b -> a`). Every task
   repository must be in the plan's permissions, as before. A plan's
   `budgets.max_workers` lies between 1 and `min(tasks, 4)` (`MAX_PLAN_WORKERS`),
   so a single-task plan still requires exactly 1 and no plan asks for more
   writers than it has tasks or than the runtime's four-run limit. Required
   recipe IDs are unique per repository (results bind to the pair), so every
   repository of a plan carries its manifest's `unit`. Serialization is
   unchanged: a single-task plan hashes exactly as before
   (`fixtures/domain/plan.valid.json` is unchanged).
2. **Tasks target distinct repositories.** `POST /api/v1/tickets/{id}/plans`
   accepts `tasks` (a list, each with `depends_on`) in place of `task`, and
   `budgets.max_workers`. Two tasks in one repository are refused: the
   candidate set freezes one commit per repository, and a dependent change
   inside one repository is one task, or the next plan revision. Base
   commits, required checks and default permissions are collected for every
   task repository from the confirmed manifest, as for one task.
3. **Relationships are proposed from evidence and confirmed by the
   developer.** Discovery (`luuna-discovery::relationships`) proposes
   `package` relationships between registered repositories: a `package.json`
   whose `dependencies` or `devDependencies` name another repository's package
   `name`, a `Cargo.toml` `path` dependency resolving to another repository's
   root, and a `go.mod` `replace` directive with a relative path into another
   repository. Each carries `confirmed: false` and an evidence string naming
   the files. Confirming a manifest that still lists an unconfirmed
   relationship is refused with the relationships named; the developer sets
   `confirmed: true` or removes each. Confirmed relationships must be acyclic
   (`confirmed relationships form a cycle: a -> b -> a`); proposed ones do not
   count, since nothing schedules against them.
4. **Per-task state is durable (migration 10, `run_tasks`).** One row per plan
   task: state (`queued`, `running`, `completed`, `failed`, `interrupted`,
   `blocked`, `cancelled`), attempt, candidate commit and tree, dependency
   task IDs, reason and `updated_at`. Events `task.scheduled`,
   `task.completed`, `task.failed`, `task.interrupted`, `task.blocked` and
   `task.cancelled` carry the reason. `GET /api/v1/runs/{id}/tasks` lists
   them. Startup recovery marks running tasks `interrupted` in the same
   transaction that interrupts attempts and abandons leases.
5. **The scheduler dispatches in dependency order under the existing
   gates.** `POST /api/v1/runs/{id}/implement` on a plan with several tasks
   rechecks, before any state changes, what `begin_implementation` checks for
   one writer (approval, ticket, manifest and base binding, a passed baseline
   per repository, free repositories) with one environment fingerprint per
   repository, since each repository's required recipes fingerprint its own
   tools; every task repository must be at its planned base with its
   registered identity; the attempt budget must hold every task that will run
   (`used + to_run <= max_attempts`, each task is one attempt). The graph is
   one active run against the global limit of four. The scheduler dispatches
   every queued task whose dependencies completed, concurrently up to
   `max_workers`, never two writers in one repository (the lease stays the
   durable rule), each task a writer attempt in its own Luuna-owned worktree
   through the M2c writer path unchanged (scope guard, post-session
   judgement, Luuna writer identity). A task whose dependency failed, was
   blocked, cancelled or interrupted is recorded `blocked` with the
   dependency's reason; independent tasks still run. A consumer's writer and
   its repository's checks receive, for each completed producer it depends
   on, `LUUNA_DEPENDENCY_<REPOSITORY>_PATH` (the producer's preserved
   candidate worktree) and `…_COMMIT`, with the repository ID uppercased and
   dashes as underscores, and the writer's system prompt states them. When
   every task completed, one `CandidateSet` is recorded whose
   `repository_commits` holds every repository's exact commit and whose
   `dependency_bindings` maps `<consumer>:<producer>` to the producer commit
   (the domain validates that both name repositories of the set and the
   producer's exact commit); the run then waits in `validating` as today.
6. **Validation runs every repository's recipes in its own candidate
   worktree with the bindings.** A validation generation resolves and verifies
   one worktree per repository, resets each (`candidate.worktree_cleaned`
   names the repository), runs every required recipe of every repository
   inside that repository's worktree with the same `LUUNA_DEPENDENCY_*`
   variables the writer saw (the executor's `CommandSpec.environment`), binds
   each result to its repository's exact commit, verifies every worktree
   between stages, and gives the fresh reviewer one bounded combined diff
   (per-repository sections under `# repository <id>: <base>..<commit>`
   headers, every changed path listed with its `repository_id`, attention
   paths prefixed by repository) plus the set's repositories and bindings.
   A failing required check names its repository and recipe and, for a
   multi-repository set, states `integration blocked: the candidate set is
   not accepted`; a producer's own passing check never stands for integration
   success. `GET …/diff` adds `repositories` (one entry per repository) and
   `dependency_bindings`; its top-level fields repeat the first repository's,
   so a single-repository candidate reads as before.
7. **Repair of a multi-repository set is re-planning.** `POST …/repair` and
   the `repair_allowed` decision refuse a set with more than one repository
   (`repair is not available for a multi-repository candidate set: create the
   next plan revision (re-plan) …`): a repair writer in one repository cannot
   re-establish the other repositories' bindings, so no single-repository fix
   stands for the set. Automatic repair stops with the same reason. The
   chosen limitation is recorded here rather than implemented halfway.
8. **Resumption by task under the original approval, within the approved
   budgets.** `POST …/implement` with `task_id` on an `interrupted` or
   `failed` workflow whose named task is `interrupted`, `failed` or `blocked`
   re-enters implementation (the domain admits `Interrupted -> Implementing`
   structurally for this gate only), requeues every task that did not
   complete and keeps completed tasks' commits, worktrees and evidence.
   Attempts still count against the plan budget. An attempt lost mid-prompt
   reserves the remaining approved cost budget exactly as ADR 0009 point 5
   records for one writer, so after a hard kill or an orderly shutdown of a
   writer that was mid-prompt the task-state gate admits the resumption and
   the budget gate refuses it with its re-plan requirement before anything
   runs; a task that failed with reported usage resumes. Cancellation stops
   every running task's writer and records the tasks and the run cancelled;
   queued tasks never start.

## Consequences and validation

`crates/luuna-runtime/tests/multirepo.rs` drives a three-repository Python
fixture (`api -> shared -> consumer`, real `python -m unittest` checks, the
consumer importing the shared package through `LUUNA_DEPENDENCY_SHARED_PATH`)
with the synthetic Pi fixture: a compatible change producing three exact
candidate commits, bindings in the consumer writer's environment and prompt,
three check results bound to exact commits and a reviewed set; an
incompatible shared change (`write_rename_function`) that passes the shared
check and fails the consumer check, blocking the set with the integration
reason and refusing repair; three independent tasks overlapping within
`max_workers = 2` while a fourth worker is refused; a failed producer blocking
its consumer with the reason and the failed task resuming by `task_id`
(`write_if_released`); a hard kill (startup recovery on the live database)
and an orderly shutdown leaving the completed task's commit and worktree
intact, the graph visible after restart and resumption refused by the budget
reservation; cancellation recording every task cancelled; and a cyclic plan,
a self or unknown dependency, two tasks in one repository, a confirmed cycle
and an unconfirmed proposed relationship each refused. Domain unit tests
cover the DAG rules, `max_workers` bounds and binding validation; discovery
unit tests cover the three relationship sources. Everything is synthetic:
no model or provider is involved, and the developer checkouts are byte
identical afterwards.

The executor gained an additive `CommandSpec.environment`, set after the
sanitized host environment, so checks can receive bindings; the candidate
check index column keys a multi-repository set's results by
`<repository>/<recipe>` (the payload names both; single-repository rows are
unchanged), and artifact identities of such sets carry the repository.

## What remains for full M4

- **P42 delegated roles.** Every task still runs with the `implementer` role
  and the same Pi writer profile; project orchestrator and repository-lead
  roles with their own context and assignment traces are not implemented.
- **P44 dependency overrides.** A plan's `depends_on` is taken as written;
  no override of a confirmed relationship (adding or waiving an edge with a
  reason) is recorded, and plans are not yet checked against the confirmed
  relationship graph.
- Shared contract artifacts beyond the producer worktree and commit (for
  example generated API schemas as named artifacts) are not modelled.
- A dependent change inside one repository in the same plan, and repair of a
  multi-repository set, remain re-planning.
- Desktop and client wiring of `tasks`, `max_workers`, `GET …/tasks`, the
  task events and the multi-repository diff view is client work outside this
  ADR.
