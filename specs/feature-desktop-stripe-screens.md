# Feature: Stripe-inspired visual language applied to every desktop screen

## Metadata

- Type: feature
- Source: user request; orchestration run `stripe-ui-20261022-0905`, wave 3, item D (run notes: `.tac/runs/stripe-ui-20261022-0905/{work-items,scout-design,style-spec}.md`)
- Date: 2026-10-22
- Branch: `orchestrate/stripe-ui-20261022` (desktop only; TUI untouched)
- Depends on: F1 `specs/feature-desktop-soehne-fonts.md` (fonts), F2 `specs/feature-desktop-stripe-foundation.md` (ADR 0032, tokens, lint revisions), B `specs/feature-desktop-stripe-primitives.md` (restyled controls/tables/tabs/StatusBadge/skeleton/progress and `ui/motion.tsx`: `Reveal`, `CountUp`, `CheckDraw`, `GlowSurface`, `Aurora`), C `specs/feature-desktop-stripe-shell.md` (shell, `app.css`, `App.tsx`, `shell/`, `content/views.ts`).
- Planning note: none of the B, C, F1 or F2 specs existed when this plan was written. The primitive names above are the agreed contract from `work-items.md`. **Before any edit, the builder must read the merged `apps/desktop/src/ui/index.ts`, `ui/motion.tsx`, `design/components.css`, `design/overlays.css`, the token sheets that F2 produced (`design/tokens*.css`), `design/design-system.test.ts` and ADR 0032. Then the builder must adapt every prop name, class and token named here to what was actually merged.** If a primitive named here does not exist, follow the fallback in Notes. Do not invent a parallel motion system.

## Feature Description

This item applies the Stripe-inspired language (an inspiration only: no Stripe name, logo or assets) to every desktop screen. The screens are Home, Board, Settings, Help, Projects (with nested Workflows, Candidate review and Project components) and Sessions. It composes the primitives that B ships, on the tokens that F2 ships. The changes are hero washes, count-up stat tiles, staggered entrances, glow feature cards, table-like record rows with hover emphasis, washed empty states, shimmer loading and a single-draw success check. It is purely a presentation change. No read, request, guard, state decision or accessible name changes. Approvals, baselines, candidate identity, validation, independent review and publication gates stay exactly as visible and as gated as they are today.

## User Story

As the Luuna developer, I want every screen to share one polished, calm, depth-and-motion visual language, so that the app feels coherent and modern while every piece of evidence and every approval stays unmistakable.

## Solution Statement

The work is confined to view markup (composition of `ui/` primitives, added class names) and to screen sheets under `apps/desktop/src/screens/` other than `app.css`. Motion comes only from B's `ui/motion.tsx`. Values come only from tokens. Motion is used for entrance, hover depth and the success moment, and only on surfaces that do not carry evidence. Evidence, approval and live-output regions get static depth (surface, hairline, shadow) and never animate, fade or dim. This keeps ADR 0031's sticky-scroll and caret contract and the design-system principle that "evidence never pulses". Where a pattern has no primitive (the stat tile), one small wrapper is added to `ui/` and listed below. Sessions styling sits in `app.css`, which belongs to C, so Sessions refinements go into a new `screens/sessions.css` that is registered in the manifest and the lint test.

## Out of Scope

- Any change to runtime reads, projections, request bodies, guards, tone maps or state logic. This includes `design/tone.ts`, `workflow-state.ts`, `failures.ts`, `candidate/rules.ts`, `workflows/{model,read,settings,useWorkflowActions,useWorkflowData}.ts`, `projects/{useProjects.tsx,project-actions.tsx,project-model.ts}`, `project-components/{useComponents.tsx,model.ts}` and `@luuna/api-client`.
- `sessions/useSessionReplay.ts`, `sessions/followSession.ts`, `sessions/frameCoalescer.ts`, `ui/stickyScroll.ts`, `ui/useStickyScroll.ts`, `ui/glide.ts`: these files must not change at all.
- Item C's files: `screens/app.css`, `App.tsx`, `shell/*`, `ui/shell.tsx`, `content/views.ts`. Item B's primitives in `components.css`, `overlays.css`, `ui/{controls,layout,content,selection,menus,palette,motion}.tsx` and `design/StatusBadge.tsx`. These may be read but not restyled. The one exception is the listed wrapper below.
- Adding a "recent runs" projection to Home, real drag and drop on the Board, editable settings or toggles on Settings, or a modal/overlay drawer. These would be behavior or logic changes. See the per-screen mapping below.
- Converting any acknowledgment checkbox (plan approval, scaffold review, rebind, retention, memory selection) into a switch.
- The TUI, the runtime, schemas, the mono font, and the Playwright visual QA pass (item Q).

## Relevant Files

Read first: `AGENTS.md`, `docs/DESIGN-SYSTEM.md` (principles 1 to 9, "Following live output", Accessibility), `docs/decisions/0031-client-frame-pacing.md`, ADR 0032 (F2), and the merged B and C specs.

Views (markup and class changes only):

- `apps/desktop/src/Home.tsx` - hero wash, stat tiles, staggered blockers and projects, GlowSurface project cards, washed empty state.
- `apps/desktop/src/Board.tsx` - column depth, staggered card entrance, hover lift via CSS.
- `apps/desktop/src/Settings.tsx` - grouped report card, single CheckDraw beside an `ok` verdict.
- `apps/desktop/src/Help.tsx` - docs layout, new static "Keyboard shortcuts" topic with `kbd` styling.
- `apps/desktop/src/projects/{ProjectRail,ProjectDetail,Baselines,Discovery,EventRecord}.tsx` - table-like rows, detail-panel depth, empty state.
- `apps/desktop/src/workflows/{Workflows,TicketList,TicketCard,PlanReview,TicketEvidence,TaskGraph}.tsx` - class hooks only. Plan review and approval stay static.
- `apps/desktop/src/candidate/{CandidateReview,Evidence,Publication,Handoffs}.tsx` - class hooks only, plus one CheckDraw beside a `passed` verdict.
- `apps/desktop/src/project-components/{ProjectComponents,AtlasMemory,Prompts,MemoryList,Retention}.tsx` - column cards, row hover, washed "not enabled" block.
- `apps/desktop/src/sessions/{Sessions,SessionParts,EventList}.tsx` - live output card, streaming indicator, event row styling. No changes to hooks or logic calls.

Sheets:

- `apps/desktop/src/screens/{home,board,settings,help,projects,workflows,candidate-review,project-components}.css` - restyle with tokens only.
- `apps/desktop/src/screens/sessions.css` (new) - Sessions refinements layered after `app.css`.
- `apps/desktop/src/styles.css` - add `@import "./screens/sessions.css" layer(screens);` after `settings.css` and before `tailwind.css`.
- `apps/desktop/src/design/design-system.test.ts` - add `"screens/sessions.css"` to `EXPECTED_SHEETS` at the same position.

Library additions (unavoidable; listed per the constraint):

- `apps/desktop/src/ui/stats.tsx` (new) - `StatGrid({ label, children })` renders `dl.stat-grid[aria-label]`. `StatTile({ term, value })` renders `div.stat-tile > dt + dd`, with `dd` holding `<CountUp value={value} />`. It carries no tone, because counts are not evidence. Its styles go in `screens/home.css` under `.stat-grid` / `.stat-tile`, or in `components.css` if B's spec says that new components belong there. Do not reuse the `facts` class: the smoke test reads `.facts` first on the page.
- `apps/desktop/src/ui/index.ts` - `export * from "./stats";` (and `./motion` if B did not export it).
- `Kbd`: B's merged `ui` takes priority. Otherwise, add `export function Kbd({ children })` returning `<kbd className="kbd">` to `ui/stats.tsx`'s sibling `ui/docs.tsx` (new). `kbd` is not in the RAW regex, but use the wrapper so styling has one home.

Tests:

- `apps/desktop/src/{Home,Board,Settings,CandidateReview,Projects,ProjectComponents}.test.tsx`, `apps/desktop/src/workflows/views.test.tsx` - update for changed markup.
- `apps/desktop/src/Help.test.tsx` (new), `apps/desktop/src/sessions/SessionParts.test.tsx` (new), `apps/desktop/src/design/screens-motion.test.ts` (new) - see Testing Strategy.

Contracts to preserve (read before editing): `scripts/mvp-ui-smoke.mjs`, `scripts/m6-ui-smoke.mjs`, `scripts/performance-ui-smoke.mjs`, `apps/desktop/src/design/components.test.ts` (RAW regex, 300-line cap, `<Page` on every view, no `style={{`).

## Implementation Plan

### Foundation

1. Inventory the merged primitives: their names, props, whether `Reveal` wraps children or takes an index or attribute, whether `CountUp` server-renders the final value, and how reduced motion is handled. Inventory the tokens: shadows, radii, durations, easings, aurora and gradient tokens, and the hover/pointer media queries F2 allowed.
2. Freeze the contract list below. Keep every one of these byte-for-byte in rendered output:
   - `data-surface` values `home`, `board`, `settings`, `help`, `editor-handoff`. Every `data-capability` attribute and value.
   - The ARIA labels `Tickets`, `Ticket list`, `Registered projects`, `Recorded baselines`, `Baseline per repository`, `Atlas memory records`, `Beacon prompts`, `Candidate check results`, `Review findings`, `Durable session events`, `Kanban columns`, `Blockers waiting on you`, `Projects and validation health`, `Runtime environment and credential presence`, and `pre[aria-label]` names such as `Candidate diff`, `Check log`, `Baseline log`, `Complete immutable plan` and `Pi response`.
   - The classes `.state`, `.facts`, `.candidate-heading`, `.candidate-checks`, `.candidate-diff`, `.candidate-verdict`, `.candidate-review .failure-note`, `p.recovery-note`, `.plan-review`, `.plan-meta`, `.plan-blocker`, `.plan-supersede`, `.writer-status`, `.ticket-head strong`, `.ticket-actions .state`, `.run-card[aria-pressed]`, `.run-detail code`, `ol.events > li`, `.event-number`, `details.add-project`, `.project-components`, `.component-context`, `.prompt-preview`, `.outage` and `small.failure-note`.
   - The roles `[role=alert]`, `[role=status]`, `[role=dialog]`, `[role=listbox]` and `[role=menu]`.
   - Every button's accessible name, and heading levels and DOM order.

### Core (per screen)

Global rules for every screen:

- Use tokens only and the approved media queries. `opacity` may appear only where F2's lint allows it (inside keyframes or transitions through tokens). Do not use `!important`. Use at most three `>` steps in a selector. Keep each file at 300 lines or fewer.
- Motion uses transform and opacity only, plays once on entrance, and caps the stagger at about 10 items. Under reduced motion it falls back to opacity only or to the final state immediately. This comes from B's primitives; screen CSS adds no keyframes of its own unless F2's lint and reduced-motion rules cover them.
- Never wrap or animate the following: `Facts` identities, `StatusBadge`, `.callout`, `.failure-note`/`.recovery-note`, plan review and approval controls, check, finding, verdict and publication records, baseline records, `CodeBlock`/`LiveOutput`/`pre`, and `ol.events`. They get static depth only. Status always keeps its text and tone mark. Never use opacity or colour alone.
- After an entrance animation finishes, computed opacity must be 1, so the smoke contrast audit still measures the text. Text never sits directly on a saturated aurora. It sits on a solid surface or the token scrim.
- Hover emphasis on rows and cards never hides controls. Row actions stay rendered and visible at all times. Hover only raises the surface (tint, shadow, `translateY` lift token) and strengthens the actions' emphasis. Gate it with F2's hover/pointer media query if one exists. Keyboard `:focus-visible` gets the same raised state.
- Loading uses the existing `Loading` (B's shimmer skeleton) with unchanged labels and row counts. CheckDraw appears only at the success moments listed below, is `aria-hidden`, draws once per mount, and is keyed by the evidence identity.

Home (`Home.tsx`, `screens/home.css`):

- Hero: wrap the summary's opening in `Aurora` (decorative, `aria-hidden` wash behind a solid content surface) inside `Page`. Do not change `Page` props, the title, the description, the `data-surface="home"` attribute or the Refresh button.
- Stat tiles: in `HomeSummaryView`, when projects exist, render `<StatGrid label="Home summary counts">` before `Blockers`. It holds four `StatTile`s computed purely from the existing `summary`: Projects `summary.projects.length`, Waiting on you `summary.blockers.length`, Tickets `sum(project.tickets)`, Active workflows `sum(project.active_workflows)`. These are local derivations with no new reads. No success tone, and no "passing" KPI (green is earned). Use tabular nums.
- "Recent runs list": Home's summary carries no run list, and adding one would be a projection change. Apply the recent-activity treatment to the existing "Waiting on you" `RecordList` and the "Projects" `RecordList` instead: staggered `Reveal` on their items, with the item markup unchanged inside.
- Each `home-project` record body becomes a `GlowSurface` feature card (cursor-follow glow, decorative). The context menu, buttons and badges inside are unchanged.
- The no-projects `EmptyState boxed title action` gets the aurora wash, a title, one line and one primary button. The text is unchanged. The disconnected `EmptyState` gets the wash without an action.

Board (`Board.tsx`, `screens/board.css`):

- Columns become raised cards: the card shadow token, 8-radius, the hairline, a sticky-free header with the count as a pill. Do not change `aria-label` on the count.
- Cards (`button.run-card` from `OpenCard`) get a hover and focus-visible lift (`translateY` token, shadow token, micro duration). This is not draggable, and nothing sets `draggable`. Keep `board-note`, which says dragging is not implemented.
- Staggered `Reveal` of the cards per column, capped at 10. The column list itself is static.
- Status chips are B's restyled `StatusBadge`. Do not change the badge text.

Settings (`Settings.tsx`, `screens/settings.css`):

- The `settings-items` list becomes a grouped card: section label, 40 to 44px rows, hairline dividers, badge, name, required tag and detail.
- Switches: Settings is read-only by design, and doctor items are presence reports, not toggles. Add no switch. If B ships a switch primitive, leave it unused here and record that in Notes. The `RuntimeCard` child belongs to C.
- Success moment: when `report.ok`, render `<CheckDraw key={…}>` as an `aria-hidden` sibling immediately before the `settings-verdict` Callout, inside a `Box className="settings-verdict-row"`. The Callout's own markup and text (`data-tone="success" role="status">doctor: ok.`) stay unchanged. Key it on the report object identity (for example a counter bumped in the existing `.then`, or `tick`), so it draws once per successful read.

Help (`Help.tsx`, `screens/help.css`):

- Docs layout: a readable measure, topic sections as soft cards on a single column below the hint width, and onboarding steps numbered with a CSS counter badge (list markup unchanged).
- Add a static `Topic id="help-shortcuts" title="Keyboard shortcuts"`. Each row pairs a `Kbd` with its action, derived from `VIEWS` (Ctrl+1 to Ctrl+6, by label), plus `Ctrl+,` Settings, `Ctrl+K` "Go to a view, project or ticket" and `Ctrl+\` "Collapse sidebar". Use a `List` and `Item`, no raw elements. `kbd` styling: mono, hairline, 4-radius, a subtle bottom inset shadow token, tabular.

Projects / Workflows / Candidate review / Project components:

- Table-like rows: `project-list`, `repository-baselines`, `baselines`, `ticket-list`, `check-results`, `component-records` and recipe records get 40 to 44px minimum rows, hairline dividers, no zebra striping, right-aligned tabular numbers where numeric, and hover/focus-within row emphasis. Actions are always visible.
- Detail panel pattern: `.projects-layout` stays a `Split`. `.project-detail` becomes the elevated right panel (popover or card shadow token, 8-radius, a sticky header via `position: sticky` within the page scroll above 920px). The rail cards get the selected pill style. At 920px and below everything stacks with no horizontal scroll at 760px. This adds no drawer behavior.
- Empty states: `ProjectDetail`'s boxed empty state, Workflows' "No tickets yet" and Sessions' placeholder get the wash, a title and one line. Add a primary button only where a control already exists for it. Do not add new handlers.
- Approval and evidence blocks (`plan-review`, `plan-acknowledgment`, the Approve button, `candidate-review` facts/actions/verdict/checks/findings, `publication`, `editor-handoff`, `setup-handoff`, baseline offers, `prerequisite-offer`): static depth only. The plan review becomes a distinct bordered block on the raised surface with the full hash on its own line. The verdict keeps its toned leading rule. Add no `Reveal`, `GlowSurface`, hover lift or transition to these, and add no wrapper element between `.candidate-review` and its direct children, because the selectors use `>`.
- Success moment: in `ReviewVerdict`, when `review.verdict === "passed"`, render `CheckDraw` (`aria-hidden`, `key={review.candidate_hash}`) after the badge, inside the `verdict-line` text and after `</strong>`. The badge text is unchanged.
- Project components: `component-columns` become two raised cards. The not-enabled state wraps the existing `StatusLine` and "Enable project components" primary button in a washed block. Text and names are unchanged.

Sessions (`sessions/*.tsx` markup only, `screens/sessions.css` new):

- The live output card: `.assistant-output` becomes a raised card with a header row. `LiveOutput` itself is untouched: no wrapper with transform, opacity, will-change, filter or `Reveal` anywhere above the `pre`, and no change to its `key`, `live` or `followKey` props. Leave `pre[data-live]::after` (the steady caret) and `overflow-anchor` alone.
- Streaming indicator: inside `run-detail`, after the `role="status"` span, render B's thin indeterminate progress or streaming primitive, `aria-hidden`, only while `!isTerminal(active.state)`, using the value already computed. It sits outside the `pre` and outside `ol.events` and must not pulse the caret or the text. Reduced motion stops it.
- Event rows: `ol.events > li` summary rows get 40px rows, hover tint and hairlines in `sessions.css`. There is no entrance animation on event rows, because they stream continuously and the performance smoke counts them. `EventRow` memoization and `ScrollList` props stay unchanged.
- History: the rail `SelectableCard`s get the selected pill and hover lift, with no stagger, because the list repages.

### Integration

- Register `screens/sessions.css` in `styles.css` and `EXPECTED_SHEETS`, keeping them in the same order.
- Update `docs/DESIGN-SYSTEM.md` minimally. In the Files block, add the `sessions.css` line and `ui/stats.tsx` (and `ui/docs.tsx` if added). In Screens, add one clause per screen naming the new treatments. In Components, add a stat tile row. Keep ADR 0032 as the authority.

## Step by Step Tasks

1. Run `git status`. Read the merged B, C, F1 and F2 specs and code listed in Metadata and Foundation. Write down the actual primitive and token names you will use.
2. Add `ui/stats.tsx` (`StatGrid`, `StatTile`), and `ui/docs.tsx` (`Kbd`) only if B has no equivalent. Export them from `ui/index.ts`. Keep each file under 60 lines.
3. Home: implement the hero `Aurora`, the `StatGrid`, the `Reveal` on both record lists, the `GlowSurface` project cards and the washed empty states. Restyle `screens/home.css`. Confirm that `Home.tsx` stays at 300 lines or fewer.
4. Board: implement the `Reveal` cards and restyle `screens/board.css` (column card depth, card lift on hover/focus-visible, count pill, 680px stack).
5. Settings: add the grouped card styling, and `CheckDraw` beside the ok verdict in `settings-verdict-row`, keyed once per successful read.
6. Help: implement the docs layout and add the shortcuts topic with `Kbd`. Restyle `screens/help.css`.
7. Projects: restyle `screens/projects.css` (rail pills, table-like rows, elevated detail panel, empty-state wash). Add class hooks in TSX only if a selector cannot be reached otherwise.
8. Workflows: restyle `screens/workflows.css` (ticket rows, ticket card depth, a static distinct plan-review block). Do not touch `PlanReview` logic, the checkbox or the Approve button attributes.
9. Candidate review: restyle `screens/candidate-review.css` with static depth. Add the `passed`-verdict `CheckDraw` in `candidate/Evidence.tsx`.
10. Project components: restyle `screens/project-components.css` and wrap the not-enabled block.
11. Sessions: create `screens/sessions.css`, register it (`styles.css` and `EXPECTED_SHEETS`), add the live-output card header and the `aria-hidden` streaming indicator in `SessionParts.tsx`, and style event rows. Verify that the six protected logic files have no diff.
12. Update and add tests (Testing Strategy). Update `docs/DESIGN-SYSTEM.md` as described in Integration.
13. Run all Validation Commands and fix failures. Run `git status` and confirm that only the files listed here changed.

## Testing Strategy

- Unit (renderToStaticMarkup):
  - `Home.test.tsx`: the fixture summary renders a `stat-grid` whose four values equal `summary.projects.length`, `summary.blockers.length`, the ticket sum (3) and the active-workflow sum computed from the fixture `homeSummary`, as final numbers in SSR. The blockers and projects lists keep their aria-labels and record markup. The empty summary renders the title, the line and one primary button.
  - `Board.test.tsx`: cards are still `button.run-card` with unchanged `aria-label`s. No `draggable` attribute appears. Count `aria-label`s are unchanged.
  - `Settings.test.tsx`: the existing regexes still pass. An `ok` report contains exactly one CheckDraw element (by its class or test hook from B) inside `settings-verdict-row`, and a failing report contains none.
  - `Help.test.tsx` (new): renders `data-surface="help"`, the `help-shortcuts` topic, one `kbd` per view shortcut plus `Ctrl+,`, `Ctrl+K` and `Ctrl+\`, and every `DOCUMENTS` link.
  - `CandidateReview.test.tsx`: the existing identity, action and verdict assertions pass unchanged. A `passed` review renders one CheckDraw and a `changes_required` review renders none. No Reveal or GlowSurface markup appears inside `.candidate-review`.
  - `workflows/views.test.tsx`: `PlanReview` still renders the acknowledgment checkbox and `Approve r<n>` with `data-capability="plans.approve"` disabled until checked, and contains no motion markup.
  - `sessions/SessionParts.test.tsx` (new): `EventPanel` with a stub client and a running run renders `pre[data-live="true"][aria-label="Pi response"]` with no motion wrapper above it, an `aria-hidden` streaming indicator, and `ol.events[aria-label="Durable session events"]`. A terminal run renders no indicator and no `data-live`.
- Lint (`design/screens-motion.test.ts`, new): parse every `screens/*.css` except `app.css` and assert two things. First, no rule whose selector matches `.candidate-review`, `.plan-review`, `.facts`, `.state`, `.callout`, `.failure-note`, `.recovery-note`, `.check-record`, `.finding-record`, `.publication`, `ol.events` or `pre` declares `animation`, `transition` or `opacity`. Second, `sessions.css` never declares `transform`, `will-change`, `filter` or `opacity` on `.assistant-output` or its descendants.
- Integration / E2E: there is none in this item. Item Q runs the built app with the smoke scripts, both schemes, 760px and 1280px, and reduced motion. The builder must not claim smoke success from unit tests.
- Edge cases: zero projects (empty state, no stat grid), zero blockers (`Nothing is waiting on you.`), more than 10 cards in a column (the stagger is capped), a disconnected client on every view, reduced motion (count-ups render the final value instantly and no aurora drifts), and long hashes at 760px (wrap, no horizontal scroll).

## Acceptance Criteria

- [ ] WHEN any view renders THE SYSTEM SHALL keep every `data-surface`, `data-capability`, ARIA label, role, smoke-read class, button accessible name and heading level listed in Foundation step 2 unchanged.
- [ ] WHEN Home has projects THE SYSTEM SHALL show four untoned stat tiles derived from the existing summary, with tabular numbers, whose SSR output contains the final values.
- [ ] WHEN a plan, candidate, check, finding, verdict, baseline or publication is shown THE SYSTEM SHALL render it without entrance animation, fade, dim or hover motion, with status carried by badge text plus tone mark.
- [ ] WHEN the doctor report is `ok` or a review verdict is `passed` THE SYSTEM SHALL draw one `aria-hidden` CheckDraw once, and nowhere else.
- [ ] WHEN a session is non-terminal THE SYSTEM SHALL show an `aria-hidden` streaming indicator outside the Pi response `pre`. The steady caret and sticky-scroll behavior stay unchanged.
- [ ] `git diff` shows no change to `sessions/{useSessionReplay,followSession,frameCoalescer}.ts`, `ui/{stickyScroll,useStickyScroll,glide}.ts`, `design/tone.ts`, `workflow-state.ts`, `failures.ts`, `candidate/rules.ts`, the `use*` hooks or the `workflows/{model,read,settings}.ts` files.
- [ ] No view contains a RAW element. Every touched file is 300 lines or fewer. Screen sheets pass the token lint. `screens/sessions.css` is registered.
- [ ] Row actions on table-like lists stay visible without hover. Hover and focus-visible add emphasis only.
- [ ] No Stripe name, logo or asset appears in the app.

## Validation Commands

- `cd apps/desktop && npx vitest run src/design` - token lint, the new `screens-motion.test.ts`, sheet registration, the 300-line cap and the RAW-element ban.
- `cd apps/desktop && npx vitest run src/Home.test.tsx src/Board.test.tsx src/Settings.test.tsx src/Help.test.tsx src/CandidateReview.test.tsx src/Projects.test.tsx src/ProjectComponents.test.tsx src/workflows src/sessions` - the changed and new markup tests.
- `npm run typecheck --workspace @luuna/desktop`
- `npm run test --workspace @luuna/desktop`
- `npm run build`
- `git diff --exit-code $(git merge-base HEAD orchestrate/stripe-ui-20261022) -- apps/desktop/src/sessions/useSessionReplay.ts apps/desktop/src/sessions/followSession.ts apps/desktop/src/sessions/frameCoalescer.ts apps/desktop/src/ui/stickyScroll.ts apps/desktop/src/ui/useStickyScroll.ts apps/desktop/src/ui/glide.ts apps/desktop/src/design/tone.ts apps/desktop/src/workflow-state.ts apps/desktop/src/failures.ts apps/desktop/src/candidate/rules.ts` - the protected logic is unchanged.
- `git grep -n -i "stripe" -- apps/desktop/src` - must print nothing.

## Notes

- Fallbacks if B's merged API differs:
  - If `Reveal` only wraps a single child, wrap each `Item`'s content, not the `li`, so list semantics hold, and pass the index for the stagger.
  - If `CountUp` does not server-render the final value, render the final value as text with `CountUp` as an enhancement, and report the gap to B rather than patching `ui/motion.tsx`.
  - If a needed token (for example the lift distance or a stagger step) is missing, add it to F2's token sheet in both schemes and in the reduced-motion block, and list it in the final report.
- Interpretations to report back: Home's "recent runs" maps to the existing blockers and project lists. Settings gets no switches (it is read-only). "Tables" are table-like record lists, because there are no `table` elements and the RAW regex bans them. The "drawer" is the existing rail and detail `Split`, styled as an elevated panel.
- Risk: wrapping with `Reveal` can break the exact-markup regexes in the existing tests and the `>` child selectors in the screen sheets. Prefer an attribute or class API, or wrap inside the items. Run `src/design` after each screen.
- Risk: the opacity of an entrance animation that never completes (for example a hidden `ViewSlot` with `display: none` at mount) could leave text translucent, which the smoke audit treats as exempt. B's primitive must end at full opacity and must also animate when it becomes visible. Item Q should check this.
- Line budget: `Home.tsx` (129 lines) and `SessionParts.tsx` (78 lines) have room. Avoid growing `workflows/Workflows.tsx` (132 lines). Its changes should be class hooks only.
