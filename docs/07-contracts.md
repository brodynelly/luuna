# Domain and API contracts

## Contract status

All identifiers, routes, state names, schemas, and records in this package are proposed Luuna application contracts. Implementing code must validate them and generate matching client types. Upstream APIs retain their own definitions.

## Core records

| Record | Essential fields |
| --- | --- |
| Project | id, name, manifest_revision, repositories, relationships, policy |
| Repository | id, remote_identity, default_branch, stack_profiles, check_recipes, execution_profile |
| Relationship | producer, consumer, kind, contract_reference, evidence, confirmation |
| Ticket | id, source_revision, goal, acceptance_criteria, repository_ids, dependencies |
| PlanRevision | id, revision, ticket_revision, manifest_hash, base_commits, tasks, required_checks, budgets, hash |
| Approval | id, plan_hash, approved_by, approved_at, permissions |
| Assignment | id, task_id, role, repository_id, environment_id, context_manifest, tool_profile |
| CandidateSet | id, revision, plan_hash, repository_commits, dependency_bindings, hash |
| CheckResult | id, recipe_id, candidate_hash, environment_fingerprint, command, exit_code, status, artifacts |
| ReviewResult | id, candidate_hash, reviewer_session, findings, verdict, evidence |
| Publication | ticket_id, candidate_hash, per_repository_branch, PR URL, publication_state |

Task dependencies form a directed acyclic graph. Reject cycles and unknown repository IDs. Relationship cycles can describe runtime systems, but do not automatically become executable task dependency cycles.

## Approved plan hashing

Validate the plan before approval. Use a versioned canonicalization algorithm with deterministic key ordering and explicitly normalized values. Hash the complete executable payload, including repository scope, base commits, operations, check recipes, resource profiles, and budgets. Exclude the hash field itself.

The approval endpoint checks both expected revision and hash in one transaction. Never let a browser assemble an approval by sending only a ticket ID. Store the approval event durably before scheduling write work.

## Local API surface

| Method and route | Responsibility |
| --- | --- |
| GET /api/v1/capabilities | Supported features, engines, hosts, versions |
| POST /api/v1/projects | Register project or begin guided creation |
| POST /api/v1/projects/{id}/discover | Produce a proposed repository map |
| PUT /api/v1/projects/{id}/manifest | Save confirmed map with revision guard |
| POST /api/v1/projects/{id}/tickets | Create work through the Seeds adapter |
| POST /api/v1/tickets/{id}/plans | Begin exploration and planning |
| POST /api/v1/plans/{id}/approvals | Approve exact plan hash |
| POST /api/v1/runs | Schedule an approved plan |
| POST /api/v1/runs/{id}/cancel | Cancel owned execution |
| POST /api/v1/runs/{id}/resume | Reconcile and resume eligible paused work |
| GET /api/v1/runs/{id} | Current authoritative projection |
| GET /api/v1/runs/{id}/events | Durable event stream with resume cursor |
| GET /api/v1/runs/{id}/artifacts/{artifact_id} | Authorized artifact access |
| POST /api/v1/runs/{id}/publish | Reconcile publication after gates |
| GET/POST/PATCH/DELETE /api/v1/memory | Scoped memory controls |

State-changing requests carry an idempotency key where repeat delivery can create work, and an expected revision where stale state matters. GET does not mutate work. Reject unknown schemas with actionable errors. Clients cannot request arbitrary filesystem paths as artifact IDs.

Use HTTP commands and a server-sent event stream initially. Add a WebSocket channel only where bidirectional terminal sessions justify it. Both browser and TUI consume the same API and capabilities.

## Event envelope

Every event includes schema_version, event_id, sequence, timestamp, project_id, run_id, type, and payload. Sequence is monotonic within a run. Delivery can be repeated; clients deduplicate by event ID and recover a projection if their cursor is older than retained history.

Examples include run.started, task.queued, task.started, worker.output, check.finished, review.finished, run.paused, publication.updated, and run.completed. Emit the state mutation and its durable outbox event within one database transaction.

Classify worker text separately from domain events. The text 'tests passed' from a model is worker output, not check.finished with status passed.

## Check recipes

A recipe has an executable, argument array, explicit working directory, timeout, required capability set, expected artifacts, and whether it is a required gate. Environment values are references or approved nonsecret configuration. Recipes that need a shell declare it explicitly and are reviewed for the selected platform.

Map recipe results to passed, failed, blocked, cancelled, or interrupted. Record exit code and artifact identity. A recipe must not report passed on a missing executable, empty test suite, killed process, or incomplete log stream.

## Candidate integrity

Create a candidate only after committing intended changes in managed branches, or record a stable tree hash for precommit checks and repeat binding after commit. Publication requires commit-bound results. Verify there are no unrecorded worktree changes between checks, review, and push.

Review results include structured findings with severity, path, location, explanation, and evidence. The runtime checks verdict consistency; blocking findings require repair or approved scope reconsideration, not a free-form verbal override.

## Schemas and examples

schemas/project.schema.json validates the illustrative project manifest. schemas/result.schema.json validates a compact check result. schemas/event.schema.json validates the event envelope. They cover the supplied examples and core boundaries, not the entire future API. M0 must complete PlanRevision, Approval, Assignment, CandidateSet, ReviewResult, and Publication schemas before implementation relies on those records.

examples/ contains a multi-repository project, candidate manifest, plan outline, check result, event, and dependency bindings. Placeholder commits in non-schema examples must be replaced with observed commits before use. No sample is executable product configuration until the corresponding capability is implemented.
