# ADR 0027: the advertised v1 acceptance scope for optional and host-bound capabilities

Date: 2026-10-22. Status: **accepted on the maintainer's best estimate
(2026-10-22, see "Decision taken" below); the owner may revise any point, and
a revised point returns to the backlog with its original wording.**
The October 22 specification audit ([SPEC-AUDIT-2026-10-22.md](../SPEC-AUDIT-2026-10-22.md),
findings 6 and 7) asked that several capabilities the specification advertises
as optional, host-bound or experience-level be resolved explicitly in the
acceptance scope rather than silently passed. This record names each one, what
exists, and the decision proposed for the v1 label. Nothing here relaxes a
runtime guard; it only states what the release report may count as complete.

## Decisions proposed

1. **Container execution profile (A32, docs/03-architecture.md "Container
   mode").** The runtime records the execution profile of every confirmed
   manifest and refuses `container` outright: native execution runs with host
   permissions, and no reviewed container profile (workspace mounts, resource
   limits, credential references, no host root or Docker socket) exists.
   Proposed decision: container execution is **out of the v1 acceptance scope**.
   A32 is satisfied for v1 when the recorded profile is `native` and the
   advertised behaviour (host permissions, no confinement claim) matches actual
   access, which the existing tests establish; the `container` refusal stays,
   so a manifest cannot advertise an isolation the runtime does not provide.
   Container support returns as a post-v1 ADR with a reviewed profile and
   capable-host evidence. The roadmap's "test optional container execution on
   supported hosts" is then a v1.x item.

2. **Native Android and iOS scaffolding (R13, A05, A31).** Discovery proposes
   real recipes for both profiles with their device/Xcode capabilities, an
   incapable host blocks them explicitly, and scaffolding returns a blocked
   proposal naming Android Studio or Xcode followed by import (ADR 0019).
   Proposed decision: v1 **advertises native mobile support as import plus
   capability-gated checks**, not as generated projects. The release report
   counts R13 complete for Android and iOS only once a capable runner has
   produced a positive build/test baseline from an imported project; generator
   implementation is not required for the v1 label.

3. **Go and Flutter scaffolds and the React/Next.js network step.** Proposals,
   refusal without network consent and hash confirmation are tested offline.
   Proposed decision: these profiles count as complete only with capable-runner
   evidence (a passing baseline recorded by revision), as ADR 0019 already
   states; no change in scope, only in what the report may claim.

4. **Experience chapter surfaces (docs/09-experience.md: Home, Kanban, Help,
   settings, external-editor handoff).** The desktop presents projects,
   workflows, candidates, diffs, publication and component panels; it has no
   Home summary, Kanban projection, Help surface, settings panel or editor
   handoff. Proposed decision: **Kanban is a required v1 projection** of
   authoritative work state (the chapter states it cannot bypass a gate) and
   the **Home summary** and **Help** surfaces are required v1 experience
   deliverables; the **external-editor handoff** is accepted as "open the
   candidate worktree path in the developer's editor" (a path display and a
   copy action, no editor integration), and **settings** are the runtime's
   environment and credential presence as shown by `doctor`, not an in-app
   editor for credentials. These remain open client work and the release
   report lists them as such until they exist.

5. **Interactive terminal client audit (ADR 0020 "What remains").** The
   command mode is tested by `scripts/tui-smoke.mjs`; the interactive menus,
   keyboard handling, narrow-terminal rendering and status tones are not.
   Proposed decision: the interactive mode is **in scope for v1 parity** and
   the audit is a required deliverable; until it exists, R02 stays partial
   for the interactive mode and complete for the command mode.

6. **Supported platforms (R01, A01, A02).** Mac ARM64 and Windows x64 remain
   the advertised release targets. Proposed decision: unchanged. No Linux
   desktop target is advertised; Linux evidence is development evidence.

## Consequences

- The release report may mark A32 established for the native profile and
  must state the container refusal as a scope decision, not as a gap, once
  this record is accepted.
- R13 and M5 wording changes from "every advertised profile scaffolds" to
  "every advertised profile discovers, blocks or baselines correctly on a
  capable host; Android and iOS projects are imported".
- The client backlog gains Home, Kanban, Help, editor handoff and the
  interactive terminal audit as named v1 items.

## Note, 2026-10-22: point 4 surfaces that now exist

The items of point 4 were implemented as client work the same day, as projections of existing routes (no catalog entry was added): the desktop **Home** summary (`apps/desktop/src/Home.tsx`: projects, validation health as the latest baseline per repository, blockers as testing-setup prerequisites and failed, paused, interrupted or testing-blocked workflows, a create-ticket shortcut into the Projects panel), the **Kanban** projection (`Board.tsx`: the chapter's columns backlog, testing prerequisite, discovery/plan, approval, implementation, checks, review and PRs over the recorded run states through `RUN_COLUMN`; cards are read-only and open the ticket's own panel, and the view says that dragging is not implemented), the **Help** panel (`Help.tsx`: onboarding steps, what each state means through the six tones, where evidence lives, links to the documents) and the **external-editor handoff** on the candidate view (`CandidateReview.tsx`: each worktree path of the run with a copy control, no editor integration). The projections live in `packages/api-client/src/projections.ts` and the TUI prints the same ones through `luuna-tui home` and `luuna-tui board`; `scripts/check-contracts.mjs` traces each surface (`REQUIRED_SURFACES`) to the catalog entries it projects, a `data-surface` desktop panel and the TUI projection. **Settings** stay as decided: the runtime's `doctor` output, not an in-app editor. The interactive terminal audit of point 5 remains open.

## Decision taken, 2026-10-22

The owner asked that each of the six points be resolved on the maintainer's
best estimate rather than left open. Each proposed decision above is taken as
written, with these estimates recorded so a later owner can see what they
rest on:

1. **Container execution: out of v1 scope.** Native execution is what every
   piece of evidence used and what the contract records; an unreviewed
   container profile would advertise confinement the runtime cannot prove.
   The `container` refusal stays. A32 is counted established for the native
   profile.
2. **Native Android and iOS: import plus capability-gated checks.** No host
   here or in the recorded runs had Android Studio or Xcode; generated
   projects for those toolchains cannot be verified and would be the least
   trustworthy part of the release. R13 counts complete for them once an
   imported project baselines on a capable runner.
3. **Go, Flutter, React/Next.js: capable-runner evidence required.** No
   change in scope; the report may not claim them from offline proposals
   alone.
4. **Home, Kanban and Help are required and exist; editor handoff is the
   worktree path shown and copied; settings is the runtime's `doctor`
   output.** The first four surfaces exist on this branch (dated note
   below); the settings surface is delivered as a read-only doctor report in
   both clients (a `doctor` route and catalog entry, the desktop `Settings`
   panel and `luuna-tui doctor`), never an in-app credential editor.
5. **The interactive terminal mode is in v1 parity scope and its audit is
   required.** The audit is delivered as a reproducible harness
   (`scripts/tui-interactive-audit.mjs`, ADR 0020 third amendment) with the
   defects it found fixed; R02 counts complete for both modes once it passes.
6. **Mac ARM64 and Windows x64 remain the release targets; Linux is
   development evidence only.** Unchanged.

## What remains

- The owner's review of the estimates above; a rejected point returns to the
  implementation backlog with its original wording.
- Capable-runner evidence for points 2 and 3 and fresh-host evidence for
  point 6 still need those hosts (see RELEASE-EVIDENCE.md).
