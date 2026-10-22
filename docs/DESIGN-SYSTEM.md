# Luuna desktop design system

Date: 2026-10-21, updated 2026-10-22 for the sidebar shell, Tailwind utilities and the Ledger design system. Status: current; decisions recorded in [ADR 0013](decisions/0013-desktop-design-system.md) [ADR 0030](decisions/0030-desktop-shell-and-tailwind.md) and [ADR 0032](decisions/0032-stripe-inspired-desktop-visual-language.md) (opacity, transform, motion budget; its palette, fonts and gradients are superseded) and [ADR 0033](decisions/0033-ledger-design-system.md) (the Ledger design system: tokens, tone mapping, system fonts, themes). This is the visual and interaction contract for the desktop client (`apps/desktop`). It is presentation only: the runtime decides every state, permission, reason and next step, and the client displays them. A design change may never change which control appears, when it is enabled, or what text the runtime's state produces.

## Principles

1. **Green is earned.** The success tone means passed durable evidence: a passed check or baseline, a reviewed candidate or run, a `passed` review verdict, and a live authenticated connection. A completed demo session, an approval or a recorded candidate is not evidence and is never green. The UI's own copy says so: "A completed session is not a validation result."
2. **Six tones, three channels.** Every state is carried by a colour family, a shape mark and the unchanged runtime text. Colour is never the only signal, and no tone has two meanings.
3. **Identities are shown whole.** Hashes, commits, trees, fingerprints, sessions, worktree paths and artifact ids render in `code`: monospace, wrapping anywhere. CSS never truncates them. The only short forms are the leading-prefix slices that summary rows already make in code.
4. **Reason, then next step.** A recorded reason carries the tone of the state it explains. The next allowed step follows it on its own line, marked in the accent (indigo in light, Apple blue in dark).
5. **Interruption is not failure.** Outages, restarts, interrupted work and abandoned leases use the interrupted tone, never danger. The tone shares the neutral family (Ledger adds no colour for it), so it stays distinct through its pause-bar mark and the unchanged runtime text. Their work is durable.
6. **Accent means the developer acts; info means the runtime works.** The accent marks primary actions, the next step, focus and selection. The active tone uses Ledger `info`, told apart from the accent by its ring mark and its text, so runtime activity is never confused with a call to action. An action group has at most one primary button.
7. **Tokens only.** Literal colours, lengths and durations live in the token sheets `design/tokens*.css` alone. Every colour exists in the dark and the light scheme, and every text pair meets WCAG 2.1 AA.
8. **One page, one outline.** Heading levels follow the document outline in DOM order (h1 the wordmark, h2 per view, h3 per section or subpanel, h4 inside a candidate or a session). Visual order equals DOM order at every width.
9. **One view at a time, no instructions needed.** The sidebar selects a view; a view opens with a large title and one sentence that says what it is for. Rules and explanations live in Help, not above controls.

## Files and layers

```text
apps/desktop/src/
  styles.css                 manifest: @layer tokens, base, components, screens, utilities; then @import … layer(…)
  design/tokens.css          token sheet: Ledger colour roles, light (default) and dark (data-theme or the OS); the follow and caret tokens (ADR 0033)
  design/tokens-depth.css    token sheet: Ledger radii, z-index, shadows (flat in dark), focus; no gradients, glow or blur
  design/tokens-scale.css    token sheet: system fonts, Ledger type styles, spacing, control and layout sizes
  design/tokens-motion.css   token sheet: easings, durations, motion distances, component sizes, reduced motion
  design/tokens-legacy.css   token sheet: old names aliased to Ledger roles until the restyle items migrate them
  design/fonts.css           last tokens-layer import, not a token sheet: ten Söhne @font-face rules and the non-Apple Söhne-first override (ADR 0033 font amendment)
  design/platform.ts         sets data-platform (apple or other) before the first render
  assets/fonts/soehne/       the ten hinted Söhne TTFs, bundled at the sole user's direction (THIRD-PARTY-NOTICES.md)
  design/base.css            element defaults: type, code/pre, focus, forms, buttons
  design/components.css      tone indirection and every reusable component
  design/overlays.css        palette, menus, dialogs
  design/controls.css        buttons, fields, switch, tabs, table (item B)
  design/motion.css          keyframes and motion primitives (item B)
  design/tone.ts             Tone type and exhaustive maps from runtime unions to tones
  ui/                        the component library every view composes (ADR 0030 amendment):
                             controls, layout (Page, Section), content, selection, shell
                             stats.tsx (StatGrid, StatTile: dl.stat-grid > div.stat-tile > dt + dd with a CountUp; a count is a projection, so a tile is untoned),
                             docs.tsx (Kbd: a key cap), reveal-list.tsx (RevealList: a staggered ul named by aria-labelledby, used by the Board),
                             motion.tsx (Reveal, useReveal, CountUp, CheckDraw), surfaces.tsx (GlowSurface, Aurora), tabs.tsx (Tabs, TabPanel),
                             table.tsx (Table), feedback.tsx (ProgressBar, StreamingDots), menus.tsx (context menus; sized from offsetWidth and offsetHeight)
  content/views.ts           the views' titles and descriptions, the sidebar order and shortcuts
  design/components.test.ts  enforcement: 300-line files, no raw elements in views, Page on every view
  design/StatusBadge.tsx     the one status chip
  design/Icon.tsx            the sidebar's line icons (decorative, aria-hidden)
  design/tailwind.css        Tailwind CSS v4 utilities; the theme only references the tokens (ADR 0030)
  design/design-system.test.ts   enforcement (run by npm test); ledger-tokens.test.ts: Ledger exactness, legacy map, contrast, decoration bans
  screens/app.css            shell: sidebar, views, connect page, Settings › Runtime, Sessions workspace, history, events
  screens/shell.css          sidebar, nav pill, page header, view transitions (item C)
  screens/home.css           Home summary: projects, validation health, blockers
  screens/board.css          Kanban projection: wrapping columns of read-only cards
  screens/projects.css       Projects panel
  screens/workflows.css      tickets, plan controls, plan review
  screens/candidate-review.css   candidate evidence, checks, diff, verdict
  screens/project-components.css tickets, scoped memory and versioned prompts
  screens/help.css           Help: onboarding, states, evidence, documents
  screens/sessions.css       Sessions refinements (item D)
```

Vite inlines the imports into one bundled stylesheet served from `'self'`, which the Tauri CSP allows. Later layers win regardless of specificity, so a screen rule refines a component without `!important`. The only bundled fonts are the ten hinted Söhne TTFs for non-Apple platforms (ADR 0033 font amendment, served from `'self'` and never inlined as `data:` URIs); no font, script or stylesheet is fetched remotely, and the CSP keeps `font-src 'self'`.

Tailwind CSS v4 (`@tailwindcss/vite`) compiles `design/tailwind.css` into the last layer, `utilities`. No preflight is imported and Tailwind's palette is never loaded: the theme is `@theme inline reference` over the tokens, so `gap-2` is `calc(var(--space-1) * 2)`, `text-sm` is `var(--text-sm)` and `bg-surface` is `var(--color-surface)` (a legacy alias until L2 moves the keys to Ledger names). Use utilities for layout in markup (flex, grid, gap); keep tones, components and anything a smoke reads in the layered stylesheets.

## Tokens

The tokens are the Ledger design system's, exactly (ADR 0033): `design/tokens.css` holds the colour roles and `design-system.test.ts` and `ledger-tokens.test.ts` compare every value with the vendored `docs/design-reference/ledger/tokens/tokens.json`. Values are hex so the contrast test computes ratios from the file itself.

**Themes.** Light is the default (`:root`). Dark applies from `:root[data-theme="dark"]`, or from `prefers-color-scheme: dark` unless `data-theme="light"` is set. Both themes define the same role names, and the dark attribute block equals the dark media block. Nothing writes `data-theme` yet, so the app follows the OS; a theme control may set it later.

**Colour roles** (Ledger names, in `tokens.css`; each has a light and a dark value): surfaces `--surface`, `--surface-raised`, `--surface-muted`, `--surface-overlay`, `--field`; fills `--fill`, `--fill-strong`, `--control-selected`; lines `--separator`, `--border` (decorative), `--border-strong` (3:1 control edges); text `--ink`, `--ink-body`, `--ink-muted`, `--ink-subdued` (surfaces only), `--ink-disabled`, `--ink-on-accent`, `--ink-on-danger`, `--ink-on-banner`, `--ink-on-toast`; accent `--accent`, `--accent-hover`, `--accent-text` (links), `--accent-soft`, `--focus-ring`; status `--success`, `--danger`, `--warning`, `--info` each with a `-soft` ground; `--scrim`, `--banner`, `--toast`, `--toast-action`, `--chart-1` to `-5`, `--chart-muted`, `--chart-grid`, and `--ai` (reserved for AI output).

**Other Ledger tokens.** `tokens-depth.css`: `--radius-sm/md/lg/xl/full` (4, 6, 8, 12, 9999 px), `--z-sticky/menu/drawer/dialog/toast`, `--shadow-button/card/popover` (the first two are `none` in dark: depth comes from surface steps), and the `--shadow-focus` field ring. `tokens-scale.css`: `--font-sans` and `--font-mono` (system stacks; `--font-display` aliases sans), type styles as `--text-*`, `--leading-*` and `--weight-*` for page-title 28/36/700, metric-lg 24/32/600, section-title and metric 20/28/600, body-strong 14/20/600, body 14/20/400, label 13/18/500, caption and overline 12/16, mono 13/20; `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-12` 48 px (plus 2, 6 and 10 px half steps); `--control-sm/md/lg` 28, 32, 40 px; `--sidebar-width` 240, `--drawer-width` 440, `--dialog-width` 480, `--banner-height` 40, `--topbar-height` 56, `--content-max-width` 1200, `--fold-reference` 768 px. Luuna-only layout tokens (`--layout-max`, `--gutter`, `--palette-*`, `--menu-*`, `--aside-width`, the bounded-region sizes and the rest) keep their values in `tokens-scale.css`. `tokens-motion.css` is unchanged: easings `--ease-standard/-out/-in/-spring/-linear`; durations press 80, micro 140, standard 220, large 340 ms, plus count, draw, shimmer, pulse, ambient and stagger; `--lift-y`, `--press-scale`, `--enter-scale`, `--reveal-offset`, `--toast-offset`, `--pulse-scale`, all zero or neutral under reduced motion. `tokens.css` keeps `--duration-fast` 120 ms, `--duration-follow` 160 ms (the live-output glide), `--follow-threshold` 48 px and the tail caret tokens.

**Legacy aliases** (`tokens-legacy.css`, the last token sheet) keep every old name working by pointing it at a Ledger role. A component that still reads an old name gets the Ledger value; migrate it to the Ledger name and delete the alias. The sheet is deleted when it is empty. The final old-to-new mapping:

| Old name | Ledger |
| --- | --- |
| `--color-bg`, `--color-sidebar` | `--surface` |
| `--color-surface`, `--color-control` | `--surface-raised` |
| `--color-surface-raised`, `--color-control-hover`, `--color-field-disabled` | `--fill` (note: not Ledger `--surface-raised`) |
| `--color-surface-sunken` | `--surface-muted` |
| `--color-field` | `--field` |
| `--color-selected`, `--color-accent-tint`, `--color-selection` | `--accent-soft` |
| `--color-selected-border`, `--color-accent` | `--accent` |
| `--color-accent-hover`, `--color-accent-active` | `--accent-hover` |
| `--color-on-accent` | `--ink-on-accent` |
| `--color-focus` | `--focus-ring` |
| `--color-border` | `--separator` (`--border-strong` under Increase Contrast) |
| `--color-border-strong`, `--color-scrollbar` | `--border` |
| `--color-border-control` | `--border-strong` |
| `--color-text` | `--ink-body` |
| `--color-text-heading` | `--ink` |
| `--color-text-muted`, `--color-text-subtle` | `--ink-muted` (not `ink-subdued`: subtle text sits on fills and fields) |
| `--color-text-disabled` | `--ink-disabled` |
| `--color-scrim` | `--scrim` |
| `--tone-success-{fg,bg,border,mark}` | `--success`, `--success-soft`, `--success-soft`, `--success` |
| `--tone-active-*` | `--info`, `--info-soft`, `--info-soft`, `--info` |
| `--tone-danger-*` | `--danger`, `--danger-soft`, `--danger-soft`, `--danger` |
| `--tone-attention-*` | `--warning`, `--warning-soft`, `--warning-soft`, `--warning` |
| `--tone-neutral-*`, `--tone-interrupted-*` | `--ink-body`, `--fill-strong`, `--fill-strong`, `--ink-muted` |
| `--radius-chip` / `-input`, `-button` / `-card`, `-menu` / `-dialog` / `-pill` | `--radius-sm` / `-md` / `-lg` / `-xl` / `-full` |
| `--shadow-panel` / `-dialog`, `-overlay` / `-button-hover` / `-kbd` | `--shadow-card` / `--shadow-popover` / `--shadow-button` / `none` |
| `--control-height`, `--control-height-sm`, `--content-max`, `--space-7` | `--control-md`, `--control-sm`, `--content-max-width`, `--space-12` |
| `--text-display`, `-h1`, `-title` (and their leading and tracking) | `--text-page-title` |
| `--text-h2`, `--text-h3`, `--text-xl` | `--text-section-title`, `--text-body-strong`, `--text-metric-lg` |
| `--text-lg`, `-md` / `-small`, `-sm` / `-xs`, `-2xs` | `--text-body` / `--text-label` / `--text-caption` |
| `--tracking-h2`, `--tracking-label`, `--weight-strong` | `--tracking-none`, `--weight-semibold` |

Shadows, scrim and the focus ring are not gradients: no stylesheet may hold a gradient, and no token sheet defines a gradient, aurora, glow or blur name.

## Tones

| Tone | Meaning | Mark | Runtime values |
| --- | --- | --- | --- |
| success (green) | passed durable evidence | filled circle | run `reviewed`; candidate `reviewed`; check and baseline `passed`; verdict `passed`; connection connected |
| active (info blue) | the runtime is working | ring | run `running`, `exploring`, `implementing`, `validating`, `reviewing`; candidate `validating`, `reviewing`; baseline `running`; lease `active` |
| danger (red) | failed or blocked evidence | diamond | run `failed`, `testing_blocked`; candidate `failed`, `testing_blocked`; check and baseline `failed`, `blocked`; verdict `changes_required`, `blocked`; severity `blocking` |
| attention (warning) | waiting on the developer | triangle | run `plan_ready`, `approved`, `paused`; candidate `paused`; severity `warning`; recipe confidence `inferred`; project `unconfirmed` |
| neutral (grey) | recorded, not evidence | bar | run `queued`, `completed`, `cancelled`, `discovered`; candidate `pending`, `cancelled`; check `cancelled`; severity `info`; lease `released`; connection offline |
| interrupted (neutral grey) | stopped by an outage or restart, recoverable | pause bars | `interrupted` everywhere; lease `abandoned`; connection reconnecting |

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
| Button | `<Button variant>`: `secondary` (default), `primary`, `quiet`, `danger`, `text` (`.primary`, `.quiet`, `.danger`, `.text-button`) | One `.primary` per action group. `.danger` and `.text-button` are small. Hover lifts 1 px (`--lift-y`) and press scales to `--press-scale`, gated by `(hover: hover) and (pointer: fine)`. Disabled uses the disabled colour tokens, never opacity. |
| Field | `label` wrapping `input`/`textarea` | Label text above the field. `spellCheck={false}` fields render monospace. A checkbox label is an inline row. |
| Field row | `.field-row` | Side-by-side fields that share the row and wrap one per line below 2 × 14 rem; a trailing `small` takes the full row. |
| Form footer | `.form-footer` > `small` + primary | Hint left, primary right even when it wraps. |
| Form group | `.form-group` | A bordered, unfilled group around a form (register, ticket). |
| Action row | `.actions` | Wrapping row; a trailing `small` takes the full row; `.danger` goes to the end. |
| Facts | `dl.facts` > `div` > `dt` + `dd` | Full identities in `dd code`. Term column 150 px, one column at 680 px (at 920 px inside a candidate, where every value is a full hash). |
| Record list | `<RecordList variant="cards"|"rows" reveal>`: `ul.record-list` (`.record-rows` for the compact variant, `.reveal` for a one-time staggered entrance) > `li.record` | Bordered rows: baselines, recipes, tickets, checks, findings. A nested record alternates its surface. `data-tone` on a leaf record (baseline, check, finding) adds a toned rule on its leading edge; a ticket card carries its state in its run badge, not a page-length rule. `.record-headed` puts the title and badge on the first line and every later child on its own full-width line. |
| Selectable card | `button.run-card[aria-pressed]` > `.run-prompt` + `.run-meta` | Selection shows by fill, border and an accent inset rule, not colour alone. `.run-prompt` may clamp prose to two lines, never identities. |
| Reason and next step | `.failure-note[data-tone]` then `.recovery-note` | The reason carries an 8 px-inset rule and text in the tone of the state it explains; the next step follows flush under it, ruled in the accent, whether nested in the reason or its next sibling. |
| Callout | `.callout[data-tone]` | Toned box for outages, open questions and the runtime's activity status. |
| Alert banner | `.error[role=alert]` with a Dismiss `.text-button` | Refused actions and failed loads only; always dismissible. Outages are `role=status`, not alerts. |
| Disclosure | `details` > `summary`; `details.section` for a section heading (diff, check evidence, event record) | CSS caret, never text, so it adds nothing to the accessible name; the caret aligns with the content edge. |
| Scroll region | `ol.events`, `pre[aria-label][tabIndex=0]` | The only elements that scroll; bounded by `--scroll-max` (`--plan-max` for the plan). Focusable, with an inset focus ring. Has `scrollbar-gutter: stable` and `contain: content`. The Pi response (`LiveOutput`) and the session event list (`ScrollList follow`) follow new content. |
| Empty state | `<EmptyState boxed wash title action>`: `.empty` (inline text), `.empty-box` (dashed box), `.empty-state` with a title and action, `.activity-empty` | Muted text; the glyph is `aria-hidden`. `wash` adds a decorative `Aurora` behind a boxed or titled state; text never sits on it as the only contrast source. |
| Stat tiles | `<StatGrid label>` > `<StatTile term value>`: `dl.stat-grid` > `div.stat-tile` > `dt` + `dd` | A short row of counts; the markup holds the final number and `CountUp` only animates the first paint. Never toned, never in `.facts` (that class is read as exact identities). |
| Tabs | `<Tabs label tabs selected onSelect idPrefix>` + `<TabPanel id idPrefix selected>` | `role=tablist` with one roving tab stop. The indicator is one measured element moved by transform; it gets `data-measured` after the first measurement and is a static underline before that. |
| Table | `<Table label columns rows rowKey>`; a column is `{ id, header, cell, numeric? }` | A real `table` with `scope=col` headers; `numeric` columns align and use tabular figures. |
| Switch | `<Switch label>` | A checkbox with `role=switch` for a setting that applies at once; a Checkbox is for a choice submitted with a form. |
| Progress and streaming | `<ProgressBar label>` (`role=progressbar`), `<StreamingDots label?>` | Decorative motion that signals work, never evidence. Dots are `aria-hidden` unless labelled. |
| Key cap | `<Kbd>` renders `kbd.kbd` | Help's shortcuts topic. |
| Check draw | `<CheckDraw size="sm"|"md"|"lg" label?>` | A check mark drawn once with `stroke-dashoffset`. Only beside a result that is already recorded (doctor ok, a passed verdict). |
| Reveal | `<Reveal label?>` and `useReveal()` | Children rise in one after another once per mount (stagger capped at 10); `data-revealed` is set afterwards so later children never animate. |
| Glow and aurora | `<GlowSurface>`, `<Aurora intensity="subtle"|"vivid">` | Retired by ADR 0033 (no gradients): both render inert (`.aurora` is `display: none`, the glow has no background) until item L2 removes the components. |
| Icon | `<Icon name className?>` | `className` is appended to `icon`; still decorative and `aria-hidden`. |

## Screens

- **App shell** (`App.tsx`, `screens/app.css`): skip link, then a sidebar (the wordmark as `h1`, the connection status with a tone mark, the view navigation with `aria-current="page"` and `Ctrl+1` to `Ctrl+6`) beside `main`. `main` holds the alert banner and the outage callout, the connect page while no runtime answers (every view but Help), then one `div.view` per view, all mounted and only the current one shown: Home, Board, Projects, Sessions (history beside the start form and the session events), Settings (Settings › Runtime with Disconnect and Stop runtime, then the environment report) and Help. A view's top-level panel renders as the page: no card, a `--text-title` heading, one sentence. At 920 px and below the sidebar is an icon rail and the Sessions workspace stacks.
- **Home** (`Home.tsx`, `screens/home.css`): first "Waiting on you" (h3, the blockers), then "Projects" (h3): one record per project (name, manifest chip, id, counts), its repositories each with the latest baseline's badge (`baselineTone`) or `no baseline`, and `testing setup needed` where the runtime offers the prerequisite; then the blockers as headed records ruled in the tone of the state they report; every control opens the Projects panel. `data-surface="home"`.
- **Board** (`Board.tsx`, `screens/board.css`): the eight columns of docs/09-experience.md as a wrapping grid of column records (h3 with a count, the column's scope), each a list of selectable cards whose badge is the run state through `runTone` (`testing setup` for an offer, an untoned `no plan` chip for the backlog); the note says dragging is not implemented. Columns are styled by position, never by a state name. `data-surface="board"`.
- **Help** (`Help.tsx`, `screens/help.css`): static sections (onboarding, the six tones with their run and candidate values, where evidence lives, documents) in a wrapping grid. `data-surface="help"`.
- **Projects** (`Projects.tsx`, `screens/projects.css`): a rail with the project cards, then the "Add a project" disclosure (the register form; open while no project exists), "Import from another machine" and "Create from a stack profile", and a detail card: the project header (h3 name, manifest chip, id), facts (the first `.facts` on the page), the "Rebind repository" disclosure, the action row (a running baseline adds its `.danger` cancel), baselines (each with its reason and next step and a log button per recipe stream, then the opened log), discovery (questions callout, problems, recipes, the manifest form), the Workflows subpanel, then the project event record.
- **Workflows** (`Workflows.tsx`, `screens/workflows.css`): the testing-setup offers (headed records in the attention tone, the reason ruled and the runtime's next step under it, a `Create the testing-setup ticket` control), the ticket form (each field followed by its UTF-8 byte count), the run settings (paths, writes, approver, plan budgets, provider and model, automatic repair), then ticket cards. A ticket card holds its head, intent, actions with the run badge (the first writer's `.danger` cancel sits before the badge; a held-back "Plan r{n+1}" names its reason on its own line), the confirmation checkbox when the next revision would leave a pending, approved or reviewed revision behind, the writer's activity callout, the plan review with the complete plan in a bounded region, plan meta, earlier revisions with their badges, the reason and next step, worktree lines and the candidate.
- **Candidate review** (`CandidateReview.tsx`, `screens/candidate-review.css`): heading with badge, full identities, the action row, the publication record, a setup workflow's handoff callout (attention: the proposed checks and the runtime's next step), the editor handoff (`data-surface="editor-handoff"`: each worktree path whole in `code` with a `Copy path` text button), the runtime's activity callout, reason and next step, the diff, check evidence with logs, the independent review with findings, and usage.

- **Screen details (item D).** Home: an `Aurora` hero, a stat tile row and `GlowSurface` project cards. Board: raised cards in a `RevealList` whose only hover effect is a shadow and lift on the selectable card. Settings: one drawn `CheckDraw` beside the doctor verdict when it is ok. Help: a shortcuts topic of `Kbd` key caps. Projects, Workflows, Candidate review and Project components: row styling through `RecordList` rows and washed empty states (Project components also carries an `Aurora`); a passed verdict draws one check. Sessions: a lifted history rail, a live output card kept static, and `StreamingDots` while the active run is not terminal.
- **Static depth on evidence.** Evidence, approval, baseline, candidate and verdict blocks (and `.facts`, `.state`, `.callout`, notes, records, `ol.events`, `pre`) get static depth only (a resting shadow, border or radius): no transition, animation, opacity or transform. `design/screens-motion.test.ts` guards this per screen sheet with fixtures that prove a hover lift, a transition and a fade on those selectors fail.

### Following live output

Presentation only; the runtime still decides every state.

- `ui/glide.ts` (spring math, token parsing), `ui/stickyScroll.ts` (controller on an injected surface) and `ui/useStickyScroll.ts` (thin wiring). Views use `LiveOutput` and `ScrollList follow`.
- While the reader is within `--follow-threshold` of the bottom, new content glides there over about `--duration-follow` using a critically damped spring (velocity stays continuous when the target moves). Each frame reads, then writes `scrollTop` once, rounded to a device pixel. The first content after mount, reset or re-enable jumps instantly.
- Release is by user intent (wheel up, pointer or scrollbar, touch, navigation keys), not by a falling `scrollTop`, because scroll anchoring and our own writes also move it. Returning near the bottom re-pins. An earlier event page does not follow.
- The tail caret is `pre[data-live]::after`: steady (evidence never pulses), CSS only, so it is never selected, copied or announced. It uses the active tone and is removed when the run is terminal.
- Monospace disables ligatures and kerning and uses `text-rendering: optimizeSpeed`; the Pi response prose keeps `optimizeLegibility`. Live output and its ancestors never get `transform`, `will-change`, `opacity` or `filter`, which would drop LCD antialiasing; elsewhere a transform on a text ancestor is transient (hover lift, press, a one-time entrance) at integer pixels, and nothing is left transformed at rest (ADR 0032). `overflow-anchor` stays `auto`. No canvas or WebGL text.

### Motion

ADR 0032 decisions 4 to 7 in short. Hover lifts 1 px and press scales to 0.98; entrances play once through a keyframe with `backwards` fill and end at full opacity; opacity appears only in `@keyframes` or as an exact 0/1 toggle on a decorative pseudo-element. Only `transform`, `opacity`, `background-position`, `clip-path` and `stroke-dashoffset` animate. The active chip and the live connection mark may pulse through a CSS `::after` ring; evidence, the tail caret and approvals never pulse, fade out or auto-dismiss. Optional features (view transitions, `@starting-style`, `backdrop-filter`) are gated by `@supports` with a complete static fallback, and hover effects by `(hover: hover) and (pointer: fine)`. No `will-change`.

- **Active chip pulse.** A CSS-only ring on `.state[data-tone="active"]::after` that loops forever. It is hidden under reduced motion and forced colours and never encodes evidence or approval state.
- **Buttons.** Hover lifts `translateY(-1px)` (`--lift-y`) and press scales to `.98`: integer pixel, interaction-only, gated by `(hover: hover) and (pointer: fine)`. `.nav-item` is excluded.
- **Measuring.** `menus.tsx` sizes a menu with `offsetWidth` and `offsetHeight`, not `getBoundingClientRect`, because the entrance scales it. Markers: `data-measured` (Tabs indicator measured), `data-pill="ready"` (nav pill measured), `data-revealed` (Reveal has played), `data-entering` (a view that just became current).
- **Shell.** One measured nav pill moved by transform only. A view change uses View Transitions where `document.startViewTransition` exists; otherwise a CSS enter plays from `data-entering` (`data-view-motion="css"`). Under reduced motion every one of these is instant.

### Fonts

Söhne first on non-Apple platforms, Ledger's system stack everywhere else (ADR 0033 and its 2026-10-22 font amendment). `--font-sans` in `tokens-scale.css` is the Ledger stack (`-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `Segoe UI`, `Helvetica Neue`, Arial) and `--font-mono` is `ui-monospace`, `SF Mono`, Menlo, Consolas. Those token values are Ledger's exactly. `design/fonts.css` declares one family, "Söhne", with ten faces from the user's hinted TrueType files (weights 300 to 700, upright and italic, `font-display: swap`), and `:root[data-platform="other"]` puts "Söhne" first in `--font-sans` and `--font-display` ahead of the Ledger stack, which is the fallback. `--font-mono` is untouched. `design/platform.ts` sets `data-platform` before the first render; Apple platforms keep the Ledger stack and SF Pro is never bundled. The files are TTF, not woff2, because the earlier unhinted woff2 subsets rendered soft on Windows at 125% scaling; a test requires the `fpgm`, `prep` and `cvt ` tables in every file. Vite never inlines them, nothing is fetched remotely, and the CSP keeps `font-src 'self'`. Söhne is commercial and not covered by the MIT license: see `THIRD-PARTY-NOTICES.md`.

## Accessibility

- Every visible text run meets 4.5:1 (3:1 for large text) against its painted background in both schemes; marks, control edges and focus meet 3:1. Disabled controls are exempt and are marked with the `disabled` attribute.
- The first Tab stop is "Skip to main content", which focuses `main#main`. Focus is always visible.
- Every field has a label; every control has a name; scroll regions are focusable; heading levels never skip; every alert has a Dismiss button; `html[lang=en]`.
- No horizontal page scroll at the Tauri window's 760 px minimum width. Containers that can hold code use `min-width: 0` and `minmax(0, 1fr)`.
- Reduced motion makes every transition instant and the follow glide a jump; there is no drift, shimmer, count-up or stagger. Forced colours keep marks and selection visible.

## Enforcement

`npm test` runs `design/design-system.test.ts`. It reads stylesheets with `node:fs`, because Vitest replaces `*.css?raw` imports with an empty string, and it fails on an empty sheet so no check can pass vacuously. It asserts:

- Outside the token sheets: no colour literal or function, no raw length or duration, font sizes only from `--text-*`, `opacity` only inside `@keyframes` or as 0/1 on a decorative pseudo-element, durations and easings only from tokens (no `transition: all`), keyframes limited to `transform`, `translate`, `scale`, `rotate`, `opacity`, `background-position`, `clip-path` and `stroke-dashoffset`, no resting `forwards`/`both` fill, filters only from tokens, no `will-change`, no `!important`, approved media queries only, `outline: none` only on `main:focus`, scrolling only on labelled scroll regions, no truncation of `code`/`pre`, tone mapping only in `components.css`, no selector named after a runtime state, tone variables read only by a rule whose selector carries `[data-tone]`, and screen selectors scoped by a unique class with at most three child steps.
- The token sheets hold only the theme selectors (`:root`, `:root[data-theme="light"]`, `:root[data-theme="dark"]` and, inside `prefers-color-scheme: dark`, `:root:not([data-theme="light"])`) with custom properties, every `--duration-*` is zeroed under reduced motion (derived from the sheets), light and dark define the same names, and the dark attribute and dark media blocks are identical.
- Every Ledger colour, shadow, space, radius, z-index, size, font and type style equals the vendored `tokens.json`; dark card and button shadows are `none`; the legacy sheet holds only aliases and its colour and tone map is pinned; no stylesheet holds a gradient; coloured left rules are limited to a pending list that item L2 empties.
- Every `var()` resolves; both themes define the same colour roles; every Ledger text, edge and status pair, and every resolved tone, meets its WCAG ratio in both themes (links on `fill` are a documented exclusion).
- Every component file is registered, and each screen keeps its heading levels, has no inline styles or positive `tabIndex`, renders badges through `StatusBadge`, and every alert carries Dismiss.
- The tone taxonomy: exactly the five evidence states are success; interruption is never danger; the badge renders the runtime text unchanged.

`node scripts/mvp-ui-smoke.mjs` checks the rendered result: contrast of every visible text run against its composited background in both schemes, that the client follows the system scheme, no horizontal scroll at 760 px, plus the existing keyboard, accessibility, DOM and lifecycle checks.

## Changing the system

A new colour is a token in both schemes plus a contrast pair in the test. A new duration is a token and is also zeroed in the reduced-motion block. A new runtime state is a tone in `tone.ts`. A new component goes in `components.css` and this table. Do not style by runtime state name, add a heading level, or move the DOM elements the smoke reads (listed in `scripts/mvp-ui-smoke.mjs`). Run `npm test`, `npm run typecheck`, `npm run build` (Node 24.19.0) and the desktop smoke, and report each result.
