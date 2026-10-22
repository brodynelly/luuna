# ADR 0022: the testing-setup prerequisite workflow

Date: 2026-10-22. Status: accepted; closes the gap between the baseline gate of
[ADR 0007](0007-baseline-executor.md) and docs/08-validation.md "Testing
prerequisite" (R08, acceptance A06, roadmap M2b "missing testing setup creates
a bounded prerequisite workflow requiring its own approval").

## Context

The baseline gate correctly refuses feature implementation when a repository
has no passing baseline: no required check, an empty or skip-only suite, a
missing tool, or a failing check. Until now the runtime offered no way to
repair the first two. Ordinary writers (`POST /api/v1/runs/{id}/implement`,
`Store::begin_implementation`) require an already passing baseline per
repository, scaffolding creates new projects only, and `agents/testing-setup.md`
was a role contract no plan ever carried. An imported repository without tests
was stuck: the policy demanded a prerequisite ticket with its own approval, and
nothing could run it.

## Decision

1. **The offer is deterministic runtime evidence.** A settled baseline shows a
   missing testing setup when it is `blocked` and either the manifest names no
   required check for the repository or every required check exited 0 while its
   recognised runner counted no executed test (`BaselineEvidence::testing_prerequisite`,
   reusing the executor's empty/skip-only classification). A missing tool or
   dependency, a dirty checkout, a failed check or a mixed outcome is not this
   case and keeps its own next step: those are host or code problems, not a
   missing harness. The offer is a structured `TestingPrerequisite`
   (`kind: testing_setup`, project, repository, baseline, reason, `next`), recorded
   durably on the baseline run as `baseline.prerequisite_offered` and in its
   `run.failed` payload, returned on `GET /api/v1/projects/{id}/baselines` as
   each blocked baseline's `prerequisite`, on `GET /api/v1/projects/{id}` as
   `prerequisites` (one per registered repository whose latest baseline shows
   it), and on the 422 that refuses `implement` for an approved feature plan
   whose repository shows it (`{"error": ..., "prerequisite": {...}}`). The
   transactional gate behind that refusal is unchanged; the pre-check only
   names the next step.
2. **Purpose is a hashed property of tickets and plans.** `Ticket.purpose` and
   `PlanRevision.purpose` are `feature` (default, omitted from serialization so
   every earlier record keeps its bytes and hash, which the fixture tests prove)
   or `testing_setup`. The plan copies the ticket's purpose when it is made;
   it is part of the sealed hash and so of the exact approval. A `testing_setup`
   plan has exactly one task, that task carries the `testing-setup` role, it
   repairs no candidate, and it names at least one required check recipe for its
   repository; a feature plan may never carry the `testing-setup` role. Only the
   purpose, never a role name or a prompt, changes an admission.
3. **The setup plan proposes the baseline's recipes.** `POST
   /api/v1/tickets/{id}/plans` on a `testing_setup` ticket accepts `checks`:
   recipes in the manifest-check shape (`id`, `executable`, `args`, `cwd`,
   `timeout_seconds`, `capabilities`; `required` may be given but must be
   true). They are validated with the same rules a manifest confirmation applies
   (no absolute paths, no shell without the capability, bounded arguments and
   deadlines) and become the plan's `required_checks`. Absent, the confirmed
   manifest's required recipes for the repository are used, since a repository
   with a discovered but empty suite often needs only the harness. `checks` on
   a feature plan is refused: feature checks are the confirmed manifest's. The
   recipes are part of the plan request identity, so an idempotent replay with
   different recipes is a conflict. Discovery's proposed-but-unconfirmed checks
   are not read implicitly: the client passes them, so the approver sees the
   exact recipes in the plan it approves.
4. **Admission without a baseline, under every other gate.** `begin_implementation`
   and `begin_candidate_repair` skip the baseline requirement when the plan's
   purpose is `testing_setup` and record `prerequisite: testing_setup` in place
   of baseline identities; the approval, ticket and manifest binding, base commit,
   free repository and lease, attempt and cost budgets, host fingerprint, moved
   HEAD and identity checks stay as they are. The host fingerprint is computed
   for the recipes the plan proposes, which the manifest does not hold yet. The
   writer runs in the owned worktree as any writer, with the testing-setup role
   contract (`agents/testing-setup.md`, verbatim in a `ROLE_CONTRACT` section)
   and the exact recipes the runtime will execute in its system prompt. A
   testing-setup plan is one task: the task-graph scheduler is unchanged and
   never takes this admission.
5. **A setup candidate must make tests run.** Validation executes the plan's
   required recipes inside the candidate worktree exactly as for a feature
   candidate and starts the fresh reviewer only after they pass. Two rules make
   an empty harness fail closed: the executor still blocks an exit-0 check whose
   runner reported nothing executed (`testing_blocked`, as for any candidate),
   and `finish_candidate_validation` additionally blocks a `testing_setup`
   candidate whose required checks all passed without any recognised runner
   summary counting at least one executed test. A recipe the executor cannot
   read a test count from (an unrecognised runner, a script that prints `ok`)
   therefore cannot establish a testing setup; the recognised runners are those
   of ADR 0007's amendment (cargo, go test, pytest, unittest, jest, vitest,
   Gradle test tasks).
6. **The baseline is established by the developer, explicitly.** The runtime
   does not confirm manifests or merge. `GET /api/v1/runs/{id}/candidate` of a
   testing-setup workflow carries `prerequisite` with the proposed `checks`, the
   candidate commit, whether the candidate is reviewed with a passed verdict,
   and the `next` step: merge the candidate into the developer checkout (or
   publish it and merge the pull request), confirm the next manifest revision
   with those checks as the repository's required checks, then run a normal
   baseline on the developer checkout. Feature plans are admitted only once
   that baseline passes; a feature plan made before the handoff is bound to the
   earlier manifest and must be re-planned, as after any confirmation. Tests
   written by a feature candidate are never the prerequisite: a feature plan on
   a repository without a passing baseline is refused whatever its diff contains.

## Consequences

- A06 has an API path: the runtime test
  `a_missing_testing_setup_blocks_features_and_the_setup_prerequisite_establishes_the_baseline`
  runs the whole loop against the synthetic Pi fixture (scenario
  `write_testing_setup` writes a real `tests/test_main.py`): the blocked
  baseline with the offer on the run, the baseline list and the project view;
  the approved feature plan refused with the structured offer; the setup
  ticket, plan (`purpose`, role, recipes), approval and admission without a
  baseline; the candidate validated with `python -m unittest` counting one
  executed test and reviewed; the feature plan still refused; the developer's
  merge, confirmation and passing baseline; and a feature writer then admitted
  with ordinary baseline identities. `a_setup_candidate_whose_checks_execute_no_test_cannot_pass`
  covers the skip-only harness and the exit-0 recipe without a runner summary;
  `only_a_testing_setup_plan_proposes_recipes_or_skips_the_baseline` covers
  `checks` on a feature plan, invalid and optional recipes, two tasks, the
  manifest fallback, idempotent replay and the feature refusal. Domain tests
  cover the hash preservation, the purpose rules and the offer classification.
- No storage migration: purpose lives in the ticket and plan payloads, and the
  offer is derived from recorded evidence. Schemas `ticket` and
  `plan-revision` gain the optional `purpose` property; no route was added, so
  the capability catalog is unchanged, and the new request fields (`purpose`,
  `checks`) and read fields (`prerequisite`, `prerequisites`) await client
  wiring in `@luuna/api-client`, the desktop and the TUI.
- Repairs of a setup candidate (manual or automatic) run under the same
  admission as its first attempt, since there is no baseline by definition.

## What remains

- **Manifest confirmation from a reviewed candidate.** `PUT …/manifest` still
  takes the recipes from the request; confirming them from the reviewed setup
  candidate's plan by hash would remove the one place a client can retype them
  differently. The handoff is explicit in the candidate view instead.
- **Baselines in leased worktrees.** The established baseline still runs in the
  developer checkout after the merge, with ADR 0007's dirty-checkout rules.
- **Client parity.** Desktop and TUI do not yet show the offer or create a
  `testing_setup` ticket with recipes (R02/ADR 0020).
- **Policy.** `policy.testing_prerequisite` remains required `true`; the
  prerequisite cannot be waived.
