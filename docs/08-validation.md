# Testing, evidence, and publication

## Testing prerequisite

Feature work requires a usable testing setup and a passing baseline in every affected repository. A repository that participates in required integration checks also needs the relevant usable checks. Detecting a test framework or a script name is insufficient.

Execute the proposed baseline against recorded source commits in a controlled environment. Confirm tests actually ran, required services were available, and success was not a skip-only or empty suite. Preserve result evidence.

If testing is missing, create a prerequisite ticket with its own plan approval. Implement a minimal meaningful harness and checks for existing behavior, then establish a passing baseline. Do not treat tests written after a feature as proof that the prerequisite existed before feature work.

A failing baseline becomes a prerequisite repair task. Do not disable assertions, remove failing tests, or weaken check recipes simply to unblock the feature. Necessary legitimate changes to test policy require a revised plan.

## Stack profiles

| Profile | Discover | Establish and run |
| --- | --- | --- |
| React/Next.js/TypeScript | Package manager, lockfile, test scripts, tsconfig, framework | Unit/component tests, type check, configured lint, build, relevant browser tests |
| Go | go.mod, toolchain, test packages, external services | Package tests, configured analysis, build; race checks where supported |
| Node.js | Runtime, package scripts, module mode | Existing runner or approved setup, types where present, lint/build |
| Python | Environment manager, pyproject, dependencies | Existing runner or pytest setup, configured typing/lint, relevant packaging checks |
| Flutter | SDK version, targets, plugins | Unit/widget tests, analysis, selected build and integration target |
| Native iOS | Xcode project/workspace, schemes, simulators | Scheme-specific tests and build on a capable Mac |
| Native Android | Gradle wrapper, SDK, device requirements | Unit tests, lint/build, instrumentation where required |

Commands come from confirmed recipes, not a universal hard-coded shell line. A unit test cannot substitute for a required native build. CI-only platform steps must have a capable pre-publication runner or the ticket remains blocked.

## Validation stages

First, verify the baseline. Second, run feature-specific checks against the changed candidate. Third, run static analysis, build checks, and repository conventions. Fourth, obtain independent review. Fifth, run project-level contract and integration checks across the exact candidate set.

If integration requires code repairs, repeat affected repository checks and review as well as integration. Generate the PR summary from recorded artifacts rather than inventing a test list.

## Reviewer independence

The reviewer receives acceptance criteria, approved scope, a candidate diff, relevant current files, base/candidate identities, and execution evidence. It gets no implementation transcript. A different model is optional; a separate conversation and evidence-based assignment are required.

The reviewer checks behavior, regression risks, API compatibility, test quality, secrets exposure, authorization-sensitive paths, and whether claimed validation actually ran. It can request targeted verification in a disposable environment. The runtime still enforces all deterministic gates.

## Evidence requirements

Record source commits, candidate hash, command and arguments, working directory, tool versions, environment fingerprint, start/end timestamps, exit code, result status, log reference, and relevant report hashes. Preserve a bounded output excerpt for the interface and full authorized logs as artifacts.

Invalidate affected evidence on code changes, dependency binding changes, modified recipes, changed required environment, rebase, or conflicting external edits. A candidate hash matching only one repository is insufficient for a multi-repository integration check.

## Publication rules

Required pre-publication checks and review must pass before automatic PR creation. Publication uses a dedicated credential scope; coding workers do not get the publisher's authority. Run a deterministic secrets/path policy check before push.

Create linked PRs with change summaries, validation evidence, dependencies, and merge order. Persist each branch and PR URL as it succeeds. On timeout, inspect the remote state before retrying. Duplicate delivery must not create a second PR for the same publication identity.

PR-triggered CI runs after creation. Display its status separately from completed local checks. CI failures can trigger bounded repairs within approved scope. A human chooses when to merge, subject to repository protections.

## Cross-repository compatibility

Test unmerged candidates using explicit dependency overrides, package artifacts, generated clients, or temporary endpoints. Record which strategy was used. Avoid modifying an unrelated developer checkout to make integration work.

Multiple PRs are not atomically merged. Require compatible rollout order, temporary compatibility, or an explicit staged plan. If partial merge makes the remaining candidate obsolete, re-plan/revalidate instead of claiming the coordinated ticket is done.

## Completion language

Use 'PRs created' when publication succeeded. Use 'required checks passed' only for the specified candidate and environment. Use 'integrated' only after every required repository change is merged and the applicable integration policy is satisfied. Missing, skipped, or unavailable required checks are blockers.
