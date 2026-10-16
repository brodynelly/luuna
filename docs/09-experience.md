# User experience and installation

## Entry points

Install Luuna, select a model/provider supported by the tested Pi profile, and open either the browser interface or the TUI. The same service stores projects and runs for both. A CLI provides automation and editor commands. No account is required for the local product.

The installer checks Git, the supported Pi release, its runtime requirements, and selected upstream tool dependencies. It offers explicit managed installation or documented existing-tool reuse. It does not silently replace global tools. Pin versions and verify downloads through the chosen release mechanism.

Machine setup is distinct from project toolchains. Luuna can guide setup of Go, Python, Flutter, or platform SDKs, but must report missing requirements rather than promising an installation can execute every stack immediately.

## New project

Ask about desired behavior, repositories, stack, constraints, and acceptance criteria. Propose the repository map, tooling, test baseline, and scaffolding plan. Obtain approval before creating source repositories or writing code. Establish tests before feature implementation.

## Existing project

Select the execution host and folders. Inspect manifests, instructions, lockfiles, package links, schema generation, API clients, and test recipes. Propose relationships with file references and uncertainty markers. The developer confirms the map and resolves unknowns.

Register the repositories with stable identities. Preserve uncommitted developer work. Work from task worktrees based on explicit commits rather than resetting the user's checkout.

## Views

| View | Main actions |
| --- | --- |
| Home | Project summary, validation health, blockers, create ticket |
| Repository map | Confirm relationships, inspect evidence, change host/path mappings |
| Kanban | Backlog, testing prerequisite, discovery, approval, implementation, checks, review, PRs |
| Plan | Task graph, contract changes, permission scope, budgets, approve revision |
| Live run | Workers, commands, output, costs/usage, pause, cancel, recover |
| Changes | Per-repository diff, candidate identities, review findings, external-editor handoff |
| Memory | Inspect/edit/delete records, override scope, promote process lessons |
| Settings | Models, execution profiles, validation commands, credentials status |
| Help | Onboarding guide, system operation, project usage questions |

Kanban is a projection of authoritative work and run state. Dragging a card cannot bypass a validation gate or approval.

## Browser and TUI parity

Maintain a capability catalog listing every user action and both client implementations. Both support project creation, relationship confirmation, ticket editing, plan approval, execution profiles, run control, diffs, findings, memory operations, and PR inspection. Use text/table alternatives for graphical maps.

Browser-owned controls cannot call privileged Pi methods directly. TUI shortcuts cannot bypass the API. Both clients show the same blockers and approval revision.

A built-in full editor is unnecessary for v1. Support file inspection and basic explicit edits through API-backed actions; any manual candidate edit invalidates affected checks. Opening an external editor does not transfer permission to run agents outside approved scope.

Third-party Pi terminal widgets are outside the Luuna parity promise unless adapted. Luuna's own features must never depend on a terminal-only extension.

## Lifecycle and portability

Closing a client leaves the local service running. A local machine sleeping suspends its ability to make progress. Restart recovery reports interrupted work honestly and reconciles before resuming. Show whether a task is running locally or on a remote host.

A project export contains portable identities and configuration, not credentials or mandatory absolute paths. On another computer, the developer maps repository IDs to folders, configures credentials, and re-establishes host-specific baselines. Do not silently synchronize live task ownership across independent services.

## Accessibility and responsiveness

Use keyboard navigation, visible focus, text alternatives, readable diffs, and streamed output with pause controls. Large logs are paginated or virtualized. Client reconnection reloads authoritative state before replaying later events.
