# Product proposal

## Purpose

Luuna gives an individual developer one place to coordinate bounded agentic changes across an application, its shared libraries, and its backend services. It combines a project map, ticket workflow, process prompts, relevant memory, isolated working directories, checks, independent review, and linked pull requests.

The central promise is concrete: approve a coordinated plan, let agents perform its bounded tasks, and receive reviewable changes with reproducible evidence. Completion is established by execution results and review against exact candidate commits, rather than by an agent's assurance that it finished.

Luuna should be practical on an ordinary developer computer. Mac and Windows are first-class installation targets. A browser interface and a TUI control the same local runtime with equivalent product capabilities. Linux is a recommended additional target and enables optional server or NAS deployment. No NAS, public hosting account, GPU, or remote service is mandatory for the local product.

## Intended developer workflow

The developer opens or creates a project. A project can contain several independent Git repositories. Luuna inspects them, proposes relationships and validation commands, and asks the developer to confirm the project map. For a new project, it proposes repository boundaries and establishes testing as part of the initial setup plan.

A ticket describes an outcome and acceptance criteria. Low-cost, read-only exploration workers collect repository evidence. One project orchestrator combines their findings into a plan. Repository leads contribute local details and report constraints through bounded handoffs. The developer approves the resulting plan before product code changes begin.

Luuna then prepares task worktrees and executes dependency-ready work. Each repository has one writer per task worktree. Checks run against the candidate changes. A fresh reviewer inspects the diff, relevant current code, requirements, and execution evidence without inheriting the implementer's conversation. Cross-repository checks exercise the exact candidate commit set together.

Once all required pre-publication gates pass, Luuna pushes task branches and creates linked PRs. It records PR links, dependencies, validation evidence, and proposed merge order. The developer decides when to merge. A coordinated change is not marked integrated just because its first PR was merged.

## Product boundaries

Luuna owns project coordination, approved scope, scheduling, durable run state, artifact lineage, validation gates, and publication. Pi runs individual agent sessions and connects to the developer's chosen models. Existing coding CLIs are not required as separate engines in v1.

Luuna-mulch provides scoped memory access. Luuna-canopy manages process instructions. Luuna-seeds manages work records and dependencies. Upstream tool integration and Luuna-specific extensions remain visibly separate. The product does not assume upstream tools already implement Luuna's workflow.

The editor remains part of the developer's workflow. Luuna provides file inspection, diffs, terminal output, basic bounded edits, and an external-editor handoff. A complete IDE, debugger suite, language server platform, and extension marketplace are outside v1.

## Why this design is useful

Cross-repository work fails when local changes silently disagree about interfaces, validation commands are unknown, parallel workers overwrite each other, or review repeats the implementer's assumptions. Luuna addresses those failure modes with a confirmed repository graph, explicit contracts, dependency-aware scheduling, worktree ownership, commit-bound evidence, and independent review.

Specialists are process experts. An authentication investigation specialist knows how to trace identity propagation and validate behavior; it retrieves the relevant code when assigned. Long-lived knowledge stays in scoped records with evidence. Agents do not need an ever-growing account of every implementation detail.

## Requirements established in the conversation

| Area | Established direction |
| --- | --- |
| Initial audience | Individual developers installing Luuna themselves |
| Starting point | New Luuna codebase |
| Platforms | Mac, Windows, browser access; NAS optional |
| Interface parity | The web interface can perform everything available in the TUI |
| Agent engine | Pi with different selected models |
| Project creation | Existing repositories and new projects |
| Project structure | Coordinated changes across multiple repositories |
| Agent organization | Project orchestrator, repository leads, scoped specialists |
| Autonomy | Human approves plan; implementation, checks, and review proceed automatically |
| Testing | Establish a usable testing setup before feature implementation |
| Failure | Limited repairs, then pause with evidence and a recommendation |
| Publication | Automatically create PRs after required checks and independent review |
| Integration | Developer controls merging |
| Project types | React/Next.js/TypeScript; Go/Node.js/Python; Flutter and native mobile |

## Recommended defaults

Use one active coordinated ticket per project, up to three exploration workers, and up to two implementation workers. Apply a machine-wide default ceiling of four model-active sessions; stage boundaries normally reduce simultaneous demand. One task worktree has one writer. Allow two repair cycles per failing task, plus an aggregate ticket budget so re-planning cannot reset the limit indefinitely.

Run against local development tools by default. Permit each repository to require a container. Native execution is an explicit host-permission mode, not a sandbox. Container profiles should expose only necessary mounts, credentials, and capabilities.

Keep personal memory private and available across projects with project-specific overrides. Keep project knowledge scoped to its project. Promote reusable process lessons across projects only through an explicit action.

Use Rust for the local service and TUI, retaining the initial product direction. Use React and TypeScript for the browser application, with Pi as a supervised RPC subprocess. These are proposed implementation choices, not additional user requirements. Validate the Rust/Pi boundary with an early vertical slice before building broad UI.

## Release shape

The first internal slice proves one repository and one ticket through an actual Pi session and deterministic gates. Subsequent milestones add test setup, independent review, multi-repository integration, all required stack profiles, full browser/TUI parity, and installation.

The public v1 scope includes the established multi-repository and interface requirements. A single-repository demo is a milestone, not a substitute for v1. Native platform checks must run on a capable host; unsupported required checks block completion instead of silently passing.

Optional authenticated remote workers, no-install hosted execution, a desktop wrapper, local GPU inference, and semantic embeddings follow after the local workflow is reliable.

## Success measures

Every PR can be traced to an approved plan revision, candidate commit set, validation records, and a passing independent review. No required gate is satisfied solely by model text. Closing a client does not terminate a running service-owned task. Interrupted state can be recovered without duplicating task execution or publishing duplicate PRs.

Track end-to-end completion, pauses by cause, repair counts, validation duration, review findings, model usage, and recovery outcomes. Collect performance baselines during the pilot before committing to latency or cost targets. A cost estimate should identify missing pricing data and should not imply provider billing accuracy.
