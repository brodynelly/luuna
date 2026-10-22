# Feature: Desktop shared UI primitives restyle and motion library

## Metadata

- Type: feature
- Source: orchestrator request; Stripe-inspired desktop restyle (inspiration only, no Stripe name, logo or assets in the app)
- Date: 2026-10-22
- Orchestration: run `stripe-ui-20261022-0905`, wave 2, item B (branch `orchestrate/stripe-ui-20261022`)
- Depends on: F1 `specs/feature-desktop-soehne-fonts.md` (fonts, `data-platform`) and F2 `specs/feature-desktop-stripe-foundation.md` (ADR 0032, new tokens, lint revisions). Neither spec file existed when this plan was written. Tokens below are named **by role**; the builder must read the merged F2 token sheets and lint first and use F2's actual names.
- Parallel sibling: item C (`specs/feature-desktop-stripe-shell.md`: `shell/`, `ui/shell.tsx`, `screens/app.css`, `App.tsx`). Consumer: item D (screens). Visual QA: item Q.
- Run notes: `.tac/runs/stripe-ui-20261022-0905/{work-items,scout-design,style-spec}.md`

## Feature Description

Restyle the desktop's shared component library so every screen inherits a calm, precise, Stripe-like look. That means a blurple primary, hairline borders with layered navy-tinted shadows, 40-44 px list rows, tinted tone chips and short purposeful motion. The plan also adds a small, accessible motion library (`Reveal`, `CountUp`, `CheckDraw`, `GlowSurface`, `Aurora`) plus a few missing primitives (`Tabs`, `Switch`, `Table`, `ProgressBar`, `StreamingDots`) that item D needs. Views may not write raw elements, so the library has to provide them. This is presentation only: nothing decides runtime state, and every existing role, marker and exported API keeps working.

## User Story

As the Luuna developer, I want the desktop's controls, cards, lists, overlays and feedback states to look and move like a polished product, so the app feels fast and trustworthy without changing what it shows or how it behaves.

## Solution Statement

- CSS restyle happens in the components layer, which already wins over `base.css` regardless of specificity. `components.css` keeps the tone indirection and every `[data-tone]` rule, because the lint allows tone mapping only there. New rules go into new sheets in the components layer, because `components.css` (208 lines) cannot absorb them under the 300-line cap. Proposed new sheets: `design/controls.css` (buttons, fields, switch, tabs, table) and `design/motion.css` (keyframes and the motion primitives).
- Motion is CSS-first (keyframes and transitions on `transform`, `opacity` and `background-position` only). Behaviour lives in DOM-free controllers that take an injected frame scheduler, clock and element, following the existing `ui/stickyScroll.ts` + `ui/useStickyScroll.ts` pattern. That keeps them unit-testable in the node vitest environment (no jsdom is installed). Hooks write custom properties or text node values through refs. There is no per-frame React state and no `style={{` (that is banned by `components.test.ts`). Custom properties are written with `element.style.setProperty`, as `ui/menus.tsx` does today.
- Static markup is final markup. `renderToStaticMarkup` of every new component shows the final value or state. Animation is applied only after mount, so existing exact-markup tests stay green and so do new ones.
- Reduced motion has two paths. CSS: one `@media (prefers-reduced-motion: reduce)` block in `motion.css` sets `animation: none` on every looping or entrance animation. JS: duration tokens read through `getComputedStyle` are zero under reduced motion (F2 adds each new duration to the reduced-motion block). `GlowSurface` also checks `matchMedia`.

## Out of Scope

- `ui/shell.tsx`, `shell/*`, `screens/*.css`, `App.tsx`, the sliding nav pill and view transitions (item C). Applying primitives to screens, empty-state washes on views, count-ups on KPIs and success checkmarks in flows (item D).
- Token values, the type scale, fonts, ADR 0032 and `docs/` edits (F1/F2). If ADR 0032 or `docs/DESIGN-SYSTEM.md` does not cover something this item introduces (live pulse on active chips, hover-lift transform on buttons, new components), list the gap in the final report. Do not edit `docs/`.
- Runtime, schemas, TUI, api-client, the mono font, any change to tone mapping (`design/tone.ts` maps stay byte-identical), and notice timing (notices stay untimed: "never timed" in `ui/selection.tsx`).
- Exit animations that need `display`/`overlay` discrete transitions are optional (see Notes). Entrance animations are required.
- Judging perceived motion quality. That needs a visual QA pass in a real WebView (item Q). Unit tests prove structure, timing math and fallbacks only.

## Relevant Files

Read first (do not edit): `AGENTS.md`, `docs/CURRENT-ARCHITECTURE.md`, `docs/DESIGN-SYSTEM.md` (lines 74, 102, 135-150: scales, button table, "evidence never pulses", "text ancestors never get transform/will-change/opacity", lint summary), `docs/decisions/0030-desktop-shell-and-tailwind.md`, the merged ADR 0032 and F2's token sheets, `.tac/runs/stripe-ui-20261022-0905/style-spec.md` (target values).

Guards that constrain this work (read; edit only as stated in Task 2):

- `apps/desktop/src/design/design-system.test.ts`: token-only lint (no hex/rgb/px/ms literals, `font-size: var(--text-*)`, opacity rule as revised by F2, approved `@media` list at line 21, `[data-tone]` only in `components.css`, no selector naming a runtime state (for example `.active`, `.running`, `.paused`, `="pending"`), scroll only on `ol.events`/`pre[aria-label]`/`[role="listbox"]`, every `var()` resolves), `EXPECTED_SHEETS` (line 20) plus the manifest layer mapping (line 41), and the exact `StatusBadge` markup test (line 180).
- `apps/desktop/src/design/components.test.ts`: 300-line cap on every `.ts/.tsx/.css`, the RAW element regex for views, no `style={{`, no positive tabIndex, `.state` only through `StatusBadge`, every `role="alert"` has a Dismiss button, headings only from `ui/`.
- `apps/desktop/src/ui/overlays.test.tsx` and `apps/desktop/src/ui/presentation.test.tsx`: exact markup for `<dialog class="palette" aria-label="Command palette"`, `<div class="context-area"><span>card</span></div>`, `LiveOutput`, `ScrollList` and the `pre[data-live]::after` caret rule. These must pass unchanged.
- `scripts/mvp-ui-smoke.mjs`, `scripts/m6-ui-smoke.mjs`, `scripts/performance-ui-smoke.mjs`: DOM contract (`[role=dialog]`, `[role=listbox]`, `[role=menu]`, `[role=alert]`, `data-capability`, `.state`, `.facts`, `ul[aria-label]`, `data-surface`, `details.add-project`, contrast in both schemes, no horizontal scroll at 760 px).

Owned by this item (edit):

- `apps/desktop/src/design/components.css`: tone indirection (unchanged), restyled `.state` chips plus the active live pulse, `.callout`, `.error`, `.panel`/`.card`/`.tray` elevation, `.record`/`.record-list` row variant, `button.run-card`, `ol.events` rows, skeleton shimmer, `.notice` entrance, forced-colors additions. Move non-tone rules out to new sheets as needed to stay at or under 300 lines.
- `apps/desktop/src/design/overlays.css`: `.context-menu` and `dialog.palette` restyle (popover/dialog radii and shadows, scrim token), entrance keyframes usage, option rows.
- `apps/desktop/src/design/controls.css` (new): buttons (primary, secondary, quiet, danger, text), fields, select, textarea, checkbox, switch, focus halo, tabs and indicator, table.
- `apps/desktop/src/design/motion.css` (new): all `@keyframes`, `.reveal`, `.count-up`, `.check-draw`, `.glow-surface`, `.aurora`, `.progress-bar`, `.streaming-dots`, and the reduced-motion and forced-colors blocks for them.
- `apps/desktop/src/design/StatusBadge.tsx`: markup unchanged (exact-markup test). Only the doc comment may change, to mention the CSS-only pulse.
- `apps/desktop/src/design/Icon.tsx`: additive `className?` prop. Optionally add a `check` path. Keep `aria-hidden`/`focusable="false"`.
- `apps/desktop/src/ui/controls.tsx`: `ButtonVariant` gains `"quiet"`; new `Switch`.
- `apps/desktop/src/ui/content.tsx`: additive `RecordList` props `variant`, `reveal`; additive `EmptyState` prop `wash`. Keep it at or under 300 lines. Move `Loading`/`Placeholder` into `ui/feedback.tsx` if needed (re-exported, same names).
- `apps/desktop/src/ui/menus.tsx`: measure the menu with `offsetWidth`/`offsetHeight` instead of `getBoundingClientRect()` width/height (lines 53-55), because `getBoundingClientRect` includes the scale-in transform and would mis-clamp. Markup unchanged.
- `apps/desktop/src/ui/palette.tsx`: markup unchanged. CSS-only animation.
- `apps/desktop/src/ui/selection.tsx`: markup unchanged (`.notice` keyed by id already remounts, so the entrance replays per notice). No timer.
- `apps/desktop/src/ui/index.ts`: export the new modules.
- `apps/desktop/src/ui/motion-math.ts` (new): pure helpers `clamp`, `lerp`, `cubicBezier(x1,y1,x2,y2) => (t) => number`, `EASE_OUT` (mirrors the F2 out-curve token, `cubic-bezier(.16,1,.3,1)` per style spec), `staggerIndex(i, cap = 10)`, `tweenValue(from, to, elapsedMs, durationMs, ease)`, `indicatorGeometry(list, tab) => { x, y, scale }`, `prefersReducedMotion(match?)` (safe when `window`/`matchMedia` is undefined).
- `apps/desktop/src/ui/motionControllers.ts` (new): DOM-free `createCountUp`, `createGlowTracker`, `createRevealController` with injected `requestFrame`/`cancelFrame`/`now`. Reuse `parseCssTime` from `ui/glide.ts`.
- `apps/desktop/src/ui/motion.tsx` (new): `Reveal`, `useReveal`, `CountUp`, `CheckDraw`.
- `apps/desktop/src/ui/surfaces.tsx` (new): `GlowSurface`, `Aurora`.
- `apps/desktop/src/ui/tabs.tsx` (new): `Tabs`, `TabPanel`.
- `apps/desktop/src/ui/table.tsx` (new): `Table`.
- `apps/desktop/src/ui/feedback.tsx` (new): `ProgressBar`, `StreamingDots` (and `Loading`/`Placeholder` if moved).
- Tests (new): `apps/desktop/src/ui/motion-math.test.ts`, `apps/desktop/src/ui/motionControllers.test.ts`, `apps/desktop/src/ui/primitives.test.tsx`, `apps/desktop/src/design/motion-css.test.ts`.

Narrow exceptions (F2-owned files; minimal, append-only, reported):

- `apps/desktop/src/styles.css` plus `EXPECTED_SHEETS` and the layer-mapping expression in `design-system.test.ts` line 41, only if F2 did not pre-register `design/controls.css`/`design/motion.css`. Both new sheets go in layer `components`, after `overlays.css`. The mapping expression must map them to `components`; today it would produce a nonexistent `controls`/`motion` layer.
- An F2 token sheet, only for component-dimension tokens that F2 lacks (for example lift distance, toast slide, reveal offset, tab indicator height, glow radius, aurora blur, row height). Append them in a block commented `/* item B */` at the end. Add any new duration to the reduced-motion block. List every added token in the report.

## Implementation Plan

### Foundation

1. Confirm F1 and F2 are merged on the branch (`git log --oneline -15`, and check that `specs/feature-desktop-stripe-foundation.md` and ADR 0032 exist). Read the merged token sheets and the revised lint. If F2 is not merged, stop and report; do not invent tokens.
2. Build a role-to-name map from F2's tokens. Every value below must come from a token:

   | Role | Used for |
   | --- | --- |
   | accent / accent-hover / accent-active / accent-tint, on-accent | primary button, selected rows, tab indicator, focus halo |
   | text, text-muted, text-subtle, text-disabled; surface, surface-raised, surface-sunken, field, border (hairline), border-strong / border-control | everything |
   | tone fg/bg/border/mark (via existing `--tone-*` indirection) | chips, callouts, notes |
   | radius chip/input (4), button (6), card/menu (8), dialog (12), pill | shapes |
   | shadow card, popover, dialog, button-hover, button-inset highlight, focus halo | elevation |
   | easing standard, out, in, spring (small elements only) | transitions |
   | duration press (80 ms), micro (120-160), standard (200-250), large (300-400), count (600-900), check-draw (400), shimmer (1.4 s), ambient (20 s or more), stagger-step (30-40 ms) | motion |
   | gradient aurora, glow colour, scrim | decorative layers |
   | type scale `--text-*`, weights, label tracking, `tabular-nums` | text |
   | control heights (32 primary), row height (40-44) | sizing |

### Core

CSS restyle (controls.css, components.css, overlays.css):

- Buttons. The base `button` is secondary: surface fill, strong hairline, button radius, card-like shadow.
  - `.primary`: accent fill, `box-shadow: inset highlight, resting shadow`.
  - `.quiet` (new): no border, transparent, hover fill subtle.
  - `.danger`: keeps the small size; tinted danger fill and danger fg.
  - `.text-button`: unchanged semantics.
  - Hover (`:hover:not(:disabled)`) lifts by the lift token and adds the layered button-hover shadow. `:active:not(:disabled)` uses `scale(0.98)` over the press duration (80 ms). Transition only `transform`, `box-shadow`, `background-color`, `border-color` and `color`, with no resting transform and no `will-change`.
  - Disabled: no lift, no shadow, disabled colours (never opacity).
  - Focus: keep `:focus-visible` outline from `base.css` (forced colours and contrast tests rely on `--color-focus`). Add the halo `box-shadow` composed with the button's own shadow.
- Fields. `input`, `textarea` and `select` get input radius, hairline border, a subtle inset, and hover border strong. `:focus-visible` gets an accent border plus halo. Disabled uses the existing disabled tokens. Keep `select` native (no `appearance: none`) unless the caret can be drawn token-only. Checkbox keeps `accent-color` with input radius and halo on focus.
  - Switch (new): `input[type=checkbox][role=switch]` with `appearance: none`, pill track. The thumb is `::before` moved by `transform: translateX(token)` with the spring easing. Checked state uses the accent fill. Disabled and forced-colors states are handled.
- Cards and panels. `.panel`, `.card` and `.tray` get the card radius, hairline, and the layered card shadow. In dark mode, use F2's dark depth tokens (lighter surface plus inset highlight); do not hand-mix colours. Spacing and grid are unchanged.
- Lists and tables.
  - `RecordList variant="rows"` (`.record-list.record-rows`): no per-item border or radius, hairline dividers, `min-height` row token, hover row highlight (`background-color` transition), `tabular-nums`.
  - `ol.events > li` gets the same row rhythm and hover.
  - `button.run-card` gets the 6 px radius and selected state = accent tint plus accent text rule (keep `aria-pressed`).
  - `.table` (new): `width: 100%`, `table-layout: fixed`, `overflow-wrap: anywhere` (no horizontal scroll at 760 px). Hairline row dividers, row height token, uppercase label-style headers, `th[data-numeric], td[data-numeric]` right-aligned with `tabular-nums`, `tbody tr:hover` highlight, no zebra.
- Tabs (new). `.tabs[role=tablist]` is `position: relative` with a hairline bottom. Each `[role=tab]` is a quiet button with selected text in accent. One `.tab-indicator` is absolutely positioned at the bottom with `inline-size: 100%`, `transform-origin: left`, `transform: translate(var(--tab-x), var(--tab-y)) scaleX(var(--tab-scale))`, accent fill, height token, transitioning `transform` over the standard duration with the standard easing.
  - No-JS/SSR fallback: `.tabs:not([data-measured]) .tab-indicator { visibility: hidden }`, and `.tabs:not([data-measured]) [role=tab][aria-selected="true"]` draws an inset bottom box-shadow in accent.
  - The first measurement sets `data-measured` after writing the position, so the indicator does not slide in from 0.
- StatusBadge and tone chips. `.state[data-tone]` gets chip radius, tinted bg plus same-hue fg (existing tone vars), label weight and tabular-nums. Keep every shape mark (shape plus text carries the tone; colour is not the only cue).
  - Live pulse: `.state[data-tone="active"]` becomes `position: relative`, and `.state[data-tone="active"]::after` is a ring the size of the mark, aligned over it, in `--tone-mark`, animating `transform: scale(1→2.2)` and `opacity` (fading) on an infinite loop of about 1.6-2 s (token).
  - The pulse is suppressed under reduced motion and forced colours.
  - It must live in `components.css` (tone rule). `pre[data-live]::after` stays steady, because evidence never pulses.
- Callout and alert. `.callout`, `.error` and `.failure-note` get the card radius, tinted bg, a leading rule in the mark colour (unchanged structure) and the type scale. `.error` keeps its Dismiss button.
- Menus and palette.
  - `.context-menu`: menu radius, popover shadow, hairline. Entrance `menu-in` (opacity 0 with `scale(0.96)` to rest) over the micro/standard duration with the out easing, `transform-origin: top left`.
  - `dialog.palette[open]`: dialog radius and dialog shadow, entrance `dialog-in` (opacity 0 with `scale(0.96)` to rest, about 200 ms, out curve, `transform-origin: top center`).
  - `dialog.palette[open]::backdrop`: scrim token with a `scrim-in` opacity fade.
  - Use `animation-fill-mode: backwards` (or none) so no transform remains after the animation ends.
  - Palette option rows get the menu radius, selected row = accent tint, and `kbd` chips restyled.
- Toasts. `.notice` gets an entrance `toast-in` (translateY of the slide token, about 12 px, plus opacity) over about 250 ms with the out curve, and popover shadow and radius. Timing is unchanged (untimed).
- Skeleton. `.skeleton-row` uses `background: linear-gradient(...)` from surface tokens, sized at about 200%, animating `background-position` linearly over the shimmer duration, infinite. Reduced motion shows a static fill. Update the "No motion" comment.
- Progress and streaming.
  - `.progress-bar` is a thin track (2 px token, `overflow: hidden`, which is allowed because it is not scroll). Its `::before` is an accent segment animating `transform: translateX(-100% → 200%)` infinitely. Reduced motion shows a static tinted track.
  - `.streaming-dots > span` are three dots animating `opacity`/`transform: scale`, staggered by the stagger-step token. Reduced motion shows static dots.
- Motion primitives CSS (`motion.css`):
  - `.reveal > *`: `animation: reveal-in var(--duration-large-ish) var(--ease-out) backwards`, `animation-delay: calc(var(--i, 0) * stagger-step)`, from `opacity: 0; transform: translateY(reveal-offset)`. `.reveal[data-revealed] > * { animation: none }` so later-appended children do not animate.
  - `.count-up { font-variant-numeric: tabular-nums }`.
  - `.check-draw` path and circle: `stroke-dasharray: 1; stroke-dashoffset: 1 → 0` via `pathLength="1"`. The circle draws first, then the check with a delay. Stroke is the success mark or `currentColor`.
  - `.glow-surface`: `position: relative; isolation: isolate`. `::before` is `inset: 0`, `z-index: -1`, `border-radius: inherit`, `pointer-events: none`, `radial-gradient(glow-radius circle at var(--mx, 50%) var(--my, 50%), glow colour, transparent)`, fully transparent at rest and visible on `:hover`, transitioning opacity. Gate with F2's hover/pointer media (`(hover: hover) and (pointer: fine)`) if F2 approved it. Otherwise rely on the JS gate only.
  - `.aurora`: `position: absolute; inset: -20%; z-index: -1`, the token aurora gradient (3-4 radial gradients over a pale base), `filter: blur(token)`, `pointer-events: none`, animating a drift via `transform` (translate/rotate/scale, `alternate`, ambient duration of 20 s or more). `.aurora-host` (applied by `EmptyState wash`) is `position: relative; isolation: isolate; overflow: hidden`.
  - Reduced motion: `animation: none` for `.reveal > *`, `.check-draw *` (drawn statically), `.aurora`, `.skeleton-row`, `.progress-bar::before`, `.streaming-dots > span`, `.notice`, `.context-menu`, `dialog.palette[open]` and its backdrop. `.glow-surface::before` uses `display: none`.

React components and hooks (all in `ui/`, each file at or under 300 lines, with JSDoc in the existing voice):

- `Reveal({ className?, label?, children })` renders `<div className="reveal …" role={label ? "group" : undefined} aria-label={label}>`. `useReveal<T>()` returns a ref callback that runs `createRevealController`. In a layout effect it sets `--i = staggerIndex(i)` on each element child via `style.setProperty`. After `count × stagger + duration` (tokens read with `parseCssTime`), or the last `animationend`, it sets `data-revealed`. It plays once per mount and causes no React state changes. `RecordList` uses `useReveal` only when `reveal` is true.
- `CountUp({ value, format?, className? })` renders `<span className="count-up …">{format(value)}</span>`, so static markup shows the final value. On mount, `createCountUp` tweens from 0 to `value` over the count-duration token using `EASE_OUT`. It writes `format(rounded)` into the span's **existing text node** (`firstChild.nodeValue`), never `textContent`, so React's text node stays the same node. It always ends on exactly `format(value)` and runs once per mount. A later `value` change cancels any tween and React's own render shows the new value instantly. Duration 0 (reduced motion) writes the final value immediately. There is no `aria-live`. Integer values stay integers; for non-integers, round to the target's decimal places.
- `CheckDraw({ label?, size?: "sm" | "md" | "lg" })` renders an `<svg className="check-draw" viewBox="0 0 24 24">` with a `circle` and a `path`, both `pathLength="1"`. With `label` it gets `role="img" aria-label`; otherwise `aria-hidden="true" focusable="false"`.
- `GlowSurface({ className?, label?, children })` renders `<div className="card glow-surface …">` (the same props as `Card`, a drop-in for hero/feature cards). A ref callback attaches `createGlowTracker` only if `matchMedia("(pointer: fine)").matches && !prefersReducedMotion()`. The tracker reads the rect on `pointerenter`/`resize` only, coalesces `pointermove` into one rAF, and writes `--mx`/`--my` (px) with `style.setProperty`. It uses passive listeners and removes them on detach. No re-renders.
- `Aurora({ className?, intensity?: "subtle" | "vivid" })` renders `<div className={"aurora …"} data-intensity={intensity} aria-hidden="true" />`. It is decorative and requires a positioned, isolated parent (`EmptyState wash` provides one). Text never sits directly on a saturated area: the subtle intensity is the default, and F2's gradient tokens are pale or low-alpha.
- `Tabs({ label, tabs: readonly TabItem[], selected, onSelect, idPrefix? })` with `TabItem { id: string; label: ReactNode; disabled?: boolean; "data-capability"?: string }`. It renders `div.tabs[role=tablist][aria-label]` containing `button[role=tab]` (`aria-selected`, `aria-controls={idPrefix-panel-id}`, `id={idPrefix-tab-id}`, roving `tabIndex` 0/-1) and one `span.tab-indicator[aria-hidden]`. Keys: Left/Right wrap, Home/End, automatic activation, disabled tabs skipped. A layout effect plus a `ResizeObserver` (guarded if undefined) computes `indicatorGeometry` relative to the tablist and writes `--tab-x`, `--tab-y` and `--tab-scale` on the indicator, then sets `data-measured`. `TabPanel({ id, idPrefix?, selected, children })` renders `div[role=tabpanel][aria-labelledby]`, hidden when not selected.
- `Switch({ label, className?, ...input })` renders `<label className="switch …"><input type="checkbox" role="switch" {...input} /> {label}</label>`.
- `Table<T>({ label, columns: readonly TableColumn<T>[], rows: readonly T[], rowKey: (row: T) => string, className? })` with `TableColumn<T> { id: string; header: ReactNode; cell: (row: T) => ReactNode; numeric?: boolean }`. It renders `table.table[aria-label]` with `thead th[scope=col]` and `data-numeric` on numeric cells.
- `ProgressBar({ label })` renders `<div className="progress-bar" role="progressbar" aria-label={label} />`. Indeterminate means no `aria-valuenow`.
- `StreamingDots({ label? })` renders `<span className="streaming-dots" aria-hidden={label ? undefined : "true"} role={label ? "img" : undefined} aria-label={label}><span/><span/><span/></span>`.

### Integration

- `ui/index.ts` exports `motion`, `surfaces`, `tabs`, `table` and `feedback`, plus types (`TabItem`, `TableColumn`). No view is edited (item D consumes these).
- Public API changes (all additive; existing call sites compile unchanged):

  | Export | Change |
  | --- | --- |
  | `ButtonVariant` / `Button` | union gains `"quiet"` (class `quiet`) |
  | `RecordList` | new optional `variant?: "cards" \| "rows"` (default `"cards"`, markup unchanged) and `reveal?: boolean` (default false, markup unchanged) |
  | `EmptyState` | new optional `wash?: boolean` (adds class `aurora-host` and an `<Aurora />` first child; default markup unchanged) |
  | `Icon` | new optional `className?: string` (appended after `icon`) |
  | New exports | `Reveal`, `useReveal`, `CountUp`, `CheckDraw`, `GlowSurface`, `Aurora`, `Tabs`, `TabPanel`, `TabItem`, `Switch`, `Table`, `TableColumn`, `ProgressBar`, `StreamingDots`, and the pure helpers from `motion-math` |

  `StatusBadge`, `Callout`, `CommandPalette`, `ContextMenuArea`, `NoticeRegion`, `Loading`, `LiveOutput`, `ScrollList` and `Card`: props and markup unchanged.
- Smoke contract: no change to roles, `aria-label`s, `data-capability`, `.state`, `.facts`, `ul[aria-label]`, `[role=alert]` with Dismiss, `[role=dialog]`/`listbox`/`menu`. The new tables and tabs must not create horizontal overflow at 760 px.

## Step by Step Tasks

1. Prerequisites. Run `git status` and `git log --oneline -15`, and confirm F1/F2 are merged. Read ADR 0032, F2's token sheets and the revised `design-system.test.ts`. Write the role-to-name token map (keep it in your working notes, not a file). Record a baseline by running `cd apps/desktop && npx vitest run src/design src/ui`. Report any pre-existing failures separately.
2. Sheets. If F2 did not register them, create `design/controls.css` and `design/motion.css`. Add both to `styles.css` in layer `components` after `overlays.css`. Add them to `EXPECTED_SHEETS` and map them to `components` in the line-41 expression. Add any missing component-dimension tokens in an append-only `/* item B */` block, including reduced-motion zeroing for new durations. Check: `npx vitest run src/design` passes the manifest and `var()` tests.
3. Pure helpers. Add `ui/motion-math.ts` and `ui/motion-math.test.ts`. Tests cover: `clamp`; `cubicBezier` endpoints (0→0, 1→1), monotonic and overshoot-free for `EASE_OUT`; `staggerIndex` (0..9 identity, 10 and beyond capped at 10, negative to 0); `tweenValue` (0 ms gives the final value, elapsed past the duration gives the final value, midpoint between); `indicatorGeometry` (x/y offsets, scale = tab width / list width, zero-width list gives scale 0); `prefersReducedMotion` returns false without `matchMedia`. Also add a drift guard that reads F2's token sheet with `node:fs` and asserts the out-curve token equals `EASE_OUT`'s control points.
4. Controllers. Add `ui/motionControllers.ts` and `ui/motionControllers.test.ts` using a manual frame queue and clock like `stickyScroll.test.ts`:
   - CountUp writes monotonically increasing values and finishes exactly on `format(value)`. Duration 0 writes once, with the final value and no frame request. `dispose` cancels the pending frame and stops further writes.
   - GlowTracker coalesces N moves into 1 write per frame, reads the rect only on enter/resize, writes `--mx`/`--my` relative to the rect, and removes its listeners on dispose.
   - RevealController sets `--i` capped at 10 on each child, sets `data-revealed` after the total time, and never touches children added afterwards.
5. Components. Add `ui/motion.tsx`, `ui/surfaces.tsx`, `ui/tabs.tsx`, `ui/table.tsx` and `ui/feedback.tsx`. Extend `controls.tsx` (`quiet`, `Switch`), `content.tsx` (`variant`, `reveal`, `wash`) and `Icon.tsx` (`className`). Export them from `ui/index.ts`. Check `npm run typecheck --workspace @luuna/desktop`.
6. Static-markup tests. In `ui/primitives.test.tsx`:
   - `CountUp` value 1234 renders `<span class="count-up">1234</span>`, and a custom `format` is respected.
   - `Reveal` renders `class="reveal"` with no inline style.
   - `CheckDraw` without a label is `aria-hidden`; with a label it is `role="img"` with an `aria-label`.
   - `Aurora` is `aria-hidden`.
   - `GlowSurface` has `class="card glow-surface"` and keeps `role="group"` when labelled.
   - `Tabs` has `role="tablist"` with `aria-label`, exactly one `aria-selected="true"`, roving tabindex, `aria-controls`/`aria-labelledby` pairing, and one `aria-hidden` indicator.
   - `Switch` is `role="switch"`. `Table` has `th scope="col"` and `data-numeric`. `ProgressBar` is `role="progressbar"` with no `aria-valuenow`.
   - `RecordList`, `EmptyState` and `Button` render byte-identical markup when the new props are omitted (compare against literal expected strings).
7. CSS restyle. Implement the Core CSS in `controls.css`, `components.css`, `overlays.css` and `motion.css`, keeping each at or under 300 lines. Keep all `[data-tone]` rules in `components.css`. Use transform/opacity/background-position-only animation (plus `stroke-dashoffset` for CheckDraw, which is paint-only and explicitly requested). Add forced-colors rules for the switch, tab indicator, pulse (none) and selected table row.
8. Fix the `menus.tsx` measurement (`offsetWidth`/`offsetHeight`). Confirm the `overlays.test.tsx` exact markup is unchanged.
9. CSS guard test (`design/motion-css.test.ts`, reading sheets with `node:fs`):
   - Every `@keyframes` body only sets `transform`, `opacity`, `background-position` or `stroke-dashoffset`.
   - No `transition` lists `width`, `height`, `top`, `left`, `margin` or `padding`, and no `transition: all`.
   - Each animated selector in `motion.css`, `components.css` and `overlays.css` appears again inside a `(prefers-reduced-motion: reduce)` block with `animation: none` (or `display: none` for the glow).
   - No `will-change` anywhere.
   - `.state[data-tone="active"]::after` exists and `pre[data-live]::after` has no `animation`.
10. Dialog support check. In WebView2 (Chromium), keyframe entrance on `dialog[open]` and `::backdrop` is supported. Note the Chromium version you verified against: from release notes, or `npm run desktop` if available locally (report if not run). Optional exit animation: only behind `@supports (transition-behavior: allow-discrete)` with `@starting-style`. Closing must stay instant where unsupported, and `showModal`/`close` behaviour must not change.
11. Run every Validation Command. Fix what you introduced, and report baseline failures separately. Run `git status`; only owned files (plus any declared narrow exceptions) may have changed. Do not commit unless the orchestrator's workflow instructs it.
12. Report: the changed public props (the table above, plus anything extra), tokens you had to add, ADR or design-doc gaps for the orchestrator, file line counts, and an explicit statement that perceived motion quality, Windows text sharpness during hover lift, and the contrast of text over the aurora wash are deferred to visual QA (item Q).

## Testing Strategy

- Unit (pure): `motion-math.test.ts` for easing, clamp, stagger, tween, indicator geometry, and the reduced-motion guard without a DOM. Also the token drift guard.
- Unit (controllers): `motionControllers.test.ts` with an injected frame queue and clock and fake elements (`style.setProperty` recorder, fake text node, fake `getBoundingClientRect` counter). Prove no per-move writes beyond one per frame, exact final values, cancellation and cleanup.
- Static markup: `primitives.test.tsx` proves final values in SSR, ARIA roles and default markup unchanged. The existing `overlays.test.tsx`, `presentation.test.tsx` and `design-system.test.ts` (`StatusBadge` exact markup) pass unchanged.
- Stylesheet guards: the existing token lint, contrast pairs in both schemes, the 300-line cap and the RAW rule, plus the new `motion-css.test.ts`.
- Not proven by these tests: real animation smoothness, WebView2/WKWebView rendering, compositor behaviour, Windows LCD text sharpness, and contrast over gradients. Those belong to item Q (Playwright screenshots in both schemes at 1280/760, smoke scripts, reduced-motion emulation).

## Acceptance Criteria

- [ ] Buttons: primary (accent plus inset highlight, 32 px), secondary, quiet and danger, with a 1 px hover lift plus layered shadow, `scale(.98)` press over 80 ms, a disabled state with no lift or shadow, and a visible focus outline plus halo in both schemes.
- [ ] Inputs, selects, textareas, checkboxes and the new switch use the input radius, hairline, accent focus border plus halo, and token-only values. The switch is `role="switch"` and keyboard operable.
- [ ] Panels, cards and trays use the hairline plus layered card shadow. Rows variant and tables use 40-44 px rows, hairline dividers, tabular numerics and hover highlight, with no horizontal overflow at 760 px.
- [ ] Tabs have correct ARIA and keyboard behaviour. One absolutely positioned indicator slides via `transform` only, with a static no-JS fallback and no slide-in from 0 on first paint.
- [ ] Tone chips use a tinted bg with same-hue text and keep their shape marks. Active chips pulse subtly, CSS-only, with no pulse under reduced motion or forced colours. `StatusBadge` markup is byte-identical.
- [ ] Menu and palette scale `.96 → 1` plus fade (about 200 ms, out curve) and the scrim fades. Toasts slide 12 px plus fade and stay untimed. The skeleton shimmers over 1.4 s. The indeterminate progress bar and streaming dots exist. All have reduced-motion fallbacks.
- [ ] `Reveal`, `CountUp`, `CheckDraw`, `GlowSurface` and `Aurora` exist with the behaviour specified: stagger capped at 10, plays once, no per-frame React state, SSR shows final values, `GlowSurface` only on fine pointers, and `Aurora` is `aria-hidden` and paused under reduced motion.
- [ ] Only `transform`, `opacity`, `background-position` (and `stroke-dashoffset` for CheckDraw) animate. There is no `will-change`, no layout-property transitions and no resting transform on text ancestors.
- [ ] All smoke-read roles and markers are preserved. Every existing exported API compiles unchanged, and every public prop change is additive and listed.
- [ ] Every `.ts/.tsx/.css` file is at or under 300 lines. The token lint, contrast (both schemes), RAW rule and all existing tests pass.

## Validation Commands

Grounded in `apps/desktop/package.json`, root `package.json` and the scout notes (no TAC section exists in `AGENTS.md`). Run from the repo root unless stated.

- `cd apps/desktop && npx vitest run src/design src/ui`: lint, contrast, cap, RAW, existing ui tests, and the new `motion-math`, `motionControllers`, `primitives` and `motion-css` tests.
- `cd apps/desktop && npx vitest run src/ui/motion-math.test.ts src/ui/motionControllers.test.ts src/ui/primitives.test.tsx src/design/motion-css.test.ts`: change-specific evidence.
- `npm run typecheck --workspace @luuna/desktop`
- `npm run test --workspace @luuna/desktop`
- `npm run build`
- `git diff --check`
- `git status --short`: only the owned files listed above (plus any declared narrow exceptions) appear.

## Notes

- Perceived motion quality, timing feel, Windows text sharpness during the hover lift or entrance transforms, and text contrast over the aurora wash or glow cannot be established by these checks. They require the visual QA pass (item Q). Say so explicitly in the report; do not claim visual success from unit tests or a build.
- `docs/DESIGN-SYSTEM.md:136` says text ancestors never get `transform`/`will-change`/`opacity`. This plan uses transient transforms only (hover or press, and entrance with `fill-mode: backwards`), never a resting transform or `will-change`. ADR 0032 (F2) should cover this. If it does not, report it as a gap.
- `docs/DESIGN-SYSTEM.md:135` "evidence never pulses" is preserved: the pulse is on the active status chip, never on the live-output caret.
- WebView2 is evergreen Chromium, so keyframes on `dialog[open]` and `::backdrop` work. `@starting-style` and `transition-behavior: allow-discrete` (Chromium 117 or later, Safari 17.4/17.5 or later on macOS WKWebView) are optional extras for exit animation only, behind `@supports`.
- Avoid class or attribute names that equal runtime states (`active`, `running`, `pending`, `paused`, `completed`, `failed` and others); the lint rejects them. Use `aria-selected`, `aria-pressed`, `data-measured`, `data-revealed` and `[data-tone]`.
- Item C runs in parallel and may also append to `styles.css` or token sheets. Keep the exception edits append-only and minimal so the integration merge is trivial.
