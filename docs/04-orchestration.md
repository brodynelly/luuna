# Orchestration and control flow

## Fixed delegation hierarchy

The project orchestrator reasons about acceptance criteria, cross-repository contracts, dependency order, risk, and integration. A repository lead reasons about local commands, affected modules, task boundaries, and check coverage. A specialist performs one bounded investigation, implementation, or review assignment.

The scheduler can invoke repository leads when needed. No role can recursively create unbounded descendants. Every proposed child task is validated against the approved graph, host capabilities, concurrency limits, and budget before launch.

Scouts are read-only and may run in parallel. One project orchestrator composes their findings. Repository leads can advise the plan but do not independently approve scope or publish work.

## Plan content

The proposed plan identifies ticket and project, immutable revision, base commits, repositories, tasks, task dependencies, allowed paths and operation classes, interface contracts, command recipes, required tests, risk notes, execution profiles, budgets, acceptance criteria, and intended PR destinations.

Approve a deterministic plan hash that includes the manifest revision, prompt/model profiles, execution permissions, and validation recipes. An approval applies only to that plan revision. New repositories, expanded operation classes, changed security-sensitive configuration, or altered required checks require a revised plan and approval.

Implementation commits naturally advance beyond the approved base. They do not require repeated approval when the work remains within scope. Their evidence and reviews still bind to the current candidate state.

## State transitions

| State | Entry condition | Next action |
| --- | --- | --- |
| discovered | Repository inventory available | Confirm project map |
| testing_blocked | Testing missing or baseline failing | Run approved prerequisite task |
| exploring | Confirmed project and ready ticket | Collect evidence |
| plan_ready | Validated candidate plan exists | Request approval |
| approved | Matching approval and revision guards | Prepare execution |
| implementing | Ready task, owned worktree, available host | Perform bounded task |
| validating | Candidate state frozen | Execute required checks |
| reviewing | Required local checks pass | Fresh independent review |
| integrating | Repository results pass | Check exact multi-repository candidate |
| publishing | All pre-publication gates pass | Push and create linked PRs |
| pr_open | PRs exist and links are persisted | Observe CI and human decisions |
| integrated | All required PRs merged and project policy satisfied | Close coordinated ticket |
| paused | Blocker, exhausted repair budget, or material scope change | Present evidence and next step |
| cancelled | User cancellation acknowledged | Stop owned processes and preserve artifacts |

States apply at different levels. A repository task can validate while another ready task implements. The project cannot publish a coordinated PR set until all its required pre-publication gates are satisfied.

## Concurrency and dependency scheduling

Default to one active coordinated ticket per project, three exploration workers, two implementation workers, and one writer per worktree. A machine-wide limit of four model-active sessions is a starting profile. Limits count leads, scouts, implementers, and reviewers; they are enforced outside the model.

Dependency edges describe what must exist before another task starts. After contract approval, independent backend and client tasks may proceed together using versioned fixtures. A consumer that requires a generated library artifact waits until the artifact has been produced. Do not serialize everything by repository name; schedule by actual task dependencies.

All writers use separate task branches. If multiple tasks later affect one repository, combine them in a managed integration worktree and run review/checks on the combined candidate. Do not test one branch and publish a different assembled tree.

## Repairs and blockers

Recommend an initial attempt plus at most two repair attempts per failing task. Also enforce an aggregate ticket repair ceiling, elapsed-time limit, and user-configured spending limit where pricing is available. A new child task or plan revision does not silently reset accumulated usage.

Missing tools, credentials, host capabilities, unavailable services, or a failing baseline are blockers, not reasons for repeated code edits. Preserve the worktree and pause with the failed command, relevant output, attempts, likely cause, and one recommended next action.

A reviewer finding can create an in-scope repair task. A finding that demands material scope expansion returns the project to plan approval. Every repaired candidate runs affected checks and receives a new review.

## Integration candidate and publication

Freeze a candidate manifest mapping every participating repository to a commit and tree identity. Resolve dependencies through explicit local packages, artifacts, generated clients, or isolated test endpoints. Record those bindings with the check results.

Create one PR per changed repository. Unchanged repositories may still participate in integration tests. PR descriptions include the parent ticket, approved plan revision, linked PRs, dependency order, evidence summary, and any reviewer-approved limitations that do not waive required checks.

Publishing is resumable but is not a distributed transaction. If the backend PR succeeds and app PR creation fails, keep the successful URL and retry only the missing step. Identify branches and PRs deterministically; reconcile after a timeout before retrying.

CI that requires a PR runs after creation. It cannot be a prerequisite for the PR's existence. Pre-publication tests/review gate creation; required CI and developer approval gate merge. Failed later CI returns work to repair and invalidates affected evidence.

## Example

A referral ticket changes a Go API, a Flutter shared package, and a Flutter app. The contract specifies request fields and response behavior. The backend and package tasks can proceed after approval. The app task consumes the candidate package. Integration validates the app against the candidate server. Linked PRs communicate rollout order; backward compatibility or a staged rollout is required if one repository can deploy before the others.
