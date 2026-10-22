# Feature: Desktop Ledger screens (content-first page layouts)

## Metadata

- Type: feature
- Source: orchestration run `ledger-ui-20261022-1015` (`.tac/runs/ledger-ui-20261022-1015/work-items.md`)
- Orchestration: run ledger-ui-20261022-1015, wave 3, item L4
- Depends on: L1 `specs/feature-desktop-ledger-foundation.md` (tokens, ADR 0033, vendored reference), L2 `specs/feature-desktop-ledger-primitives.md` (ui/ primitives and component CSS), L3 `specs/feature-desktop-ledger-shell.md` (AppShell, PageHeader, Banner, top bar, `screens/app.css`, `screens/shell.css`)
- Merge prerequisite: parallel fix agent `a789ff1dc3c0f46e5` (duplicate key, form id/name, favicon, Settings density) merges into `orchestrate/stripe-ui-20261022` before L4 starts. Build on whatever merged.
- Date: 2026-10-22
- Planned against: `7614837` on `orchestrate/stripe-ui-20261022`. At planning time the L1 and L3 specs held only metadata stubs and the L2 spec did not exist, so this plan assumes Ledger component names. Step 1 below re-bases it on what actually merged.

## Feature Description

This item applies the Ledger look and its content-first page layout to every Luuna desktop screen: Home, Board, Settings, Help, Projects (with Workflows, Candidate review and Project components nested inside it) and Sessions. It changes presentation only. Each screen opens with its page title, and the start of its primary content is visible without scrolling. Decorative washes, glows, heroes and lift animations are removed. Records render as Ledger rows and cards, key–value details as property lists, and status as a badge that always shows a word and a shape mark. The runtime still decides every state, control, enablement and string the screens show.

## User Story

As a Luuna developer, I want every desktop screen to open straight to its content in a calm, consistent Ledger layout so that I can see what needs my attention, and the exact evidence behind it, without scrolling past decoration.

## Solution Statement

Each screen keeps its existing React components, data hooks, markers and strings. Only the composition changes, done with the ui/ primitives that L2 restyled or added (MetricCard, SettingsRow, PropertyList, Badge/StatusBadge, Alert/Callout, EmptyState, Spinner/ProgressBar, Kbd) and the screen sheets in `apps/desktop/src/screens/` (all except `app.css` and `shell.css`, which belong to L3). We do not swap in Ledger's `ledger.mjs` React components, because Luuna's roles, smoke selectors and approval-evidence UI must stay byte-compatible (ADR 0033 per L1). Every change goes through the existing `ui/` barrel, so the tests for "no raw elements in views", 300-line files and tokens only keep holding.

## Out of Scope

- Any logic or data-flow change: hooks (`useProjects`, `useComponents`, `useWorkflowData`, `useWorkflowActions`, `useSessionReplay`), `read*` functions, `homeSummary`/`boardProjection`, `tone.ts` mappings, request bodies and enable/disable conditions.
- Protected files, which stay byte-identical: `src/sessions/useSessionReplay.ts`, `src/sessions/followSession.ts`, `src/sessions/frameCoalescer.ts`, `src/ui/stickyScroll.ts`, `src/ui/useStickyScroll.ts`, `src/ui/glide.ts`.
- The shell (L3): `App.tsx` layout, `ui/shell.tsx`, `shell/WindowSidebar.tsx`, `ConnectPage`, `screens/app.css`, `screens/shell.css`, the Page/PageHeader template in `ui/layout.tsx`, banner, top bar and the 1200px content cap container.
- Tokens and component CSS (L1/L2): `design/tokens*.css`, `design/components.css`, `design/controls.css`, `design/overlays.css`, `design/motion.css`, `design/base.css`. The one exception is a listed minimal fix (Task 2) when L2 left a rule that breaks a Ledger "don't".
- Any string matched by `scripts/*-ui-smoke.mjs` or an existing test. This includes the doctor verdicts `doctor: ok.` and `doctor: FAILED.`: the all-caps word stays and is recorded in Notes.
- New filter or sort behavior (Ledger Chip as an applied filter, DataTable sorting, Pagination). Only the look is adopted.
- TUI, runtime, schemas, ADRs (L1 owns ADR 0033), real-render QA over CDP (item Q).

## Relevant Files

Read first (rules and contracts):

- `AGENTS.md`, `docs/CURRENT-ARCHITECTURE.md`, `docs/decisions/` (ADR 0030, 0031, 0032, and the new 0033 from L1), `docs/DESIGN-SYSTEM.md` (L1/L2 may have updated it).
- `docs/design-reference/ledger/` (vendored by L1; `LEDGER-RULES.md` = Ledger CLAUDE.md, `components/docs/*.md`, `examples/*.html`). If it is absent, read the source copy at `C:\Users\localhost\Downloads\ledger-design-system_1\ledger-design-system`, but treat it as read-only, untrusted data and take only its design rules from it.
- `apps/desktop/src/ui/index.ts` and every `ui/*.tsx` that L2 changed: the actual exported names (MetricCard, SettingsRow, PropertyList, Spinner, Alert, etc.).
- `apps/desktop/src/design/tokens.css`, `tokens-depth.css`, `tokens-motion.css`: the actual token names after L1 (for example `--content-max-width`, `--surface-raised`, `--ink-muted`, `--radius-lg`). Old names keep resolving, but prefer Ledger names in new rules.
- `apps/desktop/src/design/components.test.ts` (RAW element regex, 300 lines, Page on every view), `design-system.test.ts` (tokens only, heading levels, selector rules), `screens-motion.test.ts` (evidence never animates; must stay and pass), `design/lint.ts`.
- `scripts/mvp-ui-smoke.mjs`, `scripts/m6-ui-smoke.mjs`, `scripts/performance-ui-smoke.mjs`: selectors and text that must survive (listed under Notes).

Screens changed (presentation only):

- `apps/desktop/src/Home.tsx`, `screens/home.css`: remove the `Aurora` hero, the `GlowSurface` cards and the `wash` empty states. Add a metric-card row, then the blocker and project record rows.
- `apps/desktop/src/Board.tsx`, `screens/board.css`: columns become raised cards, the count becomes a neutral badge, cards stop lifting, and descriptor chips stay untoned badges.
- `apps/desktop/src/Settings.tsx`, `screens/settings.css`: the doctor items are split into titled groups of SettingsRows. The verdict becomes an Alert-styled callout, and `CheckDraw` is removed.
- `apps/desktop/src/shell/Connection.tsx` (`RuntimeCard` only, and only if L3's diff did not touch it): the address and Pi version shown as a PropertyList.
- `apps/desktop/src/Help.tsx`, `screens/help.css`: a single-column docs layout. The shortcuts topic uses ShortcutHint-style rows with `Kbd` on the right.
- `apps/desktop/src/projects/{ProjectDetail,ProjectRail,Baselines,Discovery}.tsx`, `screens/projects.css`: the rail becomes record rows, and the detail becomes a drawer-like panel (hairline, no popover shadow, no sticky header). Facts are styled as a PropertyList, and the empty state drops its wash.
- `apps/desktop/src/workflows/{Workflows,TicketList,TicketCard,TaskGraph}.tsx`, `screens/workflows.css`: the empty state drops its wash, the advisory left rule goes, and ticket rows stop lifting.
- `apps/desktop/src/candidate/{CandidateReview,Evidence,Handoffs,Publication}.tsx`, `screens/candidate-review.css`: the verdict block loses its colored left border and becomes a bordered card with the verdict badge. `CheckDraw` is removed, and handoffs become static cards.
- `apps/desktop/src/project-components/{ProjectComponents,AtlasMemory,Prompts,MemoryList,Retention}.tsx`, `screens/project-components.css`: the Aurora is removed, the not-enabled block becomes an EmptyState-style fact plus its one existing primary, and records become hairline rows.
- `apps/desktop/src/sessions/{SessionParts,EventList,Sessions}.tsx` (visual layer only), `screens/sessions.css`: `StreamingDots` becomes the Ledger Spinner, the history cards stop lifting, the activity empty state drops its gradient, and the live output card and event list rows are restyled statically.

Tests:

- `apps/desktop/src/{Home,Board,Settings,Help,Projects,ProjectComponents,CandidateReview}.test.tsx`, `sessions/SessionParts.test.tsx`, `workflows/views.test.tsx`: update the markup expectations that change and keep every behavioral assertion.
- `apps/desktop/src/design/screens-ledger.test.ts` (new): a static guard over the screen sheets for Ledger's "don'ts".

Possible new ui wrappers (only if L2 did not provide them; list each one in the final report):

- `apps/desktop/src/ui/stats.tsx`: a `MetricCard` variant without a chart (title and value only), if L2's MetricCard always renders a "No data" pill when `data` is absent. Counts are values, not series, so a No data pill would be wrong.
- `apps/desktop/src/ui/settings.tsx` (new, registered in `ui/index.ts` and `components.test.ts` per its registration rule): `SettingsGroup` (section title plus list) and `SettingsRow`, if L2 did not add them.
- A `Spinner` in `ui/feedback.tsx`, if L2 did not add one.

## Implementation Plan

### Foundation

1. Confirm the baseline. Run `git status`, `git log --oneline -15`, and confirm that L1, L2, L3 and fix agent `a789ff1dc3c0f46e5` are merged (for example with `git log --oneline -- apps/desktop/src/Settings.tsx apps/desktop/src/ui/index.ts apps/desktop/src/screens/shell.css`). Read the three dependency specs, if they are filled in by then, and their diffs (`git diff 7614837 -- apps/desktop/src/ui apps/desktop/src/design apps/desktop/src/screens/app.css apps/desktop/src/screens/shell.css`). Record which Ledger primitives exist and their exact props and markup.
2. Grep the protected strings and selectors before editing any copy: `grep -nE "getByRole|getByText|locator|querySelector|includes\(" scripts/*-ui-smoke.mjs` and `grep -rn "toContain\|toMatch" apps/desktop/src --include=*.test.*`. Keep the list open while you work.

### Core: layout rules for every screen

- **Content first.** The Page title comes from L3's PageHeader. Its description is one sentence and its actions sit in the same row. The first child after the header is the screen's primary content. Nothing decorative comes before it: no hero, aurora, glow, stat wash or onboarding. At most one task-related Alert/Callout (the view's `ErrorBanner`) may sit above the content. Recommendations and explanations go below the content or into Help.
- **Width.** Screen containers never exceed the L1 content-max token (`--content-max-width`, 1200px). Replace `max-width: var(--layout-max)` in `help.css` with that token. Use `min-width: 0` / `minmax(0, 1fr)` everywhere that holds code.
- **One primary button per view or action group.** Add no new primaries. Where a view has more than one visible primary at load and no test or smoke matches its class, demote the extra ones to secondary. Never demote a button whose `class="primary"` a test matches (for example `Save correction` in `ProjectComponents.test.tsx`).
- **EmptyState.** A plain fact as the title, an optional one-line description, and one primary button only where a control already exists (Home's `Add a project…`). Remove the `wash` prop from every call site (`Home`, `Board`, `Settings`, `ProjectDetail`, `Workflows`, `SessionParts`). If L2 removed `wash` from the type, typecheck enforces this.
- **Status.** Always use `StatusBadge` (word plus tone-mark shape). The badge text stays exactly the runtime value, with underscores replaced as the screens already do. No color-only signal.
- **No** gradients, `Aurora`, `GlowSurface`, `CheckDraw`, colored left-border cards, emoji, `text-transform: uppercase`, letter-spaced all caps, or `translateY(var(--lift-y))` hover lifts in screen sheets. Hover is a background change with the Ledger 120ms ease-out token. Tone-mark shapes (`i.tone-mark`, badge marks) stay.
- **Policy UI is static.** Approvals, plan review (`.plan-review`), baselines, candidate identity (`.facts`), checks (`.check-record`), findings (`.finding-record`), verdict (`.candidate-verdict`), publication (`.publication`), `.state`, `.callout`, `ol.events` and `pre` get no transition, animation, opacity or transform, are never dimmed, and are never collapsed by default if they were open before. `screens-motion.test.ts` stays unmodified and must pass.
- **Markers preserved.** Keep `data-surface`, `data-capability`, `[role=dialog|listbox|menu|alert|status]`, `ul[aria-label=Tickets]`, `ul[aria-label="Registered projects"]`, `ul[aria-label="Recorded baselines"]`, `ul[aria-label="Atlas memory records"]`, `ul[aria-label="Beacon prompts"]`, `ul[aria-label="Ticket list"]`, `.state`, `.facts`, `details.add-project`, `.run-card[aria-pressed]`, `.plan-review`, `.plan-meta`, `.ticket-head strong`, `.ticket-actions .state`, `.candidate-*`, `.component-context`, `.prompt-preview`, `.writer-status`, `.run-detail`, `ol.events` and its children, `.outage`, `.connection`, `small.failure-note`, `p.recovery-note`, and every `pre[aria-label]`. Also keep heading levels (h2 page, h3 section, h4 inside candidate or session or a Settings group).

### Core: per screen

**Home** (`Home.tsx`, `home.css`)
- `HomeSummaryView`: delete the `Box.home-hero.aurora-host` and `<Aurora />`. Render the four counts (Projects, Waiting on you, Tickets, Active workflows, in this order) through L2's `MetricCard`, without a chart area, inside a labelled group named `Home summary counts`. If the MetricCard markup allows it, keep `dl`/`dt`/`dd` semantics. If not, use a `role="group"` labelled container. Values are static final numbers with tabular numerals, and the metrics carry no tone and no delta.
- Metric grid: 4 across when the content is at least about 960px wide, 2 across below that (2x2 at 390px). Gutter is the `space-4` token, on a `surface-muted` tray in light and directly on the page in dark, per the MetricCard doc.
- Then "Waiting on you" (h3 with a count), then "Projects" (h3). Both become `RecordList variant="rows"` record rows. Project rows: name, manifest badge, id, counts meta, and repository health inline (the `code` then `.state` adjacency that the tests match), with row actions (`Open {name}`, `New ticket`) always visible at the row end. Remove `GlowSurface` and keep `ContextMenuArea`. Blocker rows: badge, title, meta, reason, `Open`.
- Empty and offline states: no `wash`. "No projects yet" keeps its single primary `Add a project…`.
- `home.css`: delete `.home-hero`, the glow and hover-shadow rules and `.home-project-card` chrome. The stat-tile rules move to the metric grid or are dropped if L2 styles MetricCard.

**Board** (`Board.tsx`, `board.css`)
- Columns are raised cards (`surface-raised`, hairline border, the Ledger card radius token, resting card shadow only if L2 kept one). The column h3 count is a neutral badge (tabular), and the scope is ink-muted caption text.
- Cards are `OpenCard` on the `surface` level. Remove the `transform`/lift and the transition on transform. Keep a 120ms background or border hover. Run state comes from `StatusBadge` via `runTone`, and purpose/`no plan` stay untoned descriptor badges (Ledger Badge `neutral`). Ledger's Chip is a filter token, and since the Board has no filters, no Chip is introduced.
- `RevealList`: keep it if L2 kept the component (its one-time entrance is allowed). If L2 removed it, use `List labelledBy`. Keep the `board-note` meta under the grid.

**Settings** (`Settings.tsx`, `settings.css`)
- Start from the merged fix-agent version. Render `DoctorReportView` as titled groups (h4 `section-title` plus a SettingsRow list with hairline separators) in this order: **Required tools**, **Runtime**, **Credentials**, **Optional tools**. Grouping is a pure presentational function `doctorGroups(items)` exported from `Settings.tsx`:
  - Credentials: `api_token`, `github_token`, `provider_credentials`, or any name ending in `_token` or `_credentials`.
  - Runtime: `data_dir`, `database`, `port`, `components`.
  - Required tools: the remaining `required` items (today `git` and `pi`).
  - Optional tools: everything else (today `python`, `node` and `bun`, plus any future unknown item).
  Within a group the runtime's order is kept, each item renders exactly once, and empty groups are omitted. The runtime remains the authority on status. Group names change no meaning.
- Each row: the name in mono (`Id`) as the row title, the `required` Tag beside it, the runtime `detail` as the ink-muted description, and the `StatusBadge` (runtime word `ok`/`warning`/`missing` plus tone mark) in the row's control slot on the right. Rows stay compact: Ledger SettingsRow padding tokens, and the detail wraps under the title, never truncated. At 390px the badge stacks under the text (`stacked`).
- Verdict: the existing `Callout` with `status` and the same text, styled as a Ledger Alert (success or danger) and placed after the groups. Remove `CheckDraw` and the `.settings-verdict-row` wrapper (or keep the wrapper without the drawing).
- Keep the `Environment` section with its `Refresh` (`data-capability="doctor"`, `text-button`), the page description strings, and the children slot (`RuntimeCard`) first.
- `RuntimeCard` (in `shell/Connection.tsx`, only if L3 left it untouched): `PropertyList`/`Facts` rows for Address (mono) and Pi version, with Disconnect and Stop runtime kept as they are. Otherwise leave the file alone.

**Help** (`Help.tsx`, `help.css`)
- Docs layout: one column capped at a readable measure (the `--measure` token or about 720px) inside the 1200 cap, with topics stacked as plain sections (section-title h3, no card chrome). The topic order stays as it is (onboarding first, which is Help's primary content).
- Onboarding: the numbered list keeps its counter badge on the neutral fill token, not an accent tint.
- States: each tone is a row: `StatusBadge`, then values in ink-muted, then the meaning.
- Shortcuts: rows with the action label on the left and `Kbd` on the right (the Ledger ShortcutHint pattern), with hairline separators.
- Documents: link rows, with the path shown as ink-muted `Id`.

**Projects** (`projects/*`, `projects.css`)
- Rail: `Registered projects` as compact record rows (row height token, selected row in accent-soft tint plus the existing inset rule, no pill radius and no shadow lift), then the three disclosures (`details.add-project` stays open while there are no projects).
- Detail (`Card.project-detail`) is drawer-like: a hairline border on `surface-raised`, no `--shadow-popover`. Remove `position: sticky` from `.project-header` (Ledger allows no extra sticky bars). Keep the rail's sticky `top`, but set it to clear L3's top bar using L3's offset token (for example `--topbar-height`) if the document scrolls under a sticky top bar.
- `ProjectFacts`: keep `Facts` (`dl.facts`, which smoke-matched code depends on). It renders the PropertyList look (labels ink-muted, values ink, identities mono, untruncated). Only use L2's `PropertyList` if it emits `dl.facts > div > dt + dd`.
- Baselines and Discovery: hairline record rows with actions visible. The testing-setup offer `Callout` (`p.baseline-offer.callout[data-tone=attention][role=status]`, which a test matches) stays. Remove its colored left rule only through L2's Callout and Alert CSS.
- Empty detail: no `wash`. The title states the fact, and no button is added (the control lives in the rail).

**Workflows** (`workflows/*`, `workflows.css`)
- `EmptyState` "No tickets yet" drops `wash`. Ticket list rows lose the shadow lift and keep the background hover. Ticket cards use a hairline border on `surface-raised`.
- `.plan-review` stays a distinct, static, bordered block (no motion). Delete the `border-left` on `.advisory-result` and use an indented block on `surface-muted` instead. The reconcile `Callout` stays inside its card (not above page content).

**Candidate review** (`candidate/*`, `candidate-review.css`)
- `.candidate-verdict`: replace `border-left` and `[data-tone] border-left-color` with a full hairline border card. The verdict tone stays readable through its `StatusBadge`. Remove `CheckDraw` beside a passed verdict in `Evidence.tsx`.
- Identities use `Facts` (PropertyList look). Check and finding records are table-like hairline rows (tabular numerals). The action row is always visible, and handoffs (`.setup-handoff`, `.editor-handoff` with `data-surface="editor-handoff"`) are static bordered cards. The activity `Callout` (role status) stays.

**Project components** (`project-components/*`, `project-components.css`)
- Remove `<Aurora />` and `aurora-host` from `.component-disabled`. It becomes the EmptyState pattern: the runtime's reason as the fact, then the single existing primary `Enable project components`.
- Component columns are hairline cards. Records are rows that keep their background hover (no motion). The raw `select` rule moves to tokens L2 provides for `SelectField` if L2 styles it, otherwise it stays.

**Sessions** (visual layer only: `SessionParts.tsx`, `EventList.tsx`, `Sessions.tsx`, `sessions.css`)
- In `EventPanel`, replace `<StreamingDots />` with L2's `Spinner` (labelled or `aria-hidden` to match today's decorative behavior) in the same position: inside `.run-detail`, before the Pi response, rendered only while the run is not terminal. Ledger's "Spinner for short waits" fits here. If L2 kept `StreamingDots` restyled as a spinner, keep the call site. ProgressBar is only for known progress or waits over 5 seconds and is not added here.
- History rail: remove the `transform` lift. The selected card keeps its accent rule and tint.
- `.event-panel > .activity-empty`: remove `var(--gradient-aurora)`. Use a plain `surface-muted` background. Remove `wash` from "No sessions yet".
- Live output card (`.assistant-output`): static hairline card. Never add transform, opacity, filter or will-change to it or its descendants. Do not touch `LiveOutput`, `ScrollList follow` or the `pre[data-live]::after` caret.
- Event rows: row height and hairlines stay, plus a background-only hover.

### Integration

- No routing, App, or hook wiring changes. Every view still renders through `Page`. All markup comes from `ui/` (the RAW regex in `components.test.ts`). Any new wrapper is listed in the final report and documented in `docs/DESIGN-SYSTEM.md` (Components table and Screens section). Update the "Screen details (item D)" paragraph in `docs/DESIGN-SYSTEM.md` to describe the Ledger screens instead of Aurora, glow and CheckDraw.

## Step by Step Tasks

1. Baseline and dependency check (Foundation 1–2). Write down the actual L2 primitive names and props and the L1 token names. If L2 lacks MetricCard, SettingsRow/Group or Spinner, add the minimal wrapper in `ui/` (see Relevant Files) with a primitives test.
2. Audit the leftovers: `grep -rnE "gradient|uppercase|letter-spacing|border-left|border-inline-start|lift-y|Aurora|GlowSurface|aurora|glow|CheckDraw|wash" apps/desktop/src --include=*.css --include=*.tsx`. Fix the hits in screen sheets and views. For a hit in an L2-owned sheet that violates a Ledger "don't" (for example `.eyebrow`/`.table th` uppercase, `.record[data-tone]` or `.callout` colored left border), make the minimal token-only fix there and list it in the report.
3. Home: Core › Home. Update `Home.test.tsx`: the summary-counts group with its label and the four term/value pairs in order, no tone, no `aurora`/`glow-surface`/`home-hero` in the markup, the empty view still has exactly one `<button`, and every existing behavioral expectation is kept.
4. Board: Core › Board. Update `Board.test.tsx` only if markup changes, and add an assertion that no `transform` lift rule remains in `board.css` (covered by Task 11).
5. Settings: Core › Settings. Export `doctorGroups`. Update `Settings.test.tsx` as follows:
   - Assert the group order and titles for the fixture.
   - Assert each item appears exactly once, with its badge (`class="state" data-tone=…`), its `<code>name</code>`, its `required` tag when required, and its detail.
   - Assert an unknown item lands in Optional tools.
   - Keep the verdict-text assertions.
   - Replace the `check-draw` assertions with `not.toContain("check-draw")`.
   - Assert an empty `items: []` report renders no group list but still shows the verdict (this is what the performance smoke fixture sends).
6. Help: Core › Help. Keep `Help.test.tsx` passing and add an assertion that every shortcut renders a `kbd`.
7. Projects: Core › Projects (`ProjectDetail`, `ProjectRail`, `Baselines`, `Discovery`, `projects.css`). Keep `Projects.test.tsx` passing unchanged.
8. Workflows and Candidate review: Core › Workflows and Core › Candidate review. Keep `CandidateReview.test.tsx`, `workflows/views.test.tsx` and `workflows/state.test.tsx` passing. If a test referenced `check-draw` on a passed verdict, change it to assert that no check-draw appears while the verdict badge still does.
9. Project components: Core › Project components. Keep `ProjectComponents.test.tsx` passing (`class="primary"` on Save correction stays).
10. Sessions: Core › Sessions. Update `SessionParts.test.tsx`: the spinner markup (whatever L2 emits) appears before `aria-label="Pi response"` while live and is absent when terminal. Keep the `data-live` and `Durable session events` assertions and the "no reveal, glow-surface, aurora, inline style before the output" check, with `streaming-dots` replaced by the spinner class. Run `git diff --stat` on the protected files and expect it to be empty.
11. Add `apps/desktop/src/design/screens-ledger.test.ts` (new). It reads every `screens/*.css` except `app.css` and `shell.css` with `node:fs` (not `?raw`), strips comments using the same helpers as `screens-motion.test.ts` (`rules` and `declarations` from `./lint`), and fails on any of these:
    - `gradient` or `--gradient-` in a value
    - `text-transform: uppercase`
    - `border-left` or `border-inline-start` whose value uses `--tone-` or `--color-accent`
    - `transform` using `--lift-y`
    - `position: sticky` on a selector containing `header`
    - `.aurora` or `.glow-surface` selectors
    It also checks that `help.css` and any other screen `max-width` uses the content-max or measure tokens. Add a fixture test showing each forbidden pattern is caught. It also asserts that no view `.tsx` under `src/` (excluding `ui/` and `design/`) imports `Aurora`, `GlowSurface` or `CheckDraw`, or passes `wash`. Keep the file under 300 lines.
12. Copy pass: review headings, buttons and empty-state text against Ledger Copy rules (sentence case, verbs on buttons, no exclamation marks, errors in two sentences). Change only strings absent from the Task 1 grep list. List each changed string in the report, or state that none changed.
13. Update `docs/DESIGN-SYSTEM.md` (Screens and Components sections, plus any new wrapper) to match the result. Do not edit ADRs.
14. Run the Validation Commands, fix what they catch, and report the actual commands and results. State plainly that static-markup tests are not real-render evidence of the fold checks: item Q verifies 1366x768, 1280x720 and 390x844 in both themes.

## Testing Strategy

- **Unit (renderToStaticMarkup):** Home metrics, row order and empty state. Board columns and badges. Settings grouping (order, exactly-once, unknown item fallback, empty report). Help `kbd`. Session spinner placement and terminal absence. Every existing behavioral assertion stays.
- **Static CSS guards:** the new `screens-ledger.test.ts`, the existing `screens-motion.test.ts` (unchanged), `design-system.test.ts` (tokens only, selectors, heading levels, contrast) and `components.test.ts` (RAW elements, 300 lines, Page).
- **Integration / E2E:** none in this item. The desktop smokes (`node scripts/mvp-ui-smoke.mjs`, m6, performance) are run if a built runtime and browser are available and their results reported. Otherwise report them as not run. Item Q does the real-render fold, theme and contrast QA.
- **Edge cases:** zero projects (one primary), zero doctor items, unknown doctor item names, all eight Board columns empty, a long untruncatable hash in Facts at 390px (wraps, no horizontal scroll), a non-terminal session (spinner) versus a terminal one (none), reduced motion (spinner stops per L2).

## Acceptance Criteria

- [ ] WHEN any screen renders THE SYSTEM SHALL show the page title followed directly by the primary content, with no hero, aurora, glow surface, gradient or decorative wash anywhere in `src/` views or screen sheets.
- [ ] WHEN Home has projects THE SYSTEM SHALL render four untoned metric cards (Projects, Waiting on you, Tickets, Active workflows, in this order), labelled `Home summary counts`, 4-up on wide content and 2x2 below about 960px, followed by "Waiting on you" and "Projects" record rows with visible row actions.
- [ ] WHEN Settings shows a doctor report THE SYSTEM SHALL group items under Required tools, Runtime, Credentials and Optional tools (empty groups omitted, each item once, runtime order within each group). Each row SHALL show the mono name, a `required` tag where applicable, the ink-muted detail and a StatusBadge with the runtime word and shape mark. The verdict SHALL keep its exact text.
- [ ] Board columns are raised cards with a neutral count badge, and no screen sheet declares a `--lift-y` transform.
- [ ] Help is a single-column docs layout whose shortcuts render `Kbd` key caps.
- [ ] Sessions shows a Ledger Spinner (not StreamingDots) only while the run is not terminal. `git diff` on the six protected files is empty, and the live output card and its descendants carry no transform, opacity, filter or will-change.
- [ ] No screen sheet uses `text-transform: uppercase`, a gradient, or a colored left-border card. Tone-mark shapes remain.
- [ ] Policy UI (approvals, plan review, baselines, candidate identity, checks, findings, verdict, publication) is static and undimmed. `design/screens-motion.test.ts` is unmodified and passes.
- [ ] Every smoke-matched or test-matched string, selector and marker listed in Notes is unchanged. Every changed string is listed in the report.
- [ ] Every file in `apps/desktop/src` is 300 lines or fewer. Views compose only `ui/` primitives. Any new ui wrapper is listed in the report and in `docs/DESIGN-SYSTEM.md`.
- [ ] All desktop tests, typecheck and build pass. Both themes resolve every `var()` (design-system test).

## Validation Commands

Run in Git Bash from the repo root, with Node pinned by the repository (24.19.0 per `docs/DESIGN-SYSTEM.md`):

- `cd apps/desktop && npx vitest run src/design src/ui`: design guards, including the new `screens-ledger.test.ts` and the unchanged `screens-motion.test.ts`
- `cd apps/desktop && npx vitest run src/Home.test.tsx src/Board.test.tsx src/Settings.test.tsx src/Help.test.tsx src/sessions/SessionParts.test.tsx`: the screen-specific checks for this change
- `npm run typecheck --workspace @luuna/desktop` (and root `npm run typecheck`)
- `npm run test --workspace @luuna/desktop`
- `npm run build`
- `git diff --exit-code -- apps/desktop/src/sessions/useSessionReplay.ts apps/desktop/src/sessions/followSession.ts apps/desktop/src/sessions/frameCoalescer.ts apps/desktop/src/ui/stickyScroll.ts apps/desktop/src/ui/useStickyScroll.ts apps/desktop/src/ui/glide.ts`: protected files unchanged (expect exit 0)
- `git diff --exit-code -- apps/desktop/src/design/screens-motion.test.ts apps/desktop/src/screens/app.css apps/desktop/src/screens/shell.css`: the guard and the L3-owned sheets are untouched by L4
- `find apps/desktop/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -exec awk 'END { if (NR > 300) print FILENAME": "NR }' {} \;`: 300-line caps (expect no output)
- `grep -rnE "Aurora|GlowSurface|CheckDraw|StreamingDots| wash[ >=]" apps/desktop/src --include=*.tsx | grep -vE "^apps/desktop/src/(ui|design)/"`: no decorative primitives in views (expect no output)
- `grep -rnE "gradient|uppercase|lift-y" apps/desktop/src/screens --include=*.css | grep -vE "/(app|shell)\.css:"`: expect no output
- `git diff --check`
- Optional, when a runtime build and browser are available: `node scripts/mvp-ui-smoke.mjs`, `node scripts/performance-ui-smoke.mjs`. Report each result, or report it as not run.

## Notes

- **Assumptions to re-check in Task 1.** The names `MetricCard`, `SettingsRow`, `PropertyList`, `Spinner`, `Alert`/`Callout` and the tokens `--content-max-width`, `--surface-raised`, `--surface-muted`, `--ink-muted` and `--topbar-height` follow Ledger. Use what L1, L2 and L3 actually exported. If L2 kept the Luuna names (`StatGrid`, `Callout`, `StreamingDots`) restyled, use those and do not duplicate them.
- **Strings and selectors that must not change** (from the smokes and tests):
  - Button names: Connect, Disconnect, Register repository, Discover proposed map, Confirm manifest, Create ticket, `Plan r…`, `Approve r…`, Implement, `Run baseline…`, Validate and review, Re-validate and review, Repair candidate, Cancel workflow, Cancel session, Inspect candidate diff, `View … stdout/stderr`, Enable project components, Refresh components, Refresh workflows, Save memory, Save prompt, Delete memory, Search memory, Clear search, Use this prompt in next plan, Reconcile external changes, Earlier events, Later events, Latest events, Newer sessions, Older sessions, Save correction.
  - Text: "Local runtime connected", "Nothing is waiting on you.", "No projects yet", "Nothing here.", "dragging a card is not implemented", "2 ticket(s) · 1 active workflow(s)", "testing setup needed", "Waiting on you", "doctor: ok.", "doctor: FAILED.", "Connect to the runtime to see its environment", the Settings description, "Project components enabled", "No independent review recorded for this candidate.", and the candidate and baseline reasons the tests quote.
  - Labels: `aria-label` "Blockers waiting on you", "Projects and validation health", "Runtime environment and credential presence". If grouping removes the single list that carries this label, put it on the wrapping group and update the test.
  - Selectors and markers: everything listed in Core › Markers preserved.
- **All-caps conflict.** `doctor: FAILED.` violates Ledger's no-all-caps rule but is matched by `Settings.test.tsx`. Keep it. A future change can revise the runtime-mirrored copy together with its test.
- **Badge case.** Ledger badges are sentence case ("Succeeded"). Luuna's badge renders the exact runtime value (`ok`, `plan ready`) per `docs/DESIGN-SYSTEM.md` and the tone taxonomy test. Keep the runtime text, and do not capitalize it in CSS or JS.
- **Settings grouping.** This is client presentation keyed on item names. Unknown items fall into Optional tools, so a new runtime item is never hidden. The runtime still decides status and `ok`.
- **Risk.** L2 or L3 may change `Page`, `Section` or `EmptyState` signatures in ways this plan did not anticipate. Prefer adapting call sites over editing L2 or L3 files. Any cross-owner edit is minimal, token-only and reported.
- **Evidence boundary.** Static-markup tests and builds do not prove the fold at 1366x768, 1280x720 or 390x844, contrast, or platform rendering. Item Q owns that real-render evidence.
