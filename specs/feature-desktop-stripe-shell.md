# Feature: Desktop app shell restyle (sidebar nav pill, page header, view transitions)

## Metadata

- Type: feature
- Source: orchestrator request, run notes `.tac/runs/stripe-ui-20261022-0905/{work-items,scout-design,style-spec}.md`
- Date: 2026-10-22
- Orchestration: run `stripe-ui-20261022-0905`, wave 2, item C. Runs in parallel with item B (`specs/feature-desktop-stripe-primitives.md`).
- Depends on: F1 `specs/feature-desktop-soehne-fonts.md` and F2 `specs/feature-desktop-stripe-foundation.md`. Neither spec existed when this plan was written, so tokens below are named **by role**. Before step 1, the builder MUST read the merged token sheets (`apps/desktop/src/design/tokens*.css`), the revised lint (`apps/desktop/src/design/design-system.test.ts`), ADR 0032 and `docs/DESIGN-SYSTEM.md`, and map each role to its real token name.
- Branch: `orchestrate/stripe-ui-20261022` (desktop only; the TUI is untouched)

## Feature Description

Restyle the desktop window chrome with a Stripe-inspired look. Stripe is inspiration only: no Stripe name, logo or assets. The chrome is:

- A roughly 240px sidebar with uppercase section labels and 32-36px nav items with icons. The active item has a pale accent tint and accent text. One absolutely positioned **sliding nav pill** marks the current view, and a connection/runtime status footer has a live pulse.
- A consistent **page header**: title, description and actions, with a one-time entrance reveal. Home alone gets a decorative aurora wash behind its header.
- **View transitions** that work with the existing "every view stays mounted, `hidden` toggles" model. They use the View Transitions API where it is supported, a CSS-only enter animation everywhere else, and nothing at all under reduced motion.
- A restyled palette trigger and connection chip.

Domain behaviour is unchanged: views, hash sync, shortcuts, native menu commands, gating and focus all behave exactly as today.

## User Story

As the Luuna developer, I want the desktop window to feel like a polished, calm product: a clear sidebar whose selection glides between views, pages that open the same way every time, and smooth view changes. It must never get in the way of clicking, typing or reading the live output.

## Problem Statement

The shell (ADR 0030) is functional but flat. The current view shows only as a static fill. Views appear with no continuity because `display: none` blocks any exit or enter motion. The connection status sits squeezed under the wordmark. Pages have no shared header treatment beyond the `Page` template defaults.

## Solution Statement

- **Nav pill.** One decorative `<span class="nav-pill">` sits inside `nav.sidebar-nav`. The hook `useNavPill` in `ui/shell.tsx` measures the `[aria-current="page"]` button relative to the nav. It runs once per change of current view or collapse state (`useLayoutEffect`), plus a `ResizeObserver` callback on the nav. It writes `--pill-y` and `--pill-h` with `style.setProperty` and sets `data-pill="ready"` on the nav. There is no React state and no per-frame work. CSS animates only `transform: translateY(var(--pill-y))` (standard ~220ms, out curve). Without `data-pill` (unmeasured), under reduced motion and in forced colours, the active button keeps its static tinted background.
- **View change.** A new `shell/viewTransition.ts` exposes a pure guard (`viewMotion`) and a runner (`changeView`). `App.tsx` routes every navigation through one `navigate(next)` function. With `"native"` motion it calls `document.startViewTransition(() => flushSync(update))`. Otherwise it calls `update()` directly. In the same update, `App` records the entered view and passes it to `ViewSlot` as `data-entering`. CSS plays an opacity-only enter keyframe on `.app[data-view-motion="css"] > main > .view[data-entering]`. That keyframe restarts naturally because the element goes from `display: none` to displayed in the same commit. `@supports (view-transition-name: none)` gates the native CSS, and `::view-transition { pointer-events: none; }` keeps input live. The hash-sync effect (App.tsx:31-34), shortcuts and focus are untouched.
- **Page header and aurora.** These are CSS only, in the screens layer, on the existing `Page` markup from `ui/layout.tsx` (owned by item B, not edited here). The selectors are `.view > .page > .panel-heading` and `.view > .page > .scope`. Home's wash is `.view > .page[data-surface="home"]::before`.
- **Stylesheet split.** `screens/app.css` is 252 lines and would pass the 300-line cap. The shell chrome therefore moves to a new `screens/shell.css`, and `app.css` keeps the connect page and Sessions. Registering the new sheet takes one line in `styles.css` and one entry in `EXPECTED_SHEETS`. Those two files belong to F2, so this is a minimal, declared exception (see Notes).

## Out of Scope

- Item B files: `design/components.css`, `design/overlays.css`, every `ui/*` file except `ui/shell.tsx` and its new test, `design/StatusBadge.tsx` and `design/Icon.tsx`. B's primitives (Reveal, Aurora and so on) are consumed only through existing `ui/index.ts` exports. This item does not need them: the header reveal and wash are CSS-only.
- Item D files: view TSX (`Home.tsx`, `Board.tsx` and the others), `screens/*.css` other than `app.css` and the new `shell.css`, and feature directories.
- F1/F2 files: tokens, fonts, `base.css`, `tailwind.css` and `docs/`. The only exception is the one-line sheet registration described above. Do not add or rename tokens. If a needed role is missing, compose it from existing tokens (`calc()` and `var()`) and list the gap in the report.
- A manual light/dark theme switch or theme chip. The colour scheme follows the OS (`prefers-color-scheme`) and no theme state exists, so adding one would be a new feature that needs token work.
- A new top bar. The palette trigger stays in the sidebar (`Sidebar`'s `.sidebar-search`) and is restyled in place.
- Scroll shadows. The window (document) scrolls and the shell owns no scroll region; labelled scroll regions belong to B/D. They are skipped on purpose.
- Arrow-key roving focus in the nav. Tab order, `aria-current` and Ctrl+N shortcuts are preserved as they are.
- Runtime, schemas, the TUI, the mono font, ADRs, and visual QA screenshots (item Q).

## Relevant Files

- `AGENTS.md`, `docs/DESIGN-SYSTEM.md` (principles, line 136: text ancestors never keep `transform`/`opacity` at rest), `docs/decisions/0030-desktop-shell-and-tailwind.md`, ADR 0032 (written by F2).
- `apps/desktop/src/App.tsx`: `useWindowNavigation` (`setView` at :27, hash sync at :31-34, shortcut and `luuna:command` handlers), `open`, the `ViewSlot` list (:74-79). Route all `setView` callers through `navigate`.
- `apps/desktop/src/ui/shell.tsx`: `AppShell`, `Sidebar`, `ConnectionStatus`, `NavItem`, `ViewSlot`, `Mark`. Add `NavSection`, `useNavPill`, `pillGeometry` and `applyPill`, plus the `live`, `current`, `entering` and `motion` props.
- `apps/desktop/src/shell/WindowSidebar.tsx`: renders the sections and footer status, and passes `current`, `live` and shortcuts from `content/views.ts`.
- `apps/desktop/src/shell/viewTransition.ts` (new): `viewMotion` and `changeView`.
- `apps/desktop/src/content/views.ts`: `VIEWS` (order and index stay unchanged, because shortcuts depend on them). Add `NAV_SECTIONS` and `viewShortcut`.
- `apps/desktop/src/screens/app.css`: keeps the connect page, Settings › Runtime and Sessions rules. Shell chrome moves out of it.
- `apps/desktop/src/screens/shell.css` (new): sidebar, nav pill, footer and pulse, palette trigger, main column, page header, Home aurora, view enter, view-transition pseudo-elements, the 920 rail, reduced-motion and forced-colours blocks.
- `apps/desktop/src/styles.css` (F2-owned, one-line exception): `@import "./screens/shell.css" layer(screens);` goes directly after `app.css`.
- `apps/desktop/src/design/design-system.test.ts` (F2-owned, one-entry exception): add `"screens/shell.css"` to `EXPECTED_SHEETS` directly after `"screens/app.css"`.
- `apps/desktop/src/design/components.test.ts`: read only. It enforces the 300-line cap, the RAW element ban in views, no `style={{`, and headings only in `ui/`.
- `scripts/mvp-ui-smoke.mjs`: read only. Preserve `nav[aria-label="Views"]` buttons named `^<Label>`, `.nav-item[aria-current=page]`, `.connection` with `data-tone` and the "Local runtime connected/offline" text, `data-surface` and `data-capability` markers, no horizontal scroll at 760px in both schemes, and `[role=dialog]`.
- New tests: `apps/desktop/src/ui/shell.test.tsx`, `apps/desktop/src/shell/viewTransition.test.ts`, `apps/desktop/src/content/views.test.ts`.

## Implementation Plan

### Foundation

Read the merged F1/F2 output and map these token roles to real names before writing any CSS:

| Role | Used for | Fallback if missing (compose, never a literal) |
| --- | --- | --- |
| sidebar width (~240px), compact rail width, nav item height (32-36px) | grid, nav | existing `--sidebar-width`, `--sidebar-compact`, `--nav-height` |
| accent tint surface (`--color-selected`), accent text (`--color-accent`), sidebar surface, hairline/strong border, muted text | nav, pill, chips | existing roles (accent on selected is already in the 4.5:1 contrast pairs) |
| radius for buttons (6) and pills (full) | pill, chips, kbd | existing `--radius-*` |
| card/popover layered shadow | palette trigger hover, chip | `--shadow-card` |
| durations: micro (~120-160), standard (~200-250), ambient (>=20s); stagger step | pill, enter, pulse, aurora | `--duration-fast`, `calc()` multiples |
| easings: out `cubic-bezier(.16,1,.3,1)`, in, standard | pill, enter, exit | `--ease` |
| type: label (11/16, 600, uppercase, tracking), title (h1), body, small | section labels, header | `--text-2xs`, `--text-title` and others |
| aurora gradient (pale, pre-scrimmed) and blur radius | Home wash | skip the wash and report it if no gradient token exists |

Confirm F2's lint revision allows `opacity` inside `@keyframes`. If it does not, use transform-only keyframes and report this.

### Core

- **Sidebar.** Sections come from `NAV_SECTIONS`. The pill is measured as described in the Solution Statement. The status moves to a footer (`margin-top: auto`). The palette trigger gets a field-like restyle. The 920px rail and the `data-sidebar="collapsed"` rail keep working, and the pill re-measures through the ResizeObserver.
- **View change.** Add a guard and runner, and use one `navigate` function in `App.tsx`.

### Integration

- **CSS.** Move the chrome into `shell.css` and register the sheet. Add markup tests and pure tests, then run the full validation.

## Step by Step Tasks

1. **Baseline.** Run `git status` (expect clean apart from other wave-2 items) and `npm run test --workspace @luuna/desktop`, and record the result. Read the F1/F2 outputs listed in Metadata and fill in the token-role table for your own use.

2. **`content/views.ts`.** Add these, leaving `VIEWS`, `viewFromHash`, `viewForShortcut`, `CONNECTION_LABEL` and `viewInfo` unchanged:
   - `export const NAV_SECTIONS = [{ id: "workspace", label: "Workspace", views: ["home", "board", "projects", "sessions"] }, { id: "general", label: "General", views: ["settings", "help"] }] as const satisfies ReadonlyArray<{ id: string; label: string; views: readonly View[] }>;`
   - `export function viewShortcut(id: View): string`, which returns `"Ctrl+,"` for settings and `` `Ctrl+${index + 1}` `` otherwise. Move this logic from `WindowSidebar.tsx`.

3. **New `content/views.test.ts`:**
   - `NAV_SECTIONS` covers every `VIEWS` id exactly once.
   - The concatenated section order equals `VIEWS` order, so the shortcuts are stable.
   - For every view, `viewForShortcut` applied to the key derived from `viewShortcut(id)` returns `id`.

4. **New `shell/viewTransition.ts`** (pure and dependency-free apart from types):
   - Define a narrow structural type: `type TransitionHandle = { finished: Promise<unknown>; ready?: Promise<unknown>; skipTransition(): void }` and `type TransitionHost = { startViewTransition?: (update: () => void) => TransitionHandle; hidden?: boolean }`.
   - `export type ViewMotion = "native" | "css" | "none";`
   - `export function viewMotion(host: TransitionHost | undefined, supportsCss: boolean, reducedMotion: boolean): ViewMotion` returns `"none"` if `reducedMotion`, `"native"` if `typeof host?.startViewTransition === "function" && supportsCss`, and `"css"` otherwise.
   - `export function changeView(host: TransitionHost | undefined, motion: ViewMotion, update: () => void, previous?: TransitionHandle | null): TransitionHandle | null`:
     - If `motion !== "native"`, if `host.hidden` is set, or if `startViewTransition` is absent, call `update()` and return `null`.
     - Otherwise call `previous?.skipTransition()` and `const handle = host.startViewTransition(update)`. Attach no-op `.catch` handlers to `finished` and `ready` so a skipped or aborted transition never surfaces an unhandled rejection. Return `handle`.
     - If `startViewTransition` throws, call `update()` and return `null`. The update must run exactly once in every path.

5. **New `shell/viewTransition.test.ts`:**
   - `viewMotion` matrix: reduced motion beats support; missing function gives `"css"`; `supportsCss = false` gives `"css"`.
   - `changeView` with a fake host:
     - `"css"` and `"none"` call `update` synchronously once and never call `startViewTransition`.
     - `"native"` calls `startViewTransition` once and `update` once (the fake invokes the callback). It also skips the previous handle.
     - A throwing `startViewTransition` still calls `update` once.
     - `hidden: true` bypasses the API.
     - A rejected `finished` promise does not cause an unhandled rejection. Use `await Promise.resolve()` and a `process.on("unhandledRejection")` spy, or assert that `.catch` was attached.

6. **`App.tsx`:**
   - Import `flushSync` from `react-dom`, plus `changeView` and `viewMotion`.
   - In `useWindowNavigation`:
     - Add `const [entering, setEntering] = useState<View>(initialView)`. Compute the initial view once and share it with the `view` initializer, so the first paint reveals.
     - Add `const motion = useState(() => viewMotion(typeof document === "undefined" ? undefined : document, typeof CSS !== "undefined" && CSS.supports("view-transition-name: none"), false))[0]`. This is static support only; reduced motion is checked per call.
     - Add a `useRef<TransitionHandle | null>` for the in-flight transition.
     - Add `navigate(next: View, extra?: () => void)`, which:
       1. Builds `update = () => { extra?.(); setView(next); setEntering(next); }`.
       2. Reads reduced motion at call time with `matchMedia("(prefers-reduced-motion: reduce)").matches`, guarded for `typeof matchMedia`.
       3. Calls `ref.current = changeView(document, reduced ? "none" : motion, motion === "native" && !reduced ? () => flushSync(update) : update, ref.current)`.
     - Make no change when `next === view` (current behaviour simply re-sets; keep it a no-op apart from `extra`).
   - Replace every `setView(x)` in the shortcut handler, the `luuna:command` handler, `open` (`navigate("projects", () => setRequested(...))`), `onSelect`, `usePalette({ onView })` and `Home onNavigate` with `navigate`.
   - Leave the hash/scroll effect at :31-34 and the collapse/palette logic byte-for-byte unchanged.
   - Return `entering` and `motion` from the hook.
   - Pass `motion` to `AppShell` and `entering={entering === "<id>"}` to each `ViewSlot`.
   - Do not move focus: navigation from the sidebar keeps focus on the nav button, as it does today.
   - Keep the file at or under 300 lines.

7. **`ui/shell.tsx`.** Keep every existing export and its current props working. All new markup lives here.
   - `AppShell({ collapsed, sidebar, children, motion? })` adds `data-view-motion={motion}` on `.app`. The skip link, `main#main` and `tabIndex={-1}` are unchanged.
   - `ViewSlot({ hidden, entering?, children })` renders `<div className="view" hidden={hidden} data-entering={entering ? "" : undefined}>`.
   - `ConnectionStatus({ tone, label, title, live? })` adds `data-live={live ? "" : undefined}`. It keeps `className="connection"`, `data-tone`, `role="status"`, `aria-live="polite"` and the `.tone-mark` `<i>`.
   - `export function NavSection({ id, label, children })` renders `<div className="nav-section"><span className="nav-section-label sidebar-label" id={`nav-${id}`}>{label}</span><ul className="flex flex-col gap-0.5" aria-labelledby={`nav-${id}`}>{children}</ul></div>`. `.sidebar-label` makes the label visually hidden in the rail but still announced.
   - `Sidebar` gains `current: string` and keeps `status`, `onToggle`, `onSearch`, `collapsed` and `children` (now sections). It renders, in order:
     1. `.sidebar-top` (unchanged).
     2. The `.sidebar-search` trigger. Keep its aria-label, `aria-haspopup`, `aria-keyshortcuts`, title and kbd.
     3. `<nav className="sidebar-nav" aria-label="Views" ref={navRef}><span className="nav-pill" aria-hidden="true" />{children}</nav>`.
     4. `<div className="sidebar-footer">{status}</div>`.
   - Call `useNavPill(navRef, current, collapsed)`.
   - `export function pillGeometry(nav: { top: number }, item: { top: number; height: number } | null): { y: number; height: number } | null` returns null when `item` is null or `item.height <= 0` (hidden or unlaid). Otherwise it returns `{ y: Math.round(item.top - nav.top), height: Math.round(item.height) }`.
   - `export function applyPill(nav: Pick<HTMLElement, "style" | "setAttribute" | "removeAttribute">, geometry)`: null removes `data-pill`. Otherwise it sets `--pill-y` and `--pill-h` to `${n}px` through `nav.style.setProperty` and sets `data-pill="ready"`. Never use `style={{` (banned by components.test.ts).
   - `function useNavPill(ref, current, collapsed)`, in a `useLayoutEffect` keyed on `[current, collapsed]`:
     - `place()` queries `[aria-current="page"]` in the nav and calls `applyPill(nav, pillGeometry(nav.getBoundingClientRect(), item?.getBoundingClientRect() ?? null))`.
     - Call `place()` once.
     - If `typeof ResizeObserver !== "undefined"`, observe the nav with `place` as the callback and disconnect on cleanup.
     - No `setState`, no `requestAnimationFrame` loop.
   - `NavItem`: unchanged markup. Keep `aria-current`, `aria-keyshortcuts`, title, the `.sidebar-label` span and `.nav-count`.
   - Keep the file at or under 300 lines.

8. **`shell/WindowSidebar.tsx`.** Map over `NAV_SECTIONS` to render `<NavSection>`s of `<NavItem>`s. Use `viewInfo(id)` for the label, `viewShortcut(id)` for the shortcut, and `activeRuns` as the count on sessions. Pass `current={view}` to `Sidebar` and `live={connection === "connected"}` to `ConnectionStatus`.

9. **New `ui/shell.test.tsx`.** Use `renderToStaticMarkup` and `createElement` (no jsdom; the default Vitest node environment):
   - `pillGeometry`: null item gives null; zero height gives null; it returns the offset and height, rounded.
   - `applyPill`: on a fake `{ style: { setProperty: vi.fn() }, setAttribute, removeAttribute }` it sets both properties in px plus `data-pill`, and null removes it.
   - `Sidebar` markup with two sections:
     - Contains `<nav class="sidebar-nav" aria-label="Views">`.
     - Contains exactly one `class="nav-pill" aria-hidden="true"`.
     - Exactly one `aria-current="page"` is on the current item.
     - Each section `ul` has `aria-labelledby` pointing at a label id that exists.
     - The search button keeps `aria-haspopup="dialog"`.
     - The footer contains `class="connection"` with `role="status"`.
   - `ConnectionStatus` with `live` has `data-live` and `data-tone`; without `live` it has no `data-live`.
   - `ViewSlot` with `hidden` and `entering` renders `hidden=""` and `data-entering`.
   - `AppShell` with `motion="css"` renders `data-view-motion="css"`, the skip link and `id="main"`.

10. **Split the CSS.**
    - Create `screens/shell.css` with a header comment matching `app.css` style.
    - Move all chrome rules into it: `.app` grid, sidebar, wordmark/mark, connection, toggle, search, nav, icons, `.app > main`, `.view[hidden]`, `.view > .page` header rules, the collapsed rail, and the sidebar parts of the 920 media block and of the forced-colours block.
    - `app.css` keeps the connect page, Settings › Runtime, Sessions and their media rules. `.connect-mark` rules stay with the connect page and the `.wordmark-mark` rules move.
    - Register the sheet in `styles.css` and `EXPECTED_SHEETS`.
    - Run `npx vitest run src/design` and confirm it is green before restyling.

11. **Restyle in `shell.css`.** Use tokens only, both schemes, at most three `>` per selector, approved `@media` only, no `[data-tone=` (bare `[data-tone]` is allowed), no `opacity` property outside keyframes, and no `overflow: auto|scroll`.
    - **Sidebar.** Width from the sidebar-width role, sidebar surface, hairline right border.
      - `.nav-section-label` uses the label type role (uppercase, tracking, semibold, muted, label padding). Sections are separated by a space step.
      - Nav items are 32-36px with radius-button. Hover uses the control-hover background.
      - The active item gets `background: var(--color-selected)` and `color: var(--color-accent)`, with the icon stroke in the accent colour.
    - **Pill:**
      - `.sidebar-nav { position: relative; --pill-y: 0; --pill-h: 0; }`.
      - `.sidebar-nav > .nav-pill { position: absolute; top: 0; inset-inline: 0; display: none; height: var(--pill-h); transform: translateY(var(--pill-y)); border-radius: <radius-button>; background: var(--color-selected); pointer-events: none; transition: transform <standard> <ease-out>; }`.
      - `.sidebar-nav[data-pill="ready"] > .nav-pill { display: block; }`. The first measurement goes from `display: none` to displayed, so there is no slide-in from 0.
      - Put `.nav-section` in a positioned stacking context (`position: relative`) so the buttons paint above the pill.
      - `.sidebar-nav[data-pill="ready"] button.nav-item[aria-current="page"] { background: transparent; }`.
    - **Footer.** `.sidebar-footer { margin-top: auto; }`. `.sidebar-footer > .connection` is a chip: radius-full, subtle surface, hairline border, small text, `color: var(--tone-fg)` only on `.connection[data-tone]`.
    - **Pulse:**
      - `.sidebar-footer > .connection[data-live] > .tone-mark[data-tone] { position: relative; }`.
      - `.sidebar-footer > .connection[data-live] > .tone-mark[data-tone]::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--tone-mark); animation: live-pulse <ambient-ish ~2s> <ease-out> infinite; }`.
      - `@keyframes live-pulse { from { transform: scale(1); opacity: <tokenised or 0.6 unitless>; } to { transform: scale(2.4); opacity: 0; } }`. Unitless numbers are allowed.
      - The pseudo-element is not a text ancestor.
    - **Palette trigger.** Field-like: surface background, hairline border, radius-input, muted text, `kbd` as a small radius chip on the subtle surface, hover with a strong border plus card shadow, and the focus ring from base.
    - **Main.** Add `.app > main { overflow-x: clip; }` so decorative washes can never create horizontal scroll at 760px. `clip` is allowed by the lint and does not break `position: sticky`.
    - **Page header:**
      - `.view > .page > .panel-heading` aligns title and actions on a baseline row, with wrap and gap.
      - `> h2` uses the title type role (h1 28/34, 600, tight tracking, heading colour).
      - `.view > .page > .scope` uses the body/muted colour and a max line length from an existing measure token.
    - **Header reveal (once per entrance):**
      - `.view[data-entering] > .page > :is(.panel-heading, .scope) { animation: header-reveal <standard> <ease-out> backwards; }`, with `.scope` delayed by one stagger step.
      - `@keyframes header-reveal { from { opacity: 0; transform: translateY(var(--space-2)); } }`.
      - `backwards` fill (never `forwards`) leaves no transform or opacity at rest (DESIGN-SYSTEM.md:136).
    - **Home aurora:**
      - `.view > .page[data-surface="home"] { position: relative; isolation: isolate; }`.
      - `::before` is decorative: `content: ""; position: absolute; z-index: -1; inset: calc(-1 * <main top padding>) 0 auto; height: <~3 x space-7>; background: <aurora gradient token>; filter: blur(<blur token>); pointer-events: none; animation: aurora-drift <ambient >= 20s> linear infinite alternate;`.
      - `@keyframes aurora-drift` translates and scales only.
      - The wash must use F2's pale, pre-scrimmed gradient so the header text keeps 4.5:1; never saturated colour behind text.
    - **CSS fallback enter.** `.app[data-view-motion="css"] > main > .view[data-entering] { animation: view-enter <standard> <ease-out> backwards; }` with `@keyframes view-enter { from { opacity: 0; } }`. It is opacity only: no transform on the view ancestor of live output or of sticky-scroll measurement.
    - **Native.** Inside `@supports (view-transition-name: none)`:
      - `.app[data-view-motion="native"] > main { view-transition-name: luuna-view; }`.
      - `::view-transition { pointer-events: none; }`.
      - `::view-transition-old(root), ::view-transition-new(root) { animation: none; mix-blend-mode: normal; }`. The sidebar is not cross-faded, so the live pill slide shows through the live new snapshot.
      - `::view-transition-group(luuna-view) { animation: none; }`.
      - `::view-transition-old(luuna-view) { animation: view-exit <micro> <ease-in> both; }`.
      - `::view-transition-new(luuna-view) { animation: view-enter <standard> <ease-out> both; }`.
      - `@keyframes view-exit { to { opacity: 0; } }`.
    - **Rail.** The 920px media rule and `[data-sidebar="collapsed"]` collapse section labels (via `.sidebar-label`), centre the items and the footer chip (tone mark only, label visually hidden), and keep the pill full rail width.
    - **`@media (prefers-reduced-motion: reduce)`:**
      - `.sidebar-nav > .nav-pill { display: none; }`.
      - `.sidebar-nav[data-pill] button.nav-item[aria-current="page"] { background: var(--color-selected); }`. Same or higher specificity than the transparent rule.
      - The pulse `::after`, the aurora `::before`, `.view[data-entering]`, the header reveal and the `::view-transition-*` pseudo-elements all get `animation: none;`.
    - **`@media (forced-colors: active)`.** Hide the pill and restore `SelectedItem`/`SelectedItemText` on `.sidebar-nav[data-pill] button.nav-item[aria-current="page"]`, alongside the existing forced-colours rule.

12. **Size and ownership check.** Confirm every touched file is at most 300 lines. `git diff --name-only` may list only:
    - `apps/desktop/src/App.tsx`
    - `apps/desktop/src/ui/shell.tsx`
    - `apps/desktop/src/ui/shell.test.tsx`
    - `apps/desktop/src/shell/*`
    - `apps/desktop/src/content/views.ts`
    - `apps/desktop/src/content/views.test.ts`
    - `apps/desktop/src/screens/app.css`
    - `apps/desktop/src/screens/shell.css`
    - `apps/desktop/src/styles.css` (one line)
    - `apps/desktop/src/design/design-system.test.ts` (one entry)

13. **Validate.** Run every command in Validation Commands and fix failures at the root (never by loosening lint). Report the exact commands and results. Visual and a11y screenshots are item Q.

## Testing Strategy

### Unit Tests

- `src/shell/viewTransition.test.ts`: the `viewMotion` matrix; `changeView` across native, css, none, hidden, a throwing API and skipping the previous handle; update runs exactly once; no unhandled rejection.
- `src/ui/shell.test.tsx`: `pillGeometry` and `applyPill` as pure geometry and DOM-free application; static-markup checks of `Sidebar`, `NavSection`, `ConnectionStatus`, `ViewSlot` and `AppShell` attributes and roles.
- `src/content/views.test.ts`: section coverage and order, shortcut round-trip.
- Existing `src/design/*.test.ts`: token-only lint, contrast in both schemes, sheet registration, 300-line cap, RAW ban in views.

### Edge Cases

- **Unmeasured nav.** `getBoundingClientRect` height is 0 because the nav is not laid out. `data-pill` is absent and the static active background shows.
- **Fast repeated navigation.** Repeated Ctrl+1..6 skips the previous transition. The final view, hash and pill are always correct.
- **Navigation while gated.** On the connect page, `data-entering` is set but the slot is hidden. When the runtime connects, the entered view reveals once.
- **Reduced motion toggled at runtime.** `navigate` reads `matchMedia` per call, and the CSS `@media` stops everything else.
- **WKWebView (macOS).** Without View Transitions it uses `"css"` motion. Without `ResizeObserver` the pill is placed once per change.
- **Collapsing the sidebar (Ctrl+\\) and the 920px breakpoint.** The pill re-measures. At 760px there is no horizontal scroll (`overflow-x: clip` on main).
- **The palette's `onView` and the native menu's `view:*`.** Both go through `navigate`, and the hash is still written by the unchanged effect.

## Acceptance Criteria

- [ ] The sidebar shows uppercase section labels "Workspace" and "General" and 32-36px icon nav items. The active item has a tinted accent fill and accent text. Hover is styled. Tab order, `aria-current="page"`, `aria-keyshortcuts` and the Ctrl+1..6 and Ctrl+, shortcuts are unchanged.
- [ ] One `.nav-pill` slides with `transform` only, about 220ms on the out curve, between views. It is measured once per change or resize, with no React state and no per-frame loop. Unmeasured, reduced-motion and forced-colours states show a static active background.
- [ ] The connection chip sits in the sidebar footer and pulses only when connected. `.connection`, `data-tone`, `role="status"` and the label text the smoke script reads are preserved.
- [ ] Every view's header (title, description, actions) shares one style and reveals once on entrance, with no residual transform or opacity at rest. Home alone has a decorative aurora wash that keeps header contrast.
- [ ] View changes use View Transitions where supported (`@supports` and the JS guard), otherwise a CSS opacity enter keyframe through `data-entering`. Reduced motion is instant. `::view-transition` never captures pointer input. Hash sync, focus and all `setView` entry points behave as before.
- [ ] The palette trigger is restyled as a field-like affordance with its kbd chip, keeping its accessible name, `aria-haspopup` and shortcut.
- [ ] Tokens only. Both schemes pass the contrast pairs. Files are at most 300 lines. No raw elements in views. `data-surface` and `data-capability` markers are untouched. No B, D or F files change beyond the declared one-line registration.
- [ ] All validation commands pass.

## Validation Commands

Run from `C:\Users\localhost\github\luuna` unless noted.

- `cd apps/desktop && npx vitest run src/design`: token lint, contrast in both schemes, sheet registration, 300-line cap, RAW ban.
- `cd apps/desktop && npx vitest run src/ui/shell.test.tsx src/shell/viewTransition.test.ts src/content/views.test.ts`: the new tests specific to this change.
- `npm run typecheck --workspace @luuna/desktop`
- `npm run test --workspace @luuna/desktop`
- `npm run build`: `tsc --noEmit && vite build` for `@luuna/desktop`.
- `git diff --name-only`: ownership check against step 12.

## Notes

- **Declared ownership exception.** `styles.css` and `EXPECTED_SHEETS` belong to F2 (already merged in wave 1). Adding `screens/shell.css` is unavoidable because `app.css` plus about 125 new lines would exceed the 300-line cap. Keep the change to exactly one import line and one array entry, both placed directly after `app.css`. Item B may append its own sheets in parallel, so the integrator should expect a trivial merge in those two lines.
- **Item B coupling.** The pulse adds `::after` on `.tone-mark[data-tone]`. B's `components.css` draws the tone mark itself (and `::before` on `.state`). If B also adds `::after` to `.tone-mark`, scope ours more tightly (it is already scoped to `.sidebar-footer > .connection[data-live]`) and report the overlap.
- **Text rendering.** `docs/DESIGN-SYSTEM.md:136` says text ancestors never keep `transform`/`opacity` at rest. Every keyframe here uses `backwards` or `both` on pseudo-elements, and the view-level keyframe is opacity only and ends at rest. Do not add `will-change`.
- **Unverified browser support.** View Transitions and `ResizeObserver` in WebView2 are expected to work but are not verified here. macOS WKWebView may lack same-document View Transitions, so the guard falls back to `"css"`. Item Q verifies in Chromium at 1280 and 760, in both schemes and under reduced motion. Unit tests are not platform evidence.
- **Docs follow-up.** Do not edit `docs/` in this item. Report this sentence for the documentation pass or ADR 0032 owner: "Shell motion: one measured nav pill (transform only), view changes via View Transitions with a CSS enter fallback through `data-entering`, all instant under reduced motion."
- **No theme chip.** No theme state exists, and adding manual theme selection is out of scope.
