# ADR 0023: delegated roles, assignment traces and dependency overrides

Date: 2026-10-22. Status: accepted; closes the P42 (delegated roles) and P44
(dependency overrides) items ADR 0017 left open and completes the R06
obligation (traceable parent/child task records) for M4.

## Context

ADR 0017 made a plan's task graph a validated contract and scheduled it in
dependency order, but every task still ran with the `implementer` role and
the same Pi writer profile, and a plan's `depends_on` was taken as written:
nothing compared the graph with the project's confirmed repository
relationships, and no departure from them was recorded. docs/04-orchestration
names a project orchestrator (acceptance criteria, cross-repository contracts,
dependency order, risk, integration), repository leads (local commands,
affected modules, task boundaries, check coverage; they advise and never
approve scope or publish) and specialists (one bounded assignment), and
requires that no role creates unbounded descendants and that every child task
is validated against the approved graph, limits and budget before launch. R06
requires traceable parent/child task records. The role contracts in `agents/`
existed as prose only.

## Decision

1. **Roles are explicit on the task and the runtime stays authoritative.**
   `PlanTask.role` is one of `implementer`, `repository_lead` or
   `project_orchestrator` (`TaskRole`); any other value is refused by name.
   The field was already serialized, so earlier plans hash unchanged
   (`fixtures/domain/plan.valid.json` is byte-identical). An advisory role
   (`repository_lead`, `project_orchestrator`) must carry exactly the `read`
   operation: its Pi session receives read-only tools, the scope guard and
   the role contract from `agents/project-orchestrator.md` or
   `agents/repository-lead.md` embedded at build time as its system prompt,
   together with the plan's other tasks and the recorded results of the
   advisory tasks it depends on as fenced reference data. The role changes
   what the worker is told and which tools it has, never a runtime gate: the
   approval, baseline, lease, budget, scope and candidate rules apply exactly
   as to a writer.
2. **An advisory task produces a structured result, never a commit.** After
   its session settles, the existing post-session judgement runs; because the
   task has no `write` operation, any changed path is a scope violation
   (`… is not permitted to write but changed N path(s) (advisory role
   repository_lead must leave the worktree unchanged; it changed src/main.py)
   …`) and the attempt fails with the worktree preserved. With the worktree
   unchanged, the final assistant message must carry one JSON object
   (`AdvisoryResult`: `findings`, `proposed_tasks`, `risks`, bounded to 64
   entries per list, 64 000 bytes, well-formed proposed tasks) or the attempt
   fails naming the task and the reason. The validated result is recorded on
   the attempt (`advisory_result`) and on the task row (migration 12,
   `run_tasks.advisory_result`), is exposed by `GET /api/v1/runs/{id}/tasks`
   and the candidate view's `tasks`, and is carried by `task.completed`. The
   lease is released with no candidate commit.
3. **Advisory tasks join the graph without binding anything.** Any plan with
   an advisory task runs under the task-graph scheduler, a single advisory
   task included. An advisory task may share a repository with the one
   implementer of that repository (it writes nothing, so the candidate set
   still freezes one commit per repository); the one-writer-per-repository
   lease still serialises them. A dependency on an advisory task orders work
   and passes its result to the dependent's prompt; it creates no
   `LUUNA_DEPENDENCY_*` binding and needs no override. When every task of a
   plan is advisory, the run finishes `completed` (a structural
   `Implementing -> Completed` transition admitted only for this case) with
   no candidate and the reason that the next plan revision carries what the
   developer adopts. The repair route never selects an advisory task.
4. **Assignment traces (R06).** Every task row records its `role`, who
   assigned it (`assigned_by`: the approval's `approved_by`, `approval_id`,
   `approved_at`, `plan_id`, `plan_revision`, `plan_hash`), the plan's
   `dependency_overrides` that name it, its dependencies and the attempt that
   executed it. A new `task.assigned` event is appended per task when the
   graph starts, and every `task.scheduled` and `task.<state>` event repeats
   the trace fields. The optional plan field `PlanTask.derived_from_task`
   names the advisory task whose proposal the developer copied: the domain
   refuses a task that derives from itself or from a task of the same plan,
   and the runtime refuses a value that names no advisory task of an earlier
   revision of the ticket's plan. **The plan bounds everything**: the runtime
   never creates a child task, a proposed task becomes real only through a
   new plan revision the developer creates and approves, and that revision is
   validated like any other (graph, limits, budgets, relationships). This is
   the v1 answer to "no unbounded descendants".
5. **Dependency overrides (P44) are part of the immutable plan.**
   `PlanRevision.dependency_overrides` lists `{consumer, producer, action,
   justification}` entries (`waive` or `add`), hashed with the plan and
   absent from single-task serialization. The domain refuses an override
   naming an unknown or advisory task, two tasks of one repository, an empty
   or over-long justification, or a repeated consumer/producer pair. At plan
   creation the runtime checks the sealed plan against the confirmed
   manifest's relationships (`PlanRevision::check_relationships`), over
   implementer tasks only: for every confirmed `producer -> consumer`
   relationship whose repositories both carry an implementer task, the
   consumer task must `depends_on` the producer task unless a `waive`
   override names the pair; a dependency between implementer tasks whose
   repositories have no confirmed relationship needs an `add` override; an
   override that applies to nothing is refused, so every recorded override is
   a real departure. Proposed (unconfirmed) relationships imply nothing. A
   refusal names the relationship and the override that would allow the
   plan, for example `task consumer in repository consumer must depend on
   task shared in repository shared: confirmed relationship shared -> consumer
   (package npm:@fixture/shared); add the dependency, or waive it with
   dependency_overrides [{"consumer": "consumer", "producer": "shared",
   "action": "waive", "justification": "..."}]`. The overrides are echoed in
   the plan view, on each affected task record and its `task.*` events, and in
   `GET …/candidate` (`dependency_overrides`, `tasks`). An added edge binds
   the producer's exact commit like a confirmed one.
6. **Request contract.** `POST /api/v1/tickets/{id}/plans` task objects accept
   `role` (default `implementer`) and `derived_from_task`; the body accepts
   `dependency_overrides`. Defaults keep the pre-M4 idempotency identity of
   single-task requests. `schemas/plan-revision.schema.json` names the role
   enum, `derived_from_task` and `dependency_overrides`.

## Consequences and validation

Domain unit tests (`role_and_override_tests`) prove the role set, the
read-only rule for advisory roles, the derivation rules, the override list
rules, the relationship check (missing edge refused by name, waived, idle
waiver refused, unconfirmed relationships ignored, advisory tasks exempt,
`add` required and accepted, idle `add` refused), the bounded advisory
result and that a default-role task serializes without the new keys
(`fixtures/domain/plan.valid.json` hashes as before).
`crates/luuna-runtime/tests/multirepo.rs` drives the three-repository Python
fixture with the synthetic Pi: a plan missing the dependency a confirmed
relationship implies is refused with the relationship and the waiver named,
malformed overrides are refused, the waived plan runs with the override on the
plan, the task records, the `task.*` events and the candidate view; an `add`
override for an unconfirmed pair is required, accepted and binds the exact
commit; a project orchestrator runs alone (`advise_json`), writes nothing,
completes the run with its recorded result and trace and no candidate, after
which a second revision derives its implementers from it
(`derived_from_task`, an unknown parent refused) with a repository lead
preceding the writers and its result stated to the dependent writer; an
advisory task that changes a file (`advise_writes`) fails with the scope
reason and blocks its dependent, and one returning prose (`advise_malformed`)
fails by name. The developer checkouts are byte-identical afterwards.
Everything is synthetic; no model or provider is involved.

Storage migration 12 adds the trace columns to `run_tasks`; earlier rows read
as `implementer` with no trace. Single-task implementer plans keep the M2c
writer path unchanged and record no `run_tasks` row, so their trace remains
the plan, its approval and the attempt. Desktop and TUI display of roles,
traces and overrides landed the same day as client work: the shared builder
takes per-task `role` and `derived_from_task` and plan-level overrides, the
desktop has a role select per task row, an overrides editor opened by the
relationship refusal (pre-filled from the quoted override) and a task graph
showing the trace, the derivation, the overrides and the advisory result with
`Derive plan from this proposal`; the TUI has `--task …;role=…;derived_from=…`,
`--override` and `tasks` printing the trace (see docs/CURRENT-ARCHITECTURE.md,
client parity).

## What remains

- Specialist sub-roles beyond implementer (explorer, reviewer as plan tasks)
  and repository-lead consultation during execution are not modelled; leads
  and orchestrators run as planned tasks only.
- Shared contract artifacts beyond the producer worktree and commit remain
  unmodelled (ADR 0017).
