# Feature: Desktop smooth presentation (sticky glide, live tail caret, crisp text)

## Metadata

- Type: feature
- Source: user request (smooth, Neovide-like feel within the DOM for live Pi output and session events)
- Date: 2026-10-22
- Orchestration: run `smooth-render-20261022-0801`, wave 1, item D2. A parallel item owns `apps/desktop/src/sessions/useSessionReplay.ts`; this item must not modify it.

## Feature Description

Live Pi output and the session event record currently grow below the fold: nothing follows new content, and the Pi response `<pre>` is not even a bounded region (it has no `aria-label`, so the `pre[aria-label]` scroll-region rule never applies and the page itself grows). This feature makes both regions follow new content with a short, eased glide while the reader is at the bottom. It also releases the pin the moment the reader scrolls up, shows a steady caret at the end of a live response, and tunes monospace rendering and scroll regions so text stays sharp and stops jittering on Windows WebView2. All of it is presentation only. The runtime still decides every state, and no control, enabled state, runtime text or capability marker changes.

## User Story

As a developer watching a Pi session stream, I want the response and event list to stay pinned to the newest content with a smooth glide (and never fight me when I scroll back to read), so that following live work feels calm and crisp instead of requiring manual scrolling.

## Solution Statement

- Split the work into two pure, DOM-free modules and one thin hook:
  - `ui/glide.ts` holds the easing math and token parsing.
  - `ui/stickyScroll.ts` is a controller that drives an injected scroll surface and frame scheduler.
  - `ui/useStickyScroll.ts` wires the controller to a real element with `requestAnimationFrame`, listeners and `getComputedStyle`.
- Keep the hook thin so the behaviour is unit-testable under Vitest's node environment. The repo has no jsdom, and tests use `renderToStaticMarkup`.
- Integrate in the component library, not in views. Views keep composing library components, as `components.test.ts` enforces:
  - `ScrollList` gains opt-in `follow` and `followKey` props.
  - A new `LiveOutput` component renders the Pi response as a labelled, focusable, bounded `pre` that follows and carries the tail caret.
- Put all durations, thresholds and caret sizes in new tokens in `design/tokens.css`. Reduced motion zeroes the glide duration, and the controller reads that token, so the CSS media query stays the single source of truth for motion.
- Canvas or WebGL rendering is not used. It would replace DOM text, selection, find, the accessibility tree and the smokes' selectors, and it would need an ADR.

Decisions, with reasons:

1. **Easing model: a critically damped spring, solved analytically per frame.** Streaming moves the target (the bottom) every few frames. A plain exponential approach restarts with a velocity discontinuity at each target change. A critically damped spring keeps velocity continuous, which is the Neovide feel. The closed-form step is stable for any `dt`, so a long frame or a backgrounded window cannot blow up. Overshoot at the bottom is clamped to the maximum scroll position. Use `omega = SETTLE / durationMs` with `SETTLE = 6.64`: from rest, the residual is under 1% at `t = duration`. Snap to the target when `|x| < 0.5` px and `|v|` is negligible. A duration of 0 means an instant jump.
2. **Release by user intent, not by a decreasing `scrollTop`.** Two non-user sources also move `scrollTop`: scroll anchoring (the bounded event window trims its oldest rows from the top, so `scrollTop` drops) and the controller's own writes. Rules:
   - While a glide runs, scroll events are ignored unless a user-intent input arrived first.
   - User-intent inputs are `wheel` with `deltaY < 0`, `pointerdown` on the region (this includes the scrollbar), `touchstart`, and `keydown` of ArrowUp, ArrowDown, PageUp, PageDown, Home, End or Space on the focused region.
   - An intent input cancels the glide at once. The next scroll event then recomputes `pinned = distanceToBottom <= threshold`.
   - When no glide runs, every scroll event recomputes `pinned` the same way. Returning to the bottom therefore re-pins.
3. **One read phase, then one write per frame.** Each frame reads `scrollTop`, `scrollHeight` and `clientHeight` first, then computes, then performs a single `scrollTop` write. If the `scrollTop` read differs from the last written value by more than 1 px and no glide-owned change explains it, the controller stops instead of fighting. The controller keeps a float position internally and rounds written values to device pixels (`Math.round(v * dpr) / dpr`), so text never sits at a fractional offset.
4. **The first content after mount, reset or re-enable jumps instantly.** Opening a long, already-recorded session should show the latest content, not animate through it. Later growth glides.
5. **Steady tail caret, no blink.** The tokens file states "evidence never pulses", and WCAG 2.2.2 requires a pause control for blinking content that lasts more than 5 s. The caret is a CSS `::after` pseudo-element on `pre[data-live]`, so it is never part of selected or copied text and is not in the accessibility tree. It uses the active tone (cyan means the runtime works), not the lavender accent.
6. **`text-rendering` on monospace `pre` and `code`: `optimizeSpeed`, with `font-kerning: none` and `font-variant-ligatures: none`.**
   - Identities must read character by character. Cascadia Code's programming ligatures would merge `!=` or `->`, and `none` also disables `calt`.
   - Kerning is meaningless on a monospace grid.
   - Streaming re-lays out the region on every delta, so dropping the shaping work the body's `optimizeLegibility` asks for is a real saving.
   - The Pi response is prose rendered in the sans stack (`.assistant-output > pre`). It explicitly restores `text-rendering: optimizeLegibility`, `font-kerning: normal` and `font-variant-ligatures: common-ligatures`. Its re-layout is bounded by the region's containment.
7. **Monospace stack: `"Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, "SF Mono", "SFMono-Regular", Menlo, "Liberation Mono", monospace`.** These are crisp, hinted, installed faces: Cascadia ships with current Windows 11 and Windows Terminal, and Consolas is everywhere on Windows. Chromium on Windows ignores `ui-monospace`. Nothing is fetched, consistent with the CSP `default-src 'self'` and "no @font-face".
8. **Scroll-region hygiene on `ol.events` and `pre[aria-label]`:**
   - `scrollbar-gutter: stable`, so a region that starts to overflow does not reflow its text width.
   - `contain: content`. Paint containment only clips what the region already clips; the focus ring is inset (`--focus-inset`); no popover or menu lives inside a region.
   - Keep the default `overflow-anchor: auto`. Anchoring holds a reader's place while the event window trims rows from the top, and the controller tolerates it (decision 2). Document this in a CSS comment.
   - Do not add `content-visibility` to rows. The window is bounded to 200 single-line rows, so the gain is negligible. Estimated intrinsic sizes would also make `scrollHeight`, the glide target, shift as rows render, which risks a visible chase.
   - Never add `transform`, `will-change` or `opacity` to text ancestors. Chromium drops LCD antialiasing on such layers. Regions keep an opaque `--color-surface-sunken` background, which keeps composited scrolling eligible for crisp text.
   - `-webkit-font-smoothing` (base.css) affects macOS only. On Windows, sharpness comes from DirectWrite plus avoiding the layer promotions above. Note this in base.css.

## Out of Scope

- Canvas, WebGL or GPU text rendering, and any custom font file or `@font-face` (both need an ADR, and the CSP forbids fetching fonts).
- `apps/desktop/src/sessions/useSessionReplay.ts`, which belongs to the parallel item. Do not edit or reformat it.
- Runtime, API client, event-window size or replay cadence changes. Changes to which events or text are shown.
- A "Jump to latest" button or a visible pinned or unpinned indicator (possible follow-up).
- Following in the Projects event record (`projects/EventRecord.tsx`) and in `CodeBlock` regions (plan, diff, logs). `ScrollList` follow stays opt-in and off for them.
- Blinking caret, typing animations, smooth scrolling of user-initiated scrolls (`scroll-behavior` stays default).
- Proving real WebView2 smoothness. The validation below cannot establish it.

## Relevant Files

- `AGENTS.md`, `docs/DESIGN-SYSTEM.md`, `docs/decisions/0013-desktop-design-system.md`, `docs/decisions/0030-desktop-shell-and-tailwind.md`: design contract and enforcement. Read them first.
- `apps/desktop/src/ui/glide.ts` (new): the following pure functions.
  - `springStep(state: { x: number; v: number }, dtMs: number, durationMs: number): { x: number; v: number }`, where `x` is the offset from the target.
  - `settled(state): boolean`.
  - `distanceToBottom(scrollTop, scrollHeight, clientHeight): number`.
  - `isNearBottom(distance, thresholdPx): boolean`.
  - `parseCssTime(value: string, fallbackMs: number): number`, which accepts `ms` and `s`; an empty or invalid value returns the fallback.
  - `parseCssPx(value: string, fallbackPx: number): number`.
  - `snapToDevicePixel(value: number, dpr: number): number`.
- `apps/desktop/src/ui/glide.test.ts` (new): unit tests for the math.
- `apps/desktop/src/ui/stickyScroll.ts` (new): `createStickyScroll(surface: ScrollSurface, deps: { requestFrame, cancelFrame, now, devicePixelRatio, readTokens: () => { durationMs: number; thresholdPx: number } })`.
  - It returns `{ contentChanged(), userIntent(), scrolled(), setEnabled(enabled: boolean), reset(), dispose(), isPinned() }`.
  - `ScrollSurface` is `{ scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number }`.
  - It implements decisions 1 to 4. No DOM types are needed beyond that interface.
- `apps/desktop/src/ui/stickyScroll.test.ts` (new): controller tests with a fake surface that logs reads and writes, and a manual frame queue.
- `apps/desktop/src/ui/useStickyScroll.ts` (new): `useStickyScroll<T extends HTMLElement>({ enabled, followKey }): RefCallback<T>`. It does the following:
  - Attaches passive `wheel` and `touchstart` listeners plus `pointerdown`, `keydown` and `scroll` listeners.
  - Reads `--duration-follow` and `--follow-threshold` through `getComputedStyle(element)` inside the frame's read phase.
  - Calls `contentChanged()` from `useLayoutEffect` when `followKey` changes, `setEnabled` when `enabled` changes (re-enable resets to pinned and jumps instantly), and `dispose()` on unmount or element change.
  - Does not set React state per frame, so there are no re-renders.
- `apps/desktop/src/ui/layout.tsx`: `Output` (around line 117) stays a non-scrolling `<pre>`. Add `LiveOutput({ label, live, followKey, children })`. It renders `<pre aria-label={label} tabIndex={0} data-live={live ? "true" : undefined} ref={useStickyScroll(...)}>` with no `aria-live`. `App.test.tsx` forbids `<pre aria-live`, and the run status line already announces transitions.
- `apps/desktop/src/ui/content.tsx`: `ScrollList` (around line 54) gains optional `follow?: boolean` (default `false`) and `followKey?: unknown`. It attaches the hook's ref only when `follow` is defined, and keeps `ol.events`, `aria-label`, `tabIndex=0` and the `data-capability` passthrough unchanged.
- `apps/desktop/src/ui/index.ts`: already re-exports `./layout` and `./content`, so `LiveOutput` is exported automatically. Do not export the hook or controller to views unless needed.
- `apps/desktop/src/sessions/SessionParts.tsx` (`EventPanel`, around line 72): replace `<Output>{output}</Output>` with `<LiveOutput label="Pi response" live={!isTerminal(active.state)} followKey={output.length}>{output}</LiveOutput>`. Import `isTerminal` from `@luuna/api-client`.
- `apps/desktop/src/sessions/EventList.tsx` (around line 48): `<ScrollList ... follow={page === null} followKey={shown.at(-1)?.event_id}>`. Paging an earlier page disables following, and "Latest events" re-enables it and jumps to the bottom. This keeps `performance-ui-smoke.mjs` line 92 ("new output must not move an earlier page") true.
- `apps/desktop/src/design/tokens.css` (257 lines; must stay at or under 300). Add these to `:root`:
  - `--duration-follow: 160ms;`
  - `--follow-threshold: 48px;`
  - `--tail-caret-width: 0.55em;`
  - `--tail-caret-height: 1.15em;`
  - `--tail-caret-gap: 0.1em;`
  - Change `--font-mono` to the stack in decision 7.
  - Extend the reduced-motion block with `--duration-follow: 0ms;`.
- `apps/desktop/src/design/base.css`: on `code, kbd, samp, pre`, add `font-kerning: none; font-variant-ligatures: none; text-rendering: optimizeSpeed;`. Add the comment about `-webkit-font-smoothing` being macOS-only.
- `apps/desktop/src/design/components.css`:
  - On the `ol.events, pre[aria-label]` rule (around line 151), add `scrollbar-gutter: stable; contain: content;` plus the overflow-anchor comment.
  - Add the caret rule `pre[data-live]::after { content: ""; display: inline-block; width: var(--tail-caret-width); height: var(--tail-caret-height); margin-inline-start: var(--tail-caret-gap); vertical-align: text-bottom; background: var(--tone-active-mark); }`. It sits in components.css because raw tone tokens are allowed only there.
  - Add `pre[data-live]::after { forced-color-adjust: none; background: CanvasText; }` inside the existing `@media (forced-colors: active)` block.
- `apps/desktop/src/screens/app.css` (`.assistant-output > pre`, around line 204): add `text-rendering: optimizeLegibility; font-kerning: normal; font-variant-ligatures: common-ligatures;`. It now matches `pre[aria-label]` too, so it is bounded by `--scroll-max`; no new max-height is needed.
- `apps/desktop/src/design/design-system.test.ts`: add contrast pair `["tone-active-mark", "color-surface-sunken", 3]` (the caret sits on sunken surfaces; expected about 9:1 dark (`#5cc4e8` on `#0c0c0e`) and about 4.4:1 light (`#127a9e` on `#f0f0f3`)). No allowlist change is needed: every new literal lives in tokens.css, no opacity or `!important` is added, the media queries already exist, and scroll properties appear only on the sanctioned selectors.
- `apps/desktop/src/ui/presentation.test.tsx` (new): `renderToStaticMarkup` tests for `LiveOutput` and `ScrollList`.
- `docs/DESIGN-SYSTEM.md`:
  - Scales sentence: add the motion tokens (`--duration-follow` 160 ms, 0 ms under reduced motion) and `--follow-threshold`.
  - Monospace stack.
  - Scroll region row: the Pi response region, following behaviour, `scrollbar-gutter` and containment.
  - A short "Following live output" subsection with the decisions above.
  - Accessibility bullet: "Reduced motion turns the one transition off" becomes "turns transitions and the follow glide off".
- `scripts/mvp-ui-smoke.mjs`, `scripts/m6-ui-smoke.mjs`, `scripts/performance-ui-smoke.mjs`: read only. Selectors they use (`ol.events`, `ol.events > li`, `ol.events pre`, `pre[aria-label="..."]`, `.event-number`) must still match. The accessibility audit now counts one more focusable scroll region (the Pi response) when a session has output, which it accepts because the region is focusable.

## Implementation Plan

### Foundation

Read the docs listed above. Run `git status` and record it, and do not touch `useSessionReplay.ts`. Add the tokens and the reduced-motion override. Write `glide.ts` and its tests first; they need no DOM.

### Core

Write `stickyScroll.ts` against the `ScrollSurface` interface, following decisions 1 to 4.

Controller state is `pinned` (starts true), `enabled`, `gliding`, `userControl`, the spring `{ x, v }`, `position` (float), `lastWritten` and `firstFill` (true until the first content glide).

Frame order:

1. Read `scrollTop`, `scrollHeight` and `clientHeight`.
2. If `|scrollTop - lastWritten| > 1`, stop.
3. Compute `target = scrollHeight - clientHeight` and step the spring with `dt = now - lastFrame`.
4. Clamp to `[0, target]` and zero the velocity when clamped.
5. Snap to a device pixel and write once.
6. Schedule the next frame unless settled.

When `durationMs <= 0` or `firstFill` is true, `contentChanged()` writes `target` immediately (one read phase, one write) and schedules no frames.

Then write `useStickyScroll.ts` as thin wiring: `readTokens` reads the two custom properties via `getComputedStyle` and parses them with `parseCssTime(…, 160)` and `parseCssPx(…, 48)`.

### Integration

1. Add `LiveOutput` to `layout.tsx` and the `follow` and `followKey` props to `ScrollList`.
2. Wire `SessionParts.tsx` and `EventList.tsx`.
3. Make the CSS changes in base, components and screens.
4. Add the contrast pair.
5. Update `DESIGN-SYSTEM.md`.

## Step by Step Tasks

1. Run `git status`, then read `AGENTS.md`, `docs/DESIGN-SYSTEM.md`, ADR 0013 and ADR 0030. Confirm `apps/desktop/src/sessions/useSessionReplay.ts` is untouched before and after.
2. In `apps/desktop/src/design/tokens.css`, add `--duration-follow`, `--follow-threshold`, `--tail-caret-width`, `--tail-caret-height` and `--tail-caret-gap` under the Motion and Shape groups with one-line comments. Replace `--font-mono` with the decision 7 stack. Add `--duration-follow: 0ms;` to the `prefers-reduced-motion` block. Keep the file at or under 300 lines.
3. Create `apps/desktop/src/ui/glide.ts` with the pure functions listed in Relevant Files (spring per decision 1, `SETTLE = 6.64`, `dt < 0` treated as 0).
4. Create `apps/desktop/src/ui/glide.test.ts`, covering:
   - From rest, the residual is below 1% at `t = duration`, using 16 ms steps.
   - No overshoot from rest toward a fixed target.
   - `dt = 0` returns the same state.
   - `durationMs = 0` lands exactly on the target.
   - A 5000 ms single step is finite and settles.
   - A target moving +20 px per frame for 30 frames keeps the gap bounded, and the gap converges after the target stops.
   - `isNearBottom` at, below and above the threshold.
   - `parseCssTime("160ms")` is 160, `"0.16s"` is 160, `"0ms"` is 0, and `""` or `"x"` returns the fallback.
   - `parseCssPx("48px")` is 48.
   - `snapToDevicePixel(10.3, 2)` is 10.5.
5. Create `apps/desktop/src/ui/stickyScroll.ts` per Core.
6. Create `apps/desktop/src/ui/stickyScroll.test.ts` with a fake surface (a getter/setter log of `read:*` and `write` entries) and a manual frame queue. Assert:
   - Content growth while pinned glides and reaches the bottom.
   - Within every frame, no read follows a write, and there is exactly one write per frame.
   - The first fill is instant.
   - `durationMs = 0` is instant with no frames scheduled.
   - `userIntent()` mid-glide cancels pending frames and causes no further writes.
   - After `scrolled()` with distance greater than the threshold, growth causes no writes.
   - `scrolled()` back within the threshold re-pins, and the next growth glides.
   - A `scrollTop` decrease during a glide without `userIntent()` (simulated anchoring) does not unpin.
   - An external `scrollTop` change of more than 1 px mid-frame stops the glide without fighting.
   - `setEnabled(false)` stops writes, and `setEnabled(true)` re-pins and jumps.
   - `dispose()` cancels the pending frame.
7. Create `apps/desktop/src/ui/useStickyScroll.ts` per Relevant Files. Use passive listeners where possible and remove all listeners on cleanup. Do not set React state per frame.
8. In `apps/desktop/src/ui/layout.tsx`, add `LiveOutput` with a doc comment ("Live machine or assistant output: a labelled, focusable, bounded region that follows new text while the reader is at the bottom"). Leave `Output` and `CodeBlock` unchanged.
9. In `apps/desktop/src/ui/content.tsx`, extend `ScrollList` with optional `follow` and `followKey`. Without `follow`, the markup is byte-identical to today's.
10. In `apps/desktop/src/sessions/SessionParts.tsx`, use `LiveOutput` for the Pi response as specified. In `apps/desktop/src/sessions/EventList.tsx`, pass `follow={page === null}` and `followKey={shown.at(-1)?.event_id}`. Keep every `data-capability` attribute literal and unchanged.
11. Update `apps/desktop/src/design/base.css`, `apps/desktop/src/design/components.css` and `apps/desktop/src/screens/app.css` per Relevant Files and decisions 5 to 8, with a short comment justifying each choice. Use no raw lengths or durations outside tokens.css, and no opacity, `!important`, transform or will-change on text.
12. Add the `tone-active-mark` on `color-surface-sunken` contrast pair to `apps/desktop/src/design/design-system.test.ts`. Make no other rule or allowlist change. If any lint fails, fix the CSS, not the rule.
13. Create `apps/desktop/src/ui/presentation.test.tsx`, covering:
   - `LiveOutput` with `live` renders `<pre aria-label="Pi response" tabindex="0" data-live="true">` whose text content equals the children exactly. There is no caret text node, and no `aria-live`.
   - With `live={false}`, there is no `data-live`.
   - `ScrollList` without `follow` renders exactly `<ol class="events" aria-label="X" tabindex="0" data-capability="runs.events">…</ol>`.
   - A source check that `components.css` defines the caret only through `::after` with `content: ""`.
14. Update `docs/DESIGN-SYSTEM.md` per Relevant Files.
15. Run the Validation Commands and fix failures. Record actual results, and state that real WebView2 smoothness is unproven.

## Testing Strategy

- **Unit:**
  - `glide.test.ts` covers the spring math, thresholds, token parsing and device-pixel snapping.
  - `stickyScroll.test.ts` covers pin and release semantics, read-then-write order, reduced-motion instant behaviour, anchoring tolerance and disposal.
  - `presentation.test.tsx` covers markup: copied text stays unaltered, the caret is CSS only, and `ScrollList` is unchanged when not following.
- **Existing enforcement:**
  - `design-system.test.ts` covers token-only CSS, scroll-region rules, var() resolution and contrast, including the new pair.
  - `components.test.ts` covers the 300-line limit and no raw `<pre>` or `<ol>` in views; `SessionParts` and `EventList` keep using library components.
  - `App.test.tsx` covers no `<pre aria-live`.
- **Integration / E2E:** none required by this item's validation commands. When a browser and runtime are available, also run `scripts/performance-ui-smoke.mjs` and `scripts/mvp-ui-smoke.mjs`; they exercise paging during append, the accessibility audit and contrast. These smokes use Chromium/Playwright, not WebView2, so they prove structure, not perceived smoothness.
- **Edge cases:**
  - Empty output (no `LiveOutput` rendered).
  - Content shorter than the region (target 0, no writes beyond 0).
  - Switching sessions (`EventList` is keyed by run id and remounts; the Pi response `followKey` drops, which counts as a reset and an instant jump).
  - Terminal state (caret removed).
  - Reduced motion (instant).
  - A paging window (follow off).
  - An expanded payload row while pinned (growth glides only on `followKey` change, never on disclosure toggles).

## Acceptance Criteria

- [ ] WHEN the viewer of the Pi response or the session event list is within `--follow-threshold` of the bottom and new content arrives THE SYSTEM SHALL glide the region to the new bottom over about `--duration-follow` using `requestAnimationFrame`, with one layout read phase before a single `scrollTop` write per frame.
- [ ] WHEN the user scrolls up (wheel, keys, pointer or scrollbar, touch) THE SYSTEM SHALL cancel any glide immediately and stop following until the user returns within the threshold of the bottom.
- [ ] WHEN `prefers-reduced-motion: reduce` is active THE SYSTEM SHALL jump to the bottom without animation (`--duration-follow` is `0ms`).
- [ ] WHEN the session's run state is not terminal and it has output THE SYSTEM SHALL show a steady active-tone caret after the text via `pre[data-live]::after`. Copied text and the accessible name are unchanged, and the caret disappears once the run is terminal.
- [ ] WHEN the event list shows an earlier page THE SYSTEM SHALL NOT move it as new events arrive. "Latest events" resumes following at the bottom.
- [ ] The monospace stack prefers Cascadia Mono, Cascadia Code and Consolas. Monospace `pre`/`code` disable ligatures and kerning with `text-rendering: optimizeSpeed`, and the Pi response prose keeps `optimizeLegibility`. Each choice is justified in a CSS comment.
- [ ] `ol.events` and `pre[aria-label]` have `scrollbar-gutter: stable` and `contain: content`. No transform, will-change or opacity is added to text, and the overflow-anchor policy is documented.
- [ ] All new durations, lengths and thresholds are tokens. `design-system.test.ts` passes, with the only change being one added contrast pair.
- [ ] No front-end file exceeds 300 lines. `data-capability` and `data-surface` markers and the smoke-read DOM structure are unchanged. `apps/desktop/src/sessions/useSessionReplay.ts` has no diff.
- [ ] `docs/DESIGN-SYSTEM.md` documents the new tokens, the following behaviour, the caret and the font stack.

## Validation Commands

Grounded in `apps/desktop/package.json` and the root `package.json` (Node 24.19.0 per `tokens.css` header). No TAC section exists.

- `npm run typecheck --workspace @luuna/desktop`
- `npm run test --workspace @luuna/desktop`: includes the new `glide.test.ts`, `stickyScroll.test.ts` and `presentation.test.tsx`, plus the design-system and components lint.
- `npm run test --workspace @luuna/desktop -- src/ui/glide.test.ts src/ui/stickyScroll.test.ts src/ui/presentation.test.tsx`: a focused run of this change's tests.
- `npm run build`
- `git diff --exit-code -- apps/desktop/src/sessions/useSessionReplay.ts`: proves the parallel item's file is untouched.
- `git diff --check`
- Optional, when a browser and runtime are available: `node scripts/performance-ui-smoke.mjs` and `node scripts/mvp-ui-smoke.mjs`. Report actual results, or say they were not run.

## Notes

- None of these commands can establish that the glide, the caret or the text sharpness actually feel smooth in Windows WebView2. Report that as unproven until it is checked by hand in the Tauri app (`npm run tauri dev` in `apps/desktop`) on Windows, ideally at 100% and 150% scaling.
- Bounding the Pi response at `--scroll-max` (28rem) is a visible change: long responses now scroll inside their region instead of lengthening the page. This is required for following, and it matches the documented "Scroll region" contract.
- Risk: `contain: content` on `pre[aria-label]` also applies to plan, diff and log `CodeBlock`s. Nothing positioned lives inside them today; if a future popover is placed inside a region, revisit this.
- Risk: the tail caret uses `--tone-active-mark` directly in components.css. That is allowed only there by the lint; do not move the rule to a screen sheet.
- Follow-ups: a "Jump to latest" control when unpinned; opt-in following for the Projects event record and baseline logs; a WebView2 frame-time measurement harness.
