# Luuna desktop design system

Date: 2026-10-21, updated 2026-10-22 for the sidebar shell, Tailwind utilities, the Ledger design system and the Mantine theme values. Status: current; decisions recorded in [ADR 0013](decisions/0013-desktop-design-system.md) [ADR 0030](decisions/0030-desktop-shell-and-tailwind.md) and [ADR 0032](decisions/0032-stripe-inspired-desktop-visual-language.md) (opacity, transform, motion budget; its palette, fonts and gradients are superseded) [ADR 0033](decisions/0033-ledger-design-system.md) (the Ledger structure and rules: themes, tone channels, decoration bans; its palette and fonts are superseded) and [ADR 0035](decisions/0035-mantine-theme-and-outfit.md) (token values match Mantine's default theme; Mantine's system stack for text, Outfit for headings). This is the visual and interaction contract for the desktop client (`apps/desktop`). It is presentation only: the runtime decides every state, permission, reason and next step, and the client displays them. A design change may never change which control appears, when it is enabled, or what text the runtime's state produces.

Component catalog: [COMPONENT-LIBRARY.md](COMPONENT-LIBRARY.md) indexes every owned `@luuna/ui` component, its family fragment and the rules it keeps (ADR 0034).

## Principles

1. **Green is earned.** The success tone means passed durable evidence: a passed check or baseline, a reviewed candidate or run, a `passed` review verdict, and a live authenticated connection. A completed demo session, an approval or a recorded candidate is not evidence and is never green. The UI's own copy says so: "A completed session is not a validation result."
2. **Six tones, three channels.** Every state is carried by a colour family, a shape mark and the unchanged runtime text. Colour is never the only signal, and no tone has two meanings.
3. **Identities are shown whole.** Hashes, commits, trees, fingerprints, sessions, worktree paths and artifact ids render in `code`: monospace, wrapping anywhere. CSS never truncates them. The only short forms are the leading-prefix slices that summary rows already make in code.
4. **Reason, then next step.** A recorded reason carries the tone of the state it explains. The next allowed step follows it on its own line, marked in the accent (Mantine blue, shade 8 in both schemes).
5. **Interruption is not failure.** Outages, restarts, interrupted work and abandoned leases use the interrupted tone, never danger. The tone shares the neutral family (Ledger adds no colour for it), so it stays distinct through its pause-bar mark and the unchanged runtime text. Their work is durable.
6. **Accent means the developer acts; info means the runtime works.** The accent marks primary actions, the next step, focus and selection. The active tone uses Ledger `info`, told apart from the accent by its ring mark and its text, so runtime activity is never confused with a call to action. An action group has at most one primary button.
7. **Tokens only.** Literal colours, lengths and durations live in the token sheets `packages/ui/src/styles/tokens*.css` alone. Every colour exists in the dark and the light scheme, and every text pair meets WCAG 2.1 AA.
8. **One page, one outline.** Heading levels follow the document outline in DOM order (h1 the wordmark, h2 per view, h3 per section or subpanel, h4 inside a candidate or a session). Visual order equals DOM order at every width.
9. **One view at a time, no instructions needed.** The sidebar selects a view; a view opens with a large title and one sentence that says what it is for. Rules and explanations live in Help, not above controls.

## Files and layers

```text
packages/ui/src/              @luuna/ui, the owned component library (ADR 0034), imported as "@luuna/ui" and "@luuna/ui/styles/*.css"
  styles/tokens.css          token sheet: colour roles with Mantine's default-theme values, light (default) and dark (data-theme or the OS), the 14 Mantine palettes as --color-<palette>-<n>; the follow and caret tokens (ADR 0035)
  styles/tokens-depth.css    token sheet: Mantine radii (2, 4, 8, 16, 32 px) and shadows xs to xl, Luuna z-index and shadow roles (flat in dark), focus; no gradients, glow or blur
  styles/tokens-scale.css    token sheet: Mantine font stacks, sizes, line heights, weights, headings, spacing and breakpoints; Luuna type roles, the 4 px space rhythm, control and layout sizes
  styles/tokens-motion.css   token sheet: easings, durations, motion distances, component sizes, reduced motion
  styles/tokens-legacy.css   token sheet: old names aliased to the roles until the restyle items migrate them
  styles/fonts.css           last tokens-layer import, not a token sheet: the two Outfit @font-face rules (ADR 0035)
  assets/fonts/outfit/       Outfit-latin.woff2, Outfit-latin-ext.woff2 (variable, SIL OFL 1.1) and OFL.txt (THIRD-PARTY-NOTICES.md)
  assets/fonts/outfit/       Outfit variable woff2 (latin, latin-ext) and OFL.txt
  styles/base.css            element defaults: type, code/pre, focus, forms, buttons
  styles/components.css      tone indirection and every reusable component
  styles/overlays.css        palette, menus, dialogs
  styles/controls.css        buttons, fields, switch, tabs, table (item B)
  styles/motion.css          keyframes and motion primitives (item B)
  tone/tone.ts               Tone type and exhaustive maps from runtime unions to tones
  *.tsx, index.ts            the component library every view composes (ADR 0030 amendment, ADR 0034):
                             controls, layout (Page, Section), content, selection, shell
                             stats.tsx (StatGrid, StatTile: the Ledger metric card, dl.stat-grid > div.stat-tile > dt + dd.stat-value [+ dd.stat-comparison]; a count is a projection, so a tile is untoned and static),
                             docs.tsx (Kbd: a key cap), settings-row.tsx (SettingsRow), status-indicator.tsx (StatusIndicator), tabs.tsx (Tabs, TabPanel),
                             table.tsx (Table), feedback.tsx (Loading, Placeholder, ProgressBar, StreamingDots, the static CheckDraw), menus.tsx (context menus; sized from offsetWidth and offsetHeight)
  design/components.test.ts  enforcement over packages/ui and apps/desktop: 300-line files, no raw elements in views, Page on every view
  StatusBadge.tsx     the one status chip
  Icon.tsx            the sidebar's line icons (decorative, aria-hidden)
  styles/tailwind.css        Tailwind CSS v4 utilities; the theme only references the tokens (ADR 0030)
  design/design-system.test.ts   enforcement (run by npm test; the design tests live in packages/ui and scan both packages); mantine-tokens.test.ts: Mantine exactness (against design/mantine-values.ts), contrast deviations, legacy map, contrast, decoration bans; fonts.test.ts: Outfit
apps/desktop/src/
  styles.css                 manifest: @layer tokens, base, components, screens, utilities; then @import … layer(…)
  content/views.ts           the views' titles and descriptions, the sidebar order and shortcuts
  screens/app.css            shell: sidebar, views, connect page, Settings › Runtime, Sessions workspace, history, events
  screens/shell.css          banner, sidebar, top bar, page header, off-canvas panel, view transitions (item L3)
  screens/projects.css       Projects panel
  screens/workflows.css      tickets, plan controls, plan review
  screens/candidate-review.css   candidate evidence, checks, diff, verdict
  screens/project-components.css tickets, scoped memory and versioned prompts
  screens/help.css           Help: onboarding, states, evidence, documents
  screens/sessions.css       Sessions refinements (item D)
```

Vite inlines the imports into one bundled stylesheet served from `'self'`, which the Tauri CSP allows. Later layers win regardless of specificity, so a screen rule refines a component without `!important`. The only bundled font is Outfit, two woff2 files (ADR 0035, served from `'self'` and never inlined as `data:` URIs); no font, script or stylesheet is fetched remotely, and the CSP keeps `font-src 'self'`.

Tailwind CSS v4 (`@tailwindcss/vite`) compiles `styles/tailwind.css` (in `packages/ui`) into the last layer, `utilities`. No preflight is imported and Tailwind's palette is never loaded: the theme is `@theme inline reference` over the tokens, so `gap-2` is `calc(var(--space-1) * 2)`, `text-sm` is `var(--text-sm)` and `bg-surface` is `var(--color-surface)` (a legacy alias until L2 moves the keys to Ledger names). Use utilities for layout in markup (flex, grid, gap); keep tones, components and anything a smoke reads in the layered stylesheets.

## Tokens

The token values are Mantine's default theme (ADR 0035; `@mantine/core` 9.7.3, MIT, values only), exactly, except where the repo contrast gate forces a recorded deviation: `styles/tokens.css` holds the colour roles and `design/mantine-tokens.test.ts` compares every token with the typed truth table `design/mantine-values.ts` (which also lists each deviation with its ratios; the table is in ADR 0035). The ADR 0033 role names are kept. Colour values are hex so the contrast test computes ratios from the file itself.

**Themes.** Light is the default (`:root`). Dark applies from `:root[data-theme="dark"]`, or from `prefers-color-scheme: dark` unless `data-theme="light"` is set. Both themes define the same role names, and the dark attribute block equals the dark media block. Nothing writes `data-theme` yet, so the app follows the OS; a theme control may set it later.

**Colour roles** (Ledger names, in `tokens.css`; each has a light and a dark value): surfaces `--surface`, `--surface-raised`, `--surface-muted`, `--surface-overlay`, `--field`; fills `--fill`, `--fill-strong`, `--control-selected`; lines `--separator`, `--border` (decorative), `--border-strong` (3:1 control edges); text `--ink`, `--ink-body`, `--ink-muted`, `--ink-subdued` (surfaces only), `--ink-disabled`, `--ink-on-accent`, `--ink-on-danger`, `--ink-on-banner`, `--ink-on-toast`; accent `--accent`, `--accent-hover`, `--accent-text` (links), `--accent-soft`, `--focus-ring`; status `--success`, `--danger`, `--warning`, `--info` each with a `-soft` ground; `--scrim`, `--banner`, `--toast`, `--toast-action`, `--chart-1` to `-5`, `--chart-muted`, `--chart-grid`, and `--ai` (reserved for AI output).

**Other tokens.** `tokens-depth.css`: `--radius-xs/sm/md/lg/xl` (Mantine: 2, 4, 8, 16, 32 px; md is the default radius; components use sm and md) and `--radius-full`, `--shadow-xs` to `--shadow-xl` (Mantine's exact strings), `--z-sticky/menu/drawer/dialog/toast`, `--shadow-button` (`none`), `--shadow-card` (xs in light, `none` in dark: depth comes from surface steps), `--shadow-popover` (md), and the `--shadow-focus` field ring. `tokens-scale.css`: `--font-stack` (Mantine's body stack), `--font-sans` (that stack), `--font-display` (`"Outfit"` then the stack) and `--font-mono` (Mantine's monospace stack); the Mantine scale `--font-size-xs..xl` (12 to 20 px), `--line-height-xs..xl` (1.4 to 1.65), `--font-weight-regular|medium|bold` (400, 600, 700) and `--font-weight-heading` (600), `--heading-1..6-size` and `-line-height` (34, 26, 22, 18, 16, 14 px), `--spacing-xs..xl` (10, 12, 16, 20, 32 px) and `--breakpoint-xs..xl` (36, 48, 62, 75, 88 em); Luuna type roles as `--text-*`, `--leading-*` and `--weight-*` mapped onto it: page-title is Mantine h2 (26/1.35/600), metric-lg h3 (22/1.4/600), section-title h4 (18/1.45/600), metric 20/1.4/600, body-strong 16/1.55/600, body 16/1.55/400, label 14/1.45/600, caption and overline 12/1.4, mono 14/1.55 (tracking is 0 throughout); `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-12` 48 px (plus 2, 6 and 10 px half steps); `--control-sm/md/lg` 28, 32, 40 px; `--sidebar-width` 240, `--drawer-width` 440, `--dialog-width` 480, `--banner-height` 40, `--topbar-height` 56, `--content-max-width` 1200, `--fold-reference` 768 px. Luuna-only layout tokens (`--layout-max`, `--gutter`, `--palette-*`, `--menu-*`, `--aside-width`, the bounded-region sizes and the rest) keep their values in `tokens-scale.css`. `tokens-motion.css` is unchanged: easings `--ease-standard/-out/-in/-linear`; durations press 80, micro 140, standard 220, large 340 ms, plus shimmer, pulse and stagger; `--enter-scale` and `--toast-offset`, all zero or neutral under reduced motion. The unused `--lift-y`, `--press-scale`, `--reveal-offset`, `--pulse-scale`, `--ease-spring`, `--duration-count`, `--duration-draw` and `--pill-*` tokens were removed. `tokens.css` keeps `--duration-fast` 120 ms, `--duration-follow` 160 ms (the live-output glide), `--follow-threshold` 48 px and the tail caret tokens.

**Legacy aliases** (`tokens-legacy.css`, the last token sheet) keep every old name working by pointing it at a Ledger role. A component that still reads an old name gets the Ledger value; migrate it to the Ledger name and delete the alias. The sheet is deleted when it is empty. The final old-to-new mapping:

| Old name | Ledger |
| --- | --- |
| `--color-bg`, `--color-sidebar` | `--surface` |
| `--color-surface`, `--color-control` | `--surface-raised` |
| `--color-surface-raised`, `--color-control-hover`, `--color-field-disabled` | `--fill` (note: not Ledger `--surface-raised`) |
| `--color-surface-sunken` | `--surface-muted` |
| `--color-field` | `--field` |
| `--color-selected`, `--color-accent-tint`, `--color-selection` | `--accent-soft` |
| `--color-accent` | `--accent` |
| `--color-focus` | `--focus-ring` |
| `--color-border` | `--separator` (`--border-strong` under Increase Contrast) |
| `--color-border-strong`, `--color-scrollbar` | `--border` |
| `--color-border-control` | `--border-strong` |
| `--color-text` | `--ink-body` |
| `--color-text-heading` | `--ink` |
| `--color-text-muted`, `--color-text-subtle` | `--ink-muted` (not `ink-subdued`: subtle text sits on fills and fields) |
| `--color-text-disabled` | `--ink-disabled` |
| `--tone-success-{fg,bg,border,mark}` | `--success`, `--success-soft`, `--success-soft`, `--success` |
| `--tone-active-*` | `--info`, `--info-soft`, `--info-soft`, `--info` |
| `--tone-danger-*` | `--danger`, `--danger-soft`, `--danger-soft`, `--danger` |
| `--tone-attention-*` | `--warning`, `--warning-soft`, `--warning-soft`, `--warning` |
| `--tone-neutral-*`, `--tone-interrupted-*` | `--ink-body`, `--fill-strong`, `--fill-strong`, `--ink-muted` |
| `--radius-chip` / `-input`, `-button` / `-card` / `-pill` | `--radius-sm` / `-md` / `-md` / `-full` (ADR 0035: cards use Mantine's default radius) |
| `--shadow-button-hover` | `--shadow-button` |
| `--control-height`, `--control-height-sm`, `--content-max`, `--space-7` | `--control-md`, `--control-sm`, `--content-max-width`, `--space-12` |
| `--text-display`, `-h1`, `-title` (and their leading and tracking) | `--text-page-title` |
| `--text-h2`, `--text-h3`, `--text-xl` | `--text-section-title`, `--text-body-strong`, `--text-metric-lg` |
| `--text-lg` / `-md` / `-small`, `-sm` / `-xs`, `-2xs` | `--font-size-lg` / `--text-body` / `--text-label` / `--text-caption` |
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

`tone/tone.ts` (in `packages/ui`) holds these as `Record<Union, Tone>` maps over the `@luuna/api-client` unions, so a new runtime state fails `npm run typecheck` until it is given a tone. Descriptor chips (`manifest r2`, `ticket r1 · …`, `required · observed`) take no tone and render as outlined chips.

## Components

Every component below is rendered by `packages/ui` (`@luuna/ui`, ADR 0034). A view never writes the element itself; `components.test.ts` fails if it does. A new pattern becomes a library component first, then views use it.

| Component | Markup | Rules |
| --- | --- | --- |
| Status badge | `<StatusBadge tone={…}>{text}</StatusBadge>` renders `span.state[data-tone]` | Text is exactly the runtime value (underscores replaced as the screen already does); badges never transform case. Never add words inside the badge. |
| Tone mark | `i.tone-mark[data-tone]` (`aria-hidden`) | The badge's shape on its own, for a status dot outside a badge (the connection status). |
| Tag | `span.tag` | Static descriptor in a panel heading. |
| Panel | `section.panel[aria-labelledby]` > `.panel-heading` (h2, then tag/badge/action) > `.scope` > body | One h2 per panel. A panel is a grid spaced by `gap` (16 px); components carry no outer margin; a heading's description sits 8 px under it. No dimming, no hover. |
| Subpanel | `.subpanel` | Top rule and a 12 px grid rhythm for a section inside a panel or card (`.workflows`, `.candidate-review`). |
| Tray | `.tray` | A raised group of related settings inside a panel (the workflow run settings). |
| Meta line | `.meta` | A muted evidence sentence (run detail, plan meta, worktree, usage, diff meta); its `code` identities stay at full contrast, figures are tabular. |
| Button | `<Button variant size>`: `secondary` (default), `primary`, `quiet`, `danger`, `text` (`.primary`, `.quiet`, `.danger`, `.text-button`); `size` is `md` or `lg` | One `.primary` per action group. `.danger` and `.text-button` are small. Hover changes the background and press darkens it; nothing lifts or scales. Disabled uses the disabled colour tokens, never opacity. |
| Field | `label` wrapping `input`/`textarea` | Label text above the field. `spellCheck={false}` fields render monospace. A checkbox label is an inline row. |
| Field row | `.field-row` | Side-by-side fields that share the row and wrap one per line below 2 × 14 rem; a trailing `small` takes the full row. |
| Form footer | `.form-footer` > `small` + primary | Hint left, primary right even when it wraps. |
| Form group | `.form-group` | A bordered, unfilled group around a form (register, ticket). |
| Action row | `.actions` | Wrapping row; a trailing `small` takes the full row; `.danger` goes to the end. |
| Facts | `dl.facts` > `div` > `dt` + `dd` | Full identities in `dd code`. Term column 150 px, one column at 680 px (at 920 px inside a candidate, where every value is a full hash). |
| Record list | `<RecordList variant="cards"` or `"rows">`: `ul.record-list` (`.record-rows` for the compact hairline rows) > `li.record` | Bordered rows: baselines, recipes, tickets, checks, findings. A nested record sits on the muted surface. `data-tone` on a leaf record (baseline, check, finding) is a data attribute only: its tone shows through the record's own badge (word plus shape), never an edge colour. `.record-headed` puts the title and badge on the first line and every later child on its own full-width line. Home's blockers and projects use the rows variant. |
| Selectable card | `button.run-card[aria-pressed]` > `.run-prompt` + `.run-meta` | Selection shows by fill, border and an accent inset rule, not colour alone. `.run-prompt` may clamp prose to two lines, never identities. |
| Reason and next step | `.failure-note[data-tone]` then `.recovery-note` | The reason carries an 8 px-inset rule and text in the tone of the state it explains; the next step follows flush under it, ruled in the accent, whether nested in the reason or its next sibling. |
| Callout | `.callout[data-tone]` | Toned box for outages, open questions and the runtime's activity status. |
| Alert banner | `.error[role=alert]` with a Dismiss `.text-button` | Refused actions and failed loads only; always dismissible. Outages are `role=status`, not alerts. |
| Disclosure | `details` > `summary`; `details.section` for a section heading (diff, check evidence, event record) | CSS caret, never text, so it adds nothing to the accessible name; the caret aligns with the content edge. |
| Scroll region | `ol.events`, `pre[aria-label][tabIndex=0]` | The only elements that scroll; bounded by `--scroll-max` (`--plan-max` for the plan). Focusable, with an inset focus ring. Has `scrollbar-gutter: stable` and `contain: content`. The Pi response (`LiveOutput`) and the session event list (`ScrollList follow`) follow new content. |
| Empty state | `<EmptyState boxed title action>`: `.empty` (inline text), `.empty-box` (dashed box), `.empty-state` with a title and action, `.activity-empty` | A plain fact as the title, an optional one-line description, and one primary only where a control already exists. No decorative ground; the glyph is `aria-hidden`. |
| Stat tiles | `<StatGrid label>` > `<StatTile term value comparison?>`: `dl.stat-grid` > `div.stat-tile` > `dt` + `dd.stat-value` | A short row of counts (Ledger MetricCard); the markup holds the final number, static, with tabular numerals. Never toned, never in `.facts` (that class is read as exact identities). Home shows four on a muted tray, 4 across and 2 x 2 under 920 px. |
| Tabs | `<Tabs label tabs selected onSelect idPrefix>` + `<TabPanel id idPrefix selected>` | `role=tablist` with one roving tab stop. The selected tab carries a static underline (`[aria-selected="true"]::after`); nothing slides. |
| Table | `<Table label columns rows rowKey>`; a column is `{ id, header, cell, numeric? }` | A real `table` with `scope=col` headers; `numeric` columns align and use tabular figures. |
| Switch | `<Switch label>` | A checkbox with `role=switch` for a setting that applies at once; a Checkbox is for a choice submitted with a form. |
| Progress and streaming | `<ProgressBar label>` (`role=progressbar`), `<StreamingDots label?>` | Decorative motion that signals work, never evidence. Dots are `aria-hidden` unless labelled. |
| Key cap | `<Kbd>` renders `kbd.kbd` | Help's shortcuts topic. |
| Check mark | `<CheckDraw size label?>` (feedback.tsx; size is `sm`, `md` or `lg`) | A static check beside a recorded success. It never animates. No screen uses it now: a verdict and the Settings report are a word plus a tone shape. |
| Settings row | `<SettingsRow title description? badge? control? stacked?>` | A titled setting with a description and a trailing control; it stacks under 680 px. Settings uses it for each doctor item: the name and `required` tag as the title, the runtime detail as the description, the status badge as the control. |
| Status indicator | `<StatusIndicator tone? label detail? live?>` | A tone shape, a word and optional detail for a live state. The sidebar's `ConnectionStatus` keeps its own `.connection` markup. |
| Icon | `<Icon name className?>` | `className` is appended to `icon`; still decorative and `aria-hidden`. |

## Screens

- **App shell** (`App.tsx`, `shell.tsx`, `screens/shell.css`, ADR 0033): skip link, an optional full-width Banner (shown only while the runtime is unreachable: label "Reconnecting", the outage text and the durable-work sentence), a 240 px sidebar (the wordmark as `h1`, the view navigation with `aria-current="page"` shown by accent text and bold weight, never a filled pill, and `Ctrl+1` to `Ctrl+6`, the one connection status with a tone mark in the footer) and a column holding the sticky 56 px top bar (the "Go to…" palette trigger with its Ctrl K key cap) above `main`, capped at 1200 px. `main` holds the alert banner, the connect page while no runtime answers (every view but Help), then one `div.view` per view, all mounted and only the current one shown: Home, Board, Projects, Sessions (history beside the start form and the session events), Settings and Help. A view's top-level panel renders as a compact page header: no card, a `--text-page-title` heading with its actions in one row, one sentence. The icon rail (`Ctrl+\`) applies above 768 px; at 768 px and below the sidebar is an off-canvas panel opened from the top bar's menu button (`aria-expanded`, `aria-controls="app-sidebar"`), the rest of the window is `inert` while it is open, and Escape, the scrim or choosing a view closes it. The Sessions workspace stacks at 920 px. In the Windows desktop window only (ADR 0036) the top bar is also the title bar: `TopBar` takes a `windowControls` slot and becomes a drag region (`data-tauri-drag-region` on the bar, its spacer and the sidebar's brand row, never on a button), `WindowControls` sits flush at the right edge (46 px wide, the bar's full height, close in the danger role on hover), and the banner moves under the bar. Browser, macOS and Linux render none of this. `Breadcrumbs` and `crumbTrail` exist for nested pages; `Page` renders them through its `breadcrumbs` prop, which Projects uses for its `Projects / {name}` trail.
- **Home** (`Home.tsx`, built on `@luuna/ui`; no screen sheet): opens with four static metric cards on a muted tray (Projects, Waiting on you, Tickets, Active workflows; `Home summary counts`), then "Waiting on you" (h3, the blockers as record rows), then "Projects" (h3): one record row per project (name, manifest chip, id, counts), its repositories each with the latest baseline's badge (`baselineTone`) or `no baseline`, `testing setup needed` where the runtime offers the prerequisite, and the row actions always visible; every control opens the Projects panel. `data-surface="home"`.
- **Board** (`Board.tsx`, built on `@luuna/ui`; no screen sheet): the eight columns of docs/09-experience.md as a wrapping grid of raised column cards (h3 with a neutral count badge, the column's scope), each a list of selectable cards whose badge is the run state through `runTone` (`testing setup` for an offer, an untoned `no plan` chip for the backlog); card hover is a background change. The note says dragging is not implemented. Columns are styled by position, never by a state name. `data-surface="board"`.
- **Help** (`Help.tsx`, `screens/help.css`): a single docs column at the `--measure` width: plain sections (onboarding with neutral numbered badges, the six tones with their run and candidate values, where evidence lives, shortcuts as an action on the left and its `Kbd` on the right, documents as link rows with the path muted). `data-surface="help"`.
- **Projects** (`Projects.tsx`, `screens/projects.css`): a rail with the project cards, then the "Add a project" disclosure (the register form; open while no project exists), "Import from another machine" and "Create from a stack profile", and a detail card: the project header (h3 name, manifest chip, id), facts (the first `.facts` on the page), the "Rebind repository" disclosure, the action row (a running baseline adds its `.danger` cancel), baselines (each with its reason and next step and a log button per recipe stream, then the opened log), discovery (questions callout, problems, recipes, the manifest form), the Workflows subpanel, then the project event record.
- **Workflows** (`Workflows.tsx`, `screens/workflows.css`): the testing-setup offers (headed records in the attention tone, the reason ruled and the runtime's next step under it, a `Create the testing-setup ticket` control), the ticket form (each field followed by its UTF-8 byte count), the run settings (paths, writes, approver, plan budgets, provider and model, automatic repair), then ticket cards. A ticket card holds its head, intent, actions with the run badge (the first writer's `.danger` cancel sits before the badge; a held-back "Plan r{n+1}" names its reason on its own line), the confirmation checkbox when the next revision would leave a pending, approved or reviewed revision behind, the writer's activity callout, the plan review with the complete plan in a bounded region, plan meta, earlier revisions with their badges, the reason and next step, worktree lines and the candidate.
- **Candidate review** (`CandidateReview.tsx`, `screens/candidate-review.css`): heading with badge, full identities, the action row, the publication record, a setup workflow's handoff callout (attention: the proposed checks and the runtime's next step), the editor handoff (`data-surface="editor-handoff"`: each worktree path whole in `code` with a `Copy path` text button), the runtime's activity callout, reason and next step, the diff, check evidence with logs, the independent review with findings, and usage.

- **Screen details (item L4).** Settings: the doctor report as h4 groups (Required tools, Runtime, Credentials, Optional tools; `doctorGroups` in `Settings.tsx`, runtime order kept, an unknown item lands under Optional tools) of `SettingsRow`s, then the verdict as a toned `Callout` with its exact text; no drawn check. Projects: the rail is compact record rows, the detail is a hairline-bordered card (no popover shadow, no sticky header), and a `Projects / {name}` `Breadcrumbs` trail renders through `Page`'s `breadcrumbs` prop. Workflows and Candidate review: ticket rows hover by background only; the advisory result sits on the muted ground and the independent-review verdict is a bordered card, with no coloured left rule. Sessions: the history rail hovers by background only, the live output card stays static, and `StreamingDots` shows while the active run is not terminal. Project components: the not-enabled block is a quiet empty-state card. `design/screens-ledger.test.ts` (in `packages/ui`) guards the screen sheets against gradients, uppercase, coloured left rules, hover lifts, sticky headers and off-token max widths.
- **Static depth on evidence.** Evidence, approval, baseline, candidate and verdict blocks (and `.facts`, `.state`, `.callout`, notes, records, `ol.events`, `pre`) get static depth only (a resting shadow, border or radius): no transition, animation, opacity or transform. `design/screens-motion.test.ts` guards this per screen sheet with fixtures that prove a hover lift, a transition and a fade on those selectors fail.

### Following live output

Presentation only; the runtime still decides every state.

- `glide.ts` (spring math, token parsing), `stickyScroll.ts` (controller on an injected surface) and `useStickyScroll.ts` (thin wiring). Views use `LiveOutput` and `ScrollList follow`.
- While the reader is within `--follow-threshold` of the bottom, new content glides there over about `--duration-follow` using a critically damped spring (velocity stays continuous when the target moves). Each frame reads, then writes `scrollTop` once, rounded to a device pixel. The first content after mount, reset or re-enable jumps instantly.
- Release is by user intent (wheel up, pointer or scrollbar, touch, navigation keys), not by a falling `scrollTop`, because scroll anchoring and our own writes also move it. Returning near the bottom re-pins. An earlier event page does not follow.
- The tail caret is `pre[data-live]::after`: steady (evidence never pulses), CSS only, so it is never selected, copied or announced. It uses the active tone and is removed when the run is terminal.
- Monospace disables ligatures and kerning and uses `text-rendering: optimizeSpeed`; the Pi response prose keeps `optimizeLegibility`. Live output and its ancestors never get `transform`, `will-change`, `opacity` or `filter`, which would drop LCD antialiasing; elsewhere a transform on a text ancestor is transient (an overlay entrance) and nothing is left transformed at rest. `overflow-anchor` stays `auto`. No canvas or WebGL text.

### Motion

ADR 0033 supersedes ADR 0032's decorative motion: only functional motion remains. Overlay, menu and toast entrances, the skeleton pulse, the indeterminate progress bar and the streaming dots animate (`styles/motion.css`); state changes are colour transitions of `--duration-micro`. There is no hover lift, press scale, reveal, count-up, tab indicator slide, drawn check, glow or aurora. Only `transform` and `opacity` animate and entrances fill `backwards`, so nothing is left transformed at rest. Evidence, the tail caret and approvals never pulse, fade out or auto-dismiss. Optional features (view transitions, `@starting-style`) are gated by `@supports` with a complete static fallback. No `will-change`.

- **Buttons.** Hover is a background change; there is no lift or scale. The `--lift-y` token is gone and no screen sheet may reintroduce a lift (`design/screens-ledger.test.ts` (in `packages/ui`)).
- **Measuring.** `menus.tsx` sizes a menu with `offsetWidth` and `offsetHeight`, not `getBoundingClientRect`, because the entrance scales it. Marker: `data-entering` (a view that just became current).
- **Shell.** No sliding pill, pulse or wash. A view change uses View Transitions where `document.startViewTransition` exists; otherwise a CSS opacity fade plays from `data-entering` (`data-view-motion="css"`); the off-canvas panel slides in with transform. Under reduced motion every one of these is instant.

### Fonts

Mantine's system stack for text and Outfit for headings (ADR 0035, replacing ADR 0033's system stack and Söhne amendments). `--font-sans` is Mantine's body stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica`, `Arial`, `sans-serif`, the two emoji fonts), `--font-mono` is Mantine's monospace stack (`ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, `Liberation Mono`, `Courier New`), and `--font-display` is `"Outfit"` followed by the Mantine stack. `h1` to `h4`, the page header's `h2` and every title role use `--font-display` at weight 600; body text, labels and controls use `--font-sans`. This is the split mantine.dev uses. To set the body in Outfit too, change one token: `--font-sans: var(--font-display);` in `tokens-scale.css`.

`styles/fonts.css` declares one family, "Outfit": two variable woff2 files (`assets/fonts/outfit/Outfit-latin.woff2`, `Outfit-latin-ext.woff2`; `font-weight: 100 900`; `font-display: swap`; Mantine's `unicode-range` for each), licensed under the SIL OFL 1.1 (`OFL.txt` beside them, `THIRD-PARTY-NOTICES.md`). Vite never inlines `.ttf` or `.woff2`, nothing is fetched remotely, and the CSP keeps `font-src 'self'`. The body is 16 px with line height 1.55, antialiased. The Söhne TTFs and `platform.ts` (`data-platform`) were removed at the owner's direction on 2026-10-22; the TTFs remain only in Git history; `data-type` is gone too. Real rendering of Outfit in the WebView has not been verified here.

## Accessibility

- Every visible text run meets 4.5:1 (3:1 for large text) against its painted background in both schemes; marks, control edges and focus meet 3:1. Disabled controls are exempt and are marked with the `disabled` attribute.
- The first Tab stop is "Skip to main content", which focuses `main#main`. Focus is always visible.
- Every field has a label; every control has a name; scroll regions are focusable; heading levels never skip; every alert has a Dismiss button; `html[lang=en]`.
- No horizontal page scroll at the Tauri window's 760 px minimum width. Containers that can hold code use `min-width: 0` and `minmax(0, 1fr)`.
- Reduced motion makes every transition instant and the follow glide a jump; there is no drift, shimmer or stagger. Forced colours keep marks and selection visible.

## Enforcement

`npm test` runs `packages/ui/src/design/design-system.test.ts`. It reads stylesheets with `node:fs`, because Vitest replaces `*.css?raw` imports with an empty string, and it fails on an empty sheet so no check can pass vacuously. It asserts:

- Outside the token sheets: no colour literal or function, no raw length or duration, font sizes only from `--text-*`, `opacity` only inside `@keyframes` or as 0/1 on a decorative pseudo-element, durations and easings only from tokens (no `transition: all`), keyframes limited to `transform`, `translate`, `scale`, `rotate`, `opacity`, `background-position`, `clip-path` and `stroke-dashoffset`, no resting `forwards`/`both` fill, filters only from tokens, no `will-change`, no `!important`, approved media queries only, `outline: none` only on `main:focus`, scrolling only on labelled scroll regions, no truncation of `code`/`pre`, tone mapping only in `components.css`, no selector named after a runtime state, tone variables read only by a rule whose selector carries `[data-tone]`, and screen selectors scoped by a unique class with at most three child steps.
- The token sheets hold only the theme selectors (`:root`, `:root[data-theme="light"]`, `:root[data-theme="dark"]` and, inside `prefers-color-scheme: dark`, `:root:not([data-theme="light"])`) with custom properties, every `--duration-*` is zeroed under reduced motion (derived from the sheets), light and dark define the same names, and the dark attribute and dark media blocks are identical.
- Every colour role, palette shade, font stack, type size, line height, weight, heading, radius, spacing, breakpoint and shadow equals the Mantine truth table `design/mantine-values.ts`, each contrast deviation is listed there and recomputed (the Mantine value fails the gate, the value used passes, at the recorded ratios); the fonts test requires both Outfit woff2 files (magic `wOF2`), `OFL.txt`, the unicode ranges, `font-display: swap`, no remote or `data:` font and no Söhne reference in any stylesheet; dark card and button shadows are `none`; the legacy sheet holds only aliases and its colour and tone map is pinned; no stylesheet holds a gradient; coloured left rules are limited to a pending list that item L2 empties.
- Every `var()` resolves; both themes define the same colour roles; every text, edge and status pair, and every resolved tone, meets its WCAG ratio in both themes.
- Every component file is registered, and each screen keeps its heading levels, has no inline styles or positive `tabIndex`, renders badges through `StatusBadge`, and every alert carries Dismiss.
- The tone taxonomy: exactly the five evidence states are success; interruption is never danger; the badge renders the runtime text unchanged.

`node scripts/mvp-ui-smoke.mjs` checks the rendered result: contrast of every visible text run against its composited background in both schemes, that the client follows the system scheme, no horizontal scroll at 760 px, plus the existing keyboard, accessibility, DOM and lifecycle checks.

## Changing the system

A new colour is a token in both schemes, a row in `ROLES` in `design/mantine-values.ts` (with a deviation row if Mantine's value fails the gate and an ADR 0035 note), plus a contrast pair in the test. A new duration is a token and is also zeroed in the reduced-motion block. A new runtime state is a tone in `tone/tone.ts`. A new component goes in `components.css` and this table. Do not style by runtime state name, add a heading level, or move the DOM elements the smoke reads (listed in `scripts/mvp-ui-smoke.mjs`). Run `npm test`, `npm run typecheck`, `npm run build` (Node 24.19.0) and the desktop smoke, and report each result.
