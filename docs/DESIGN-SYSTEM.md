# Luuna desktop design system

Date: 2026-10-21, updated 2026-10-22 for the sidebar shell and Tailwind utilities. Status: current; decisions recorded in [ADR 0013](decisions/0013-desktop-design-system.md) and [ADR 0030](decisions/0030-desktop-shell-and-tailwind.md). This is the visual and interaction contract for the desktop client (`apps/desktop`). It is presentation only: the runtime decides every state, permission, reason and next step, and the client displays them. A design change may never change which control appears, when it is enabled, or what text the runtime's state produces.

## Principles

1. **Green is earned.** The success tone means passed durable evidence: a passed check or baseline, a reviewed candidate or run, a `passed` review verdict, and a live authenticated connection. A completed demo session, an approval or a recorded candidate is not evidence and is never green. The UI's own copy says so: "A completed session is not a validation result."
2. **Six tones, three channels.** Every state is carried by a colour family, a shape mark and the unchanged runtime text. Colour is never the only signal, and no tone has two meanings.
3. **Identities are shown whole.** Hashes, commits, trees, fingerprints, sessions, worktree paths and artifact ids render in `code`: monospace, wrapping anywhere. CSS never truncates them. The only short forms are the leading-prefix slices that summary rows already make in code.
4. **Reason, then next step.** A recorded reason carries the tone of the state it explains. The next allowed step follows it on its own line, ruled in lavender.
5. **Interruption is not failure.** Outages, restarts, interrupted work and abandoned leases use the interrupted tone (plum, pause bars), never danger. Their work is durable.
6. **Lavender means the developer acts; cyan means the runtime works.** The brand lavender marks primary actions, the next step, focus and selection. The active tone is cyan, so runtime activity is never confused with a call to action. An action group has at most one primary button.
7. **Tokens only.** Literal colours, lengths and durations live in `design/tokens.css` alone. Every colour exists in the dark and the light scheme, and every text pair meets WCAG 2.1 AA.
8. **One page, one outline.** Heading levels follow the document outline in DOM order (h1 the wordmark, h2 per view, h3 per section or subpanel, h4 inside a candidate or a session). Visual order equals DOM order at every width.
9. **One view at a time, no instructions needed.** The sidebar selects a view; a view opens with a large title and one sentence that says what it is for. Rules and explanations live in Help, not above controls.

## Files and layers

```text
apps/desktop/src/
  styles.css                 manifest: @layer tokens, base, components, screens, utilities; then @import … layer(…)
  design/tokens.css          the only file with literals; dark :root, light under prefers-color-scheme
  design/base.css            element defaults: type, code/pre, focus, forms, buttons
  design/components.css      tone indirection and every reusable component
  design/tone.ts             Tone type and exhaustive maps from runtime unions to tones
  ui/                        the component library every view composes (ADR 0030 amendment):
                             controls, layout (Page, Section), content, selection, shell
  content/views.ts           the views' titles and descriptions, the sidebar order and shortcuts
  design/components.test.ts  enforcement: 300-line files, no raw elements in views, Page on every view
  design/StatusBadge.tsx     the one status chip
  design/Icon.tsx            the sidebar's line icons (decorative, aria-hidden)
  design/tailwind.css        Tailwind CSS v4 utilities; the theme only references the tokens (ADR 0030)
  design/design-system.test.ts   enforcement (run by npm test)
  screens/app.css            shell: sidebar, views, connect page, Settings › Runtime, Sessions workspace, history, events
  screens/home.css           Home summary: projects, validation health, blockers
  screens/board.css          Kanban projection: wrapping columns of read-only cards
  screens/projects.css       Projects panel
  screens/workflows.css      tickets, plan controls, plan review
  screens/candidate-review.css   candidate evidence, checks, diff, verdict
  screens/project-components.css tickets, scoped memory and versioned prompts
  screens/help.css           Help: onboarding, states, evidence, documents
```

Vite inlines the imports into one bundled stylesheet served from `'self'`, which the Tauri CSP allows. Later layers win regardless of specificity, so a screen rule refines a component without `!important`. No font, script or stylesheet is fetched.

Tailwind CSS v4 (`@tailwindcss/vite`) compiles `design/tailwind.css` into the last layer, `utilities`. No preflight is imported and Tailwind's palette is never loaded: the theme is `@theme inline reference` over the tokens, so `gap-2` is `calc(var(--space-1) * 2)`, `text-sm` is `var(--text-sm)` and `bg-surface` is `var(--color-surface)`. Use utilities for layout in markup (flex, grid, gap); keep tones, components and anything a smoke reads in the layered stylesheets.

## Tokens

Dark is the default; the light scheme redefines every colour under `@media (prefers-color-scheme: light)`. Values are hex so the contrast test computes ratios from the file itself.

| Role | Dark | Light | Use |
| --- | --- | --- | --- |
| `--color-bg` | `#111114` | `#f5f5f7` | page |
| `--color-sidebar` | `#141417` | `#ededf0` | sidebar (window chrome) |
| `--color-surface` | `#18181c` | `#ffffff` | card |
| `--color-surface-raised` | `#1f1f24` | `#f9f9fb` | record row, tray, hover |
| `--color-surface-sunken` | `#0c0c0e` | `#f0f0f3` | pre, scroll regions |
| `--color-field` / `-disabled` | `#0c0c0e` / `#18181c` | `#ffffff` / `#f0f0f3` | text fields: enabled well, disabled |
| `--color-control` / `-hover` | `#24242a` / `#2f2f36` | `#ffffff` / `#f2f2f5` | secondary button, sidebar hover (disabled buttons are ghosted: no fill) |
| `--color-selected` / `-border` | `#26264a` / `#4d4d9a` | `#ebebfd` / `#a5a8f0` | selected card, current view |
| `--color-border` | `#2c2c33` | `#e2e2e7` | decorative dividers |
| `--color-border-control` | `#75757f` | `#7c7c87` | control edges (3:1 non-text) |
| `--color-text` | `#ededf0` | `#1d1d1f` | body text |
| `--color-text-muted` | `#a3a3ad` | `#515158` | labels, terms, scope, small |
| `--color-text-subtle` | `#9696a2` | `#5f5f68` | meta: times, event numbers, placeholders |
| `--color-text-disabled` | `#74747e` | `#8a8a94` | disabled controls (exempt from 1.4.3) |
| `--color-accent` / `-hover` | `#a9adff` / `#c3c6ff` | `#4c4bd6` / `#3e3dbd` | primary, next step, links, selection |
| `--color-on-accent` | `#111114` | `#ffffff` | text on accent |
| `--color-focus` | `#b4b8ff` | `#4c4bd6` | focus ring |

Each tone has `--tone-<name>-fg` (text), `-bg` (tint), `-border` and `-mark` (shape) in both schemes; see `tokens.css`.

Scales: type `--text-2xs` 11 px (badges, eyebrow, meta), `--text-xs` 12 px (evidence, labels, code), `--text-sm` 13 px (controls, card text, h4), `--text-md` 14 px (body, h3), `--text-lg` 16 px (h2), `--text-xl` fluid 26 to 34 px (h1); weights 400, 550, 650; space on a 4 px rhythm (`--space-1` 4 px to `--space-7` 48 px, plus 2 px and 6 px half steps); radii 4, 7, 11 px; `--border-width` 1 px, `--rule-width` 3 px, `--focus-width` 2 px; controls and single-line fields 34 px (28 px small buttons); layout `--layout-max` 1280 px with a gutter of 40, 24 and 16 px at full width, 920 px and 680 px; textareas start at their `rows` with a 68 px floor; `--scroll-max` 28 rem and `--plan-max` 24 rem for bounded regions; motion durations `--duration-fast` 120 ms and `--duration-follow` 160 ms (the live-output glide), both 0 ms under reduced motion; `--follow-threshold` 48 px (how near the bottom still counts as pinned); tail caret `--tail-caret-width`, `--tail-caret-height` and `--tail-caret-gap`. Monospace stack `--font-mono`: Cascadia Mono, Cascadia Code, Consolas, then `ui-monospace`, SF Mono, Menlo, Liberation Mono. These are installed, hinted faces; nothing is fetched (CSP `default-src 'self'`, no `@font-face`).

## Tones

| Tone | Meaning | Mark | Runtime values |
| --- | --- | --- | --- |
| success (green) | passed durable evidence | filled circle | run `reviewed`; candidate `reviewed`; check and baseline `passed`; verdict `passed`; connection connected |
| active (cyan) | the runtime is working | ring | run `running`, `exploring`, `implementing`, `validating`, `reviewing`; candidate `validating`, `reviewing`; baseline `running`; lease `active` |
| danger (rose) | failed or blocked evidence | diamond | run `failed`, `testing_blocked`; candidate `failed`, `testing_blocked`; check and baseline `failed`, `blocked`; verdict `changes_required`, `blocked`; severity `blocking` |
| attention (amber) | waiting on the developer | triangle | run `plan_ready`, `approved`, `paused`; candidate `paused`; severity `warning`; recipe confidence `inferred`; project `unconfirmed` |
| neutral (slate) | recorded, not evidence | bar | run `queued`, `completed`, `cancelled`, `discovered`; candidate `pending`, `cancelled`; check `cancelled`; severity `info`; lease `released`; connection offline |
| interrupted (plum) | stopped by an outage or restart, recoverable | pause bars | `interrupted` everywhere; lease `abandoned`; connection reconnecting |

`design/tone.ts` holds these as `Record<Union, Tone>` maps over the `@luuna/api-client` unions, so a new runtime state fails `npm run typecheck` until it is given a tone. Descriptor chips (`manifest r2`, `ticket r1 · …`, `required · observed`) take no tone and render as outlined chips.

## Components

Every component below is rendered by `src/ui`. A view never writes the element itself; `components.test.ts` fails if it does. A new pattern becomes a library component first, then views use it.

| Component | Markup | Rules |
| --- | --- | --- |
| Status badge | `<StatusBadge tone={…}>{text}</StatusBadge>` renders `span.state[data-tone]` | Text is exactly the runtime value (underscores replaced as the screen already does); badges never transform case. Never add words inside the badge. |
| Tone mark | `i.tone-mark[data-tone]` (`aria-hidden`) | The badge's shape on its own, for a status dot outside a badge (the connection status). |
| Tag | `span.tag` | Static descriptor in a panel heading. |
| Panel | `section.panel[aria-labelledby]` > `.panel-heading` (h2, then tag/badge/action) > `.scope` > body | One h2 per panel. A panel is a grid spaced by `gap` (16 px); components carry no outer margin; a heading's description sits 8 px under it. No dimming, no hover. |
| Subpanel | `.subpanel` | Top rule and a 12 px grid rhythm for a section inside a panel or card (`.workflows`, `.candidate-review`). |
| Tray | `.tray` | A raised group of related settings inside a panel (the workflow run settings). |
| Meta line | `.meta` | A muted evidence sentence (run detail, plan meta, worktree, usage, diff meta); its `code` identities stay at full contrast, figures are tabular. |
| Button | `button` (secondary), `.primary`, `.danger`, `.text-button` | One `.primary` per action group. `.danger` and `.text-button` are small. Disabled uses the disabled colour tokens, never opacity. |
| Field | `label` wrapping `input`/`textarea` | Label text above the field. `spellCheck={false}` fields render monospace. A checkbox label is an inline row. |
| Field row | `.field-row` | Side-by-side fields that share the row and wrap one per line below 2 × 14 rem; a trailing `small` takes the full row. |
| Form footer | `.form-footer` > `small` + primary | Hint left, primary right even when it wraps. |
| Form group | `.form-group` | A bordered, unfilled group around a form (register, ticket). |
| Action row | `.actions` | Wrapping row; a trailing `small` takes the full row; `.danger` goes to the end. |
| Facts | `dl.facts` > `div` > `dt` + `dd` | Full identities in `dd code`. Term column 150 px, one column at 680 px (at 920 px inside a candidate, where every value is a full hash). |
| Record list | `ul.record-list` > `li.record` | Bordered rows: baselines, recipes, tickets, checks, findings. A nested record alternates its surface. `data-tone` on a leaf record (baseline, check, finding) adds a toned rule on its leading edge; a ticket card carries its state in its run badge, not a page-length rule. `.record-headed` puts the title and badge on the first line and every later child on its own full-width line. |
| Selectable card | `button.run-card[aria-pressed]` > `.run-prompt` + `.run-meta` | Selection shows by fill, border and a lavender inset rule, not colour alone. `.run-prompt` may clamp prose to two lines, never identities. |
| Reason and next step | `.failure-note[data-tone]` then `.recovery-note` | The reason carries an 8 px-inset rule and text in the tone of the state it explains; the next step follows flush under it, ruled in lavender, whether nested in the reason or its next sibling. |
| Callout | `.callout[data-tone]` | Toned box for outages, open questions and the runtime's activity status. |
| Alert banner | `.error[role=alert]` with a Dismiss `.text-button` | Refused actions and failed loads only; always dismissible. Outages are `role=status`, not alerts. |
| Disclosure | `details` > `summary`; `details.section` for a section heading (diff, check evidence, event record) | CSS caret, never text, so it adds nothing to the accessible name; the caret aligns with the content edge. |
| Scroll region | `ol.events`, `pre[aria-label][tabIndex=0]` | The only elements that scroll; bounded by `--scroll-max` (`--plan-max` for the plan). Focusable, with an inset focus ring. Has `scrollbar-gutter: stable` and `contain: content`. The Pi response (`LiveOutput`) and the session event list (`ScrollList follow`) follow new content. |
| Empty state | `.empty` (inline text), `.empty-box` (dashed box), `.activity-empty` | Muted text; the glyph is `aria-hidden`. |

## Screens

- **App shell** (`App.tsx`, `screens/app.css`): skip link, then a sidebar (the wordmark as `h1`, the connection status with a tone mark, the view navigation with `aria-current="page"` and `Ctrl+1` to `Ctrl+6`) beside `main`. `main` holds the alert banner and the outage callout, the connect page while no runtime answers (every view but Help), then one `div.view` per view, all mounted and only the current one shown: Home, Board, Projects, Sessions (history beside the start form and the session events), Settings (Settings › Runtime with Disconnect and Stop runtime, then the environment report) and Help. A view's top-level panel renders as the page: no card, a `--text-title` heading, one sentence. At 920 px and below the sidebar is an icon rail and the Sessions workspace stacks.
- **Home** (`Home.tsx`, `screens/home.css`): first "Waiting on you" (h3, the blockers), then "Projects" (h3): one record per project (name, manifest chip, id, counts), its repositories each with the latest baseline's badge (`baselineTone`) or `no baseline`, and `testing setup needed` where the runtime offers the prerequisite; then the blockers as headed records ruled in the tone of the state they report; every control opens the Projects panel. `data-surface="home"`.
- **Board** (`Board.tsx`, `screens/board.css`): the eight columns of docs/09-experience.md as a wrapping grid of column records (h3 with a count, the column's scope), each a list of selectable cards whose badge is the run state through `runTone` (`testing setup` for an offer, an untoned `no plan` chip for the backlog); the note says dragging is not implemented. Columns are styled by position, never by a state name. `data-surface="board"`.
- **Help** (`Help.tsx`, `screens/help.css`): static sections (onboarding, the six tones with their run and candidate values, where evidence lives, documents) in a wrapping grid. `data-surface="help"`.
- **Projects** (`Projects.tsx`, `screens/projects.css`): a rail with the project cards, then the "Add a project" disclosure (the register form; open while no project exists), "Import from another machine" and "Create from a stack profile", and a detail card: the project header (h3 name, manifest chip, id), facts (the first `.facts` on the page), the "Rebind repository" disclosure, the action row (a running baseline adds its `.danger` cancel), baselines (each with its reason and next step and a log button per recipe stream, then the opened log), discovery (questions callout, problems, recipes, the manifest form), the Workflows subpanel, then the project event record.
- **Workflows** (`Workflows.tsx`, `screens/workflows.css`): the testing-setup offers (headed records in the attention tone, the reason ruled and the runtime's next step under it, a `Create the testing-setup ticket` control), the ticket form (each field followed by its UTF-8 byte count), the run settings (paths, writes, approver, plan budgets, provider and model, automatic repair), then ticket cards. A ticket card holds its head, intent, actions with the run badge (the first writer's `.danger` cancel sits before the badge; a held-back "Plan r{n+1}" names its reason on its own line), the confirmation checkbox when the next revision would leave a pending, approved or reviewed revision behind, the writer's activity callout, the plan review with the complete plan in a bounded region, plan meta, earlier revisions with their badges, the reason and next step, worktree lines and the candidate.
- **Candidate review** (`CandidateReview.tsx`, `screens/candidate-review.css`): heading with badge, full identities, the action row, the publication record, a setup workflow's handoff callout (attention: the proposed checks and the runtime's next step), the editor handoff (`data-surface="editor-handoff"`: each worktree path whole in `code` with a `Copy path` text button), the runtime's activity callout, reason and next step, the diff, check evidence with logs, the independent review with findings, and usage.

### Following live output

Presentation only; the runtime still decides every state.

- `ui/glide.ts` (spring math, token parsing), `ui/stickyScroll.ts` (controller on an injected surface) and `ui/useStickyScroll.ts` (thin wiring). Views use `LiveOutput` and `ScrollList follow`.
- While the reader is within `--follow-threshold` of the bottom, new content glides there over about `--duration-follow` using a critically damped spring (velocity stays continuous when the target moves). Each frame reads, then writes `scrollTop` once, rounded to a device pixel. The first content after mount, reset or re-enable jumps instantly.
- Release is by user intent (wheel up, pointer or scrollbar, touch, navigation keys), not by a falling `scrollTop`, because scroll anchoring and our own writes also move it. Returning near the bottom re-pins. An earlier event page does not follow.
- The tail caret is `pre[data-live]::after`: steady (evidence never pulses), CSS only, so it is never selected, copied or announced. It uses the active tone and is removed when the run is terminal.
- Monospace disables ligatures and kerning and uses `text-rendering: optimizeSpeed`; the Pi response prose keeps `optimizeLegibility`. Text ancestors never get `transform`, `will-change` or `opacity`, which would drop LCD antialiasing. `overflow-anchor` stays `auto`. No canvas or WebGL text.

## Accessibility

- Every visible text run meets 4.5:1 (3:1 for large text) against its painted background in both schemes; marks, control edges and focus meet 3:1. Disabled controls are exempt and are marked with the `disabled` attribute.
- The first Tab stop is "Skip to main content", which focuses `main#main`. Focus is always visible.
- Every field has a label; every control has a name; scroll regions are focusable; heading levels never skip; every alert has a Dismiss button; `html[lang=en]`.
- No horizontal page scroll at the Tauri window's 760 px minimum width. Containers that can hold code use `min-width: 0` and `minmax(0, 1fr)`.
- Reduced motion turns transitions and the follow glide off. Forced colours keep marks and selection visible.

## Enforcement

`npm test` runs `design/design-system.test.ts`. It reads stylesheets with `node:fs`, because Vitest replaces `*.css?raw` imports with an empty string, and it fails on an empty sheet so no check can pass vacuously. It asserts:

- Outside `tokens.css`: no colour literal or function, no raw length or duration, font sizes only from `--text-*`, no `opacity`, no `!important`, approved media queries only, `outline: none` only on `main:focus`, scrolling only on labelled scroll regions, no truncation of `code`/`pre`, tone mapping only in `components.css`, no selector named after a runtime state, tone variables read only by a rule whose selector carries `[data-tone]`, and screen selectors scoped by a unique class with at most three child steps.
- Every `var()` resolves; both schemes define the same colour roles; every semantic pair meets its WCAG ratio in both schemes.
- Every component file is registered, and each screen keeps its heading levels, has no inline styles or positive `tabIndex`, renders badges through `StatusBadge`, and every alert carries Dismiss.
- The tone taxonomy: exactly the five evidence states are success; interruption is never danger; the badge renders the runtime text unchanged.

`node scripts/mvp-ui-smoke.mjs` checks the rendered result: contrast of every visible text run against its composited background in both schemes, that the client follows the system scheme, no horizontal scroll at 760 px, plus the existing keyboard, accessibility, DOM and lifecycle checks.

## Changing the system

A new colour is a token in both schemes plus a contrast pair in the test. A new runtime state is a tone in `tone.ts`. A new component goes in `components.css` and this table. Do not style by runtime state name, add a heading level, or move the DOM elements the smoke reads (listed in `scripts/mvp-ui-smoke.mjs`). Run `npm test`, `npm run typecheck`, `npm run build` (Node 24.19.0) and the desktop smoke, and report each result.
