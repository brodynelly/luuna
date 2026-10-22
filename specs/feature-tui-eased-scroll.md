# Feature: Eased whole-row scrolling in the Rust terminal workbench

## Metadata

- Type: feature
- Source: user request; orchestration "Neovide-grade smooth, sharp rendering for desktop app and TUI", confirmed October 22
- Date: 2026-10-22
- Orchestration: run `smooth-render-20261022-0801`, wave 2, item T2
- Depends on: T1 `specs/feature-tui-frame-pacing.md` (frame scheduler with dirty/animating requests, ~60 Hz cap while active, App-level animation-frame hook). That spec was not written when this plan was drafted. Before starting, read it if it exists and use its real names. If it does not exist or does not name the hook, this plan depends only on the minimal interface in "Dependency contract" below.
- File ownership (from `.tac/runs/smooth-render-20261022-0801/work-items.md`): T2 owns `crates/luuna-tui/src/{app,ui}.rs` and `src/views/{mod,render}.rs`, plus the new `src/scroll.rs`. `src/lib.rs` changes by one line to export the module. `src/main.rs` (T1-owned) changes only to wire the hook and the motion setting.

## Feature Description

Scrolling in the terminal workbench now jumps instantly by whole lines. This feature separates the **target** scroll offset (where the user asked to go) from the **displayed** offset (what is drawn). On jumps of more than one row (PgUp/PgDn ±8, Home/End, following newly streamed output), the displayed offset moves toward the target in whole-row steps over about 120 ms with an exponential, critically damped ease. It always lands exactly on the target and never goes past the content clamp. Single-row moves stay instant. Terminal cells cannot be positioned at sub-row offsets, so whole-row steps per frame are the smoothest result available. An environment opt-out makes every move instant. Settled frames are the same as today's.

## User Story

As a Luuna developer reading long plans, event streams and records in the terminal, I want page jumps and tail-following to glide instead of snapping, so that I keep my place in the text. I also want to turn the motion off and still have exactly the same final screen.

## Solution Statement

Add a pure, clock-injected `scroll` module. It holds the easing function and a `ScrollState { target, displayed, ... }` that replaces `AppState.scroll: u16`. Key handlers change the target through `ScrollState` methods. Renderers call `ScrollState::clamp(max)`, which records the content bound and returns the displayed offset to draw. This replaces the current `scroll.min(max)` write-back in `ui.rs::render_result` and `views/render.rs::paragraph`. The T1 frame clock calls `AppState::tick(now)` once per frame and keeps scheduling frames while `AppState::animating()` is true. Domain and runtime state are untouched: this is display-only presentation state in the client, consistent with ADR 0029 ("Rust owns drawing").

One `ScrollState` is enough. Only one scrollable pane is visible at a time: Result output, an approval plan, or a workbench detail/collection body. Every pane change already resets scroll (`app.rs:265` `begin`/request start, `app.rs:597` F1 help, `views/mod.rs:226` `open`). Those resets become instant `ScrollState::reset()` calls, so motion never carries over between panes.

`AppState::default()` uses **instant** motion. All existing unit, snapshot and `TestBackend` tests therefore keep today's behavior without any clock. Only `main.rs` enables eased motion, through `ScrollMotion::from_env()`.

### Dependency contract (minimal T1 interface)

If T1 provides different names, use T1's and keep these semantics.

- `AppState::animating(&self) -> bool`: true while any display animation is still pending. In this feature that means `self.scroll.animating()`. The frame scheduler treats `true` as a request for another frame, capped at about 60 Hz. It treats `false` as idle (no busy redraw).
- `AppState::tick(&mut self, now: std::time::Instant)`: called once per frame **before** `terminal.draw(...)`. It advances `self.scroll`.
- After any key, paste or bridge event, T1 marks the frame dirty and draws. The first frame after a jump may draw before any tick. That is correct: the displayed offset has not moved yet.

If T1 has already added stub `tick`/`animating` methods to `app.rs`, fill them in. If not, add them in `app.rs` and add the two calls in `main.rs`'s loop: `app.tick(Instant::now())` before draw, and `app.animating()` passed to T1's scheduler (or, without T1, used to keep the existing poll timeout short).

## Out of Scope

- Sub-cell or pixel scrolling, terminal graphics protocols, and any grapheme or width changes (`wrapped_lines`, `cell_lines` and `safe_text` stay as they are).
- The frame scheduler itself, event-driven wake, DEC 2026 synchronized output and poll-interval changes (all T1). The only `main.rs` edits are the hook wiring and one motion-setting line.
- Animating catalog selection, form cursors, the workbench row cursor (`workbench.cursor`) or the menu. Only the scroll offset is eased.
- Horizontal scrolling, mouse-wheel input (not handled today) and new key bindings.
- Desktop app (D1/D2), docs/ADR updates (A1 owns `docs/`), runtime, protocol, bridge and schema changes.
- Any change to approval behavior: `approval_visible` stays size-based (`ui.rs:76`), and easing never gates or delays submit.

## Relevant Files

- `AGENTS.md`, `docs/decisions/0029-rust-terminal-workbench.md`, `docs/CURRENT-ARCHITECTURE.md`: boundaries. Rust owns drawing, clients only display authoritative state, and evidence claims stay limited (a `TestBackend` pass is not ConPTY/native proof).
- `.tac/runs/smooth-render-20261022-0801/{work-items.md,scout-tui.md}`: wave and file ownership, scout findings.
- `specs/feature-tui-frame-pacing.md` (T1, may not exist yet): the frame hook to wire.
- `crates/luuna-tui/src/scroll.rs` (new): `ScrollMotion`, the pure `step_toward` easing function, `ScrollState` and unit tests.
- `crates/luuna-tui/src/lib.rs`: add `pub mod scroll;`.
- `crates/luuna-tui/src/app.rs`:
  - `AppState.scroll: u16` (line 142, default line 171) becomes `ScrollState`.
  - Reset at line 265 (`begin`/request start) and in the F1 help branch (~597).
  - Result/prompt PgUp/PgDn ±8 (504-510).
  - Hash-prompt Up/Down/Home/End (512-528).
  - Result-mode Up/Down/Home/End (603-629).
  - Add `tick`, `animating` and `set_scroll_motion`.
- `crates/luuna-tui/src/ui.rs`:
  - `render_result` (232-260) clamps through `ScrollState::clamp` and skips by the returned displayed offset.
  - Unit tests at ~356-361 and ~380-411 use `app.scroll = u16::MAX` / `app.scroll < u16::MAX`; port them to the new API.
- `crates/luuna-tui/src/views/mod.rs`: `open` reset (226) and workbench key handling (588-611: Up/Down ±1, PgUp/PgDn ±8, Home/End).
- `crates/luuna-tui/src/views/render.rs`: `paragraph()` (223-241) takes `&mut ScrollState` instead of `scroll: u16 -> u16`. Update the call sites at lines 82, 126, 355, 435, 947 and 978.
- `crates/luuna-tui/src/main.rs` (T1-owned, wiring only): main loop (~101-133). Do not change `secret()`.
- `crates/luuna-tui/tests/workbench.rs`: add an integration test for eased settling against the instant frame. Existing snapshots in `tests/snapshots/*.txt` must stay byte-identical.
- `crates/luuna-tui/README.md`: document `LUUNA_TUI_ANIMATION` next to the existing environment variables (lines 15 and 73).

## Implementation Plan

### Foundation

Create `crates/luuna-tui/src/scroll.rs` with no dependencies beyond `std`:

```rust
pub const DEFAULT_SCROLL_DURATION: Duration = Duration::from_millis(120);
pub const FIRST_FRAME_HINT: Duration = Duration::from_millis(16);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScrollMotion { Instant, Eased(Duration) }

impl ScrollMotion {
    /// Pure parser for tests: None/unknown => Eased(DEFAULT); "0" | "off" | "false" | "no" (trimmed, ASCII case-insensitive) => Instant.
    pub fn from_env_value(value: Option<&str>) -> Self;
    /// Reads LUUNA_TUI_ANIMATION. Only main.rs calls this.
    pub fn from_env() -> Self;
}

/// One frame of exponential (critically damped, no overshoot) approach in whole rows.
/// tau == 0 or displayed == target => target. Otherwise
/// step = ceil(remaining * (1 - exp(-dt/tau))) clamped to 1..=remaining.
pub fn step_toward(displayed: u16, target: u16, dt: Duration, tau: Duration) -> u16;
```

`step_toward` guarantees:

- The result is between `displayed` and `target` inclusive: it is monotonic and never overshoots.
- Every call where `displayed != target` moves at least one row, so the animation finishes in at most `remaining` calls whatever the frame timing.
- It never panics: use `u32`/`f64` arithmetic and saturating conversion back to `u16`.

`tau = duration / 4`, so about 98% of the distance is covered by `duration`. The state machine snaps exactly at the deadline.

### Core

`ScrollState` (fields private, `Debug + Clone`, `Default` = instant motion and all offsets 0):

- Fields: `target: u16`, `displayed: u16`, `max: Option<u16>` (last content bound from render), `follow: bool`, `down_intent: bool`, `motion: ScrollMotion`, `started: Option<Instant>`, `last_tick: Option<Instant>`.
- `with_motion(ScrollMotion)` / `set_motion(ScrollMotion)`. Switching to `Instant` snaps `displayed = target`.
- `target()` and `displayed()` accessors.
- `reset()`: target = displayed = 0. Clears follow, intent and timers. Used for every pane change and new request (the old `scroll = 0` sites).
- `scroll_up(n)`: target = target.saturating_sub(n); follow = false; down_intent = false; then `retarget()`.
- `scroll_down(n)`: target = target.saturating_add(n); down_intent = true; then `retarget()`.
- `to_top()`: like `scroll_up(u16::MAX)`.
- `to_bottom()`: target = u16::MAX; follow = true; then `retarget()`.
- `retarget()` (private):
  - Work out the effective target, `target.min(max.unwrap_or(target))`.
  - Snap (`displayed = effective`, clear timers) if motion is `Instant`, `max` is `None`, or the distance between `displayed` and the effective target is at most 1. This keeps single-row moves instant.
  - Otherwise restart the animation from the current displayed offset (`started = None`, `last_tick = None`). A retarget mid-animation continues smoothly from where it is.
- `clamp(max: u16) -> u16` (called by renderers with the content bound for this frame):
  1. `self.max = Some(max)`.
  2. If `down_intent && target >= max`, set `follow = true`. Then clear `down_intent`.
  3. Set `target = if follow { max } else { target.min(max) }`. This matches today's write-back, so Up after End starts from the real bottom.
  4. Set `displayed = displayed.min(max)`. A content shrink or resize is a hard clamp and is never animated past the bound.
  5. If the remaining distance is at most 1, or motion is `Instant`, snap `displayed = target`. This lets one-row tail growth while following stay instant, and keeps instant mode identical to today.
  6. Otherwise leave the animation pending for `tick`.
  7. Return `displayed`.
- `tick(now: Instant)`:
  - If not animating, clear timers and return.
  - On the first tick, `started = now` and `dt = FIRST_FRAME_HINT`, so motion begins on the first frame. On later ticks, `dt = now - last_tick`.
  - If `now - started >= duration`, set `displayed = effective target` (exact landing). Otherwise `displayed = step_toward(displayed, effective, dt, duration / 4)`.
  - Set `last_tick = now`. Clear timers once landed.
- `animating() -> bool`: `motion != Instant && displayed != effective target`.

Follow semantics: the view follows new output only after the user pins it to the bottom, either with End or with a downward scroll that reaches or passes the end. Any upward move or reset unpins it. The initial and post-request state is **not** pinned. As a result, a read result that arrives in one chunk still shows its top, exactly as today, and new output while scrolled up never moves the view.

### Integration

1. `app.rs`:
   - Change the `scroll` field to `pub scroll: crate::scroll::ScrollState`. The default is instant.
   - Replace each mutation: `saturating_sub(n)` becomes `scroll_up(n)`, `saturating_add(n)` becomes `scroll_down(n)`, `= 0` on navigation/Home becomes `to_top()` (Home) or `reset()` (request start, F1), and `= u16::MAX` becomes `to_bottom()`.
   - Add `pub fn tick(&mut self, now: Instant)`, `pub fn animating(&self) -> bool` and `pub fn set_scroll_motion(&mut self, motion: ScrollMotion)`.
2. `views/mod.rs`:
   - `open()` calls `app.scroll.reset()`.
   - In the workbench key handler, the cursor logic is unchanged. Up/Down call `scroll_up(1)`/`scroll_down(1)`, PgUp/PgDn call `scroll_up(8)`/`scroll_down(8)`, Home calls `to_top()` and End calls `to_bottom()`.
3. `views/render.rs`:
   - `fn paragraph(frame, lines, area, scroll: &mut ScrollState, theme)` computes `max_scroll` exactly as today and uses `.scroll((scroll.clamp(max_scroll), 0))`. It returns nothing.
   - Update the six call sites from `app.scroll = paragraph(..., app.scroll, ...)` to `paragraph(..., &mut app.scroll, ...)`. The `Screen::Commands` call at line 82 now also clamps. That is harmless because the line count is 1 and `open()` resets on entry.
4. `ui.rs::render_result`:
   - Compute `maximum` as today and set `let shown = app.scroll.clamp(maximum);`.
   - Use `.skip(usize::from(shown))`.
   - Do not change `render_prompt` or `wrapped_lines`.
5. `main.rs` (wiring only):
   - After `AppState` is constructed, call `app.set_scroll_motion(ScrollMotion::from_env())`.
   - Call `app.tick(Instant::now())` before each draw.
   - Hand `app.animating()` to T1's scheduler, or, if T1 already calls an `animating`/`tick` hook, only add the motion line.
   - Change nothing else in `main.rs`.

## Step by Step Tasks

1. Run `git status` and `git log -1`. Confirm T1 has merged and read `specs/feature-tui-frame-pacing.md`. Record the real hook names. Any difference from this plan's names should only be a rename.
2. Create `crates/luuna-tui/src/scroll.rs` with `ScrollMotion`, `step_toward`, `ScrollState` and the constants exactly as specified. Add `pub mod scroll;` to `src/lib.rs`.
3. Add unit tests in `scroll.rs` (`#[cfg(test)]`, deterministic `Instant` base plus `Duration` offsets, no sleeping):
   1. `step_toward` for distances 2..=600 in both directions and `dt` in {0, 1, 8, 16, 33, 100, 500} ms: the result is between the endpoints, moves at least 1, and repeated calls reach the target in at most `distance` calls.
   2. `tau == 0` returns the target.
   3. Eased `scroll_down(8)` with `clamp(100)` and ticks every 16 ms: displayed is strictly increasing, never above 8, equals 8 exactly by `started + 120ms`, and `animating()` is then false.
   4. A single-row move is instant in eased mode.
   5. Instant motion: every operation sets displayed equal to the effective target with no tick.
   6. Shrink: while easing toward 80, `clamp(30)` gives displayed ≤ 30 and target 30, and later ticks never exceed 30.
   7. Follow: `to_bottom()` then `clamp(10)`, then `clamp(40)` eases to 40. After `scroll_up(1)`, a later `clamp(60)` leaves the target unchanged. A fresh `ScrollState` with content growth from `clamp(0)` to `clamp(50)` stays at 0.
   8. Retarget mid-animation continues from the current displayed offset without a backward step.
   9. `from_env_value`: None, "1" and "yes" give Eased(120ms); "0", "OFF", " false " and "no" give Instant.
4. Migrate `app.rs` (field, the reset sites at 265 and ~597, key handlers at 504-528 and 603-629, plus `tick`/`animating`/`set_scroll_motion`).
5. Migrate `views/mod.rs` (`open` at 226, key handler at 588-611).
6. Migrate `views/render.rs` (`paragraph` signature and its six call sites) and `ui.rs::render_result`. Port the `ui.rs` unit tests to `to_bottom()` and `scroll.target()`/`displayed()`. Keep their assertions equivalent.
7. Wire `main.rs` according to the Dependency contract (motion from env, tick before draw, animating to the scheduler).
8. Add `eased_scroll_settles_to_the_instant_frame` to `tests/workbench.rs`:
   1. Build two apps with identical long Result output (≥ 200 lines) and a 60x20 `TestBackend`.
   2. App A uses the default instant motion. App B uses `set_scroll_motion(ScrollMotion::Eased(DEFAULT_SCROLL_DURATION))`.
   3. Press PageDown three times, then End, then Home, then PageDown. After each key, draw. For B, also alternate `tick(base + k*16ms)` and draw until `!animating()`, with a 32-frame bound and an assertion that it terminates.
   4. Assert that each settled B frame text equals A's frame text.
   5. Assert that at least one intermediate B frame differs from both the previous settled frame and the final frame, which proves movement happened in between.
   6. Add a second case: press End on a streaming result, `append` 30 more lines, settle, and assert the last appended line is visible. Then press Up, append more lines, and assert the frame text is unchanged.
9. Document `LUUNA_TUI_ANIMATION=0` (instant scrolling; the default eases large jumps over about 120 ms, and settled output is identical) in `crates/luuna-tui/README.md`.
10. Run every Validation Command and fix failures. Confirm `git diff --stat -- crates/luuna-tui/tests/snapshots` is empty and `git status` shows only the intended files.

## Testing Strategy

- Unit (`src/scroll.rs`): the pure easing invariants (monotonic, no overshoot, termination, exact landing at the deadline), instant mode, the single-row rule, clamp after shrink/resize, follow and unpin, retargeting and env parsing. Everything uses an injected `Instant`, with no sleeping and no wall clock.
- Integration (`tests/workbench.rs`): settled eased frames equal instant frames cell for cell; intermediate frames exist; tail-follow versus scrolled-up behavior. Existing snapshot tests (`tests/snapshots/{home,missions,atlas,beacon}.txt`) and `ui.rs` tests (including `every_plan_line_is_reviewable_at_forty_by_twelve`) must pass unchanged in meaning.
- Terminal/ConPTY: `npm run test:tui-terminal` checks that the real binary still starts, resizes and restores the console with eased motion on by default. `npm run test:tui-smoke` drives the non-interactive script mode and is a regression check only: it does not exercise scrolling. Visual smoothness is not proven by these. Report it as an unexecuted manual check unless a person observes it in a real terminal.
- Edge cases: content that fits (max 0); `u16::MAX` targets before the first render (`max` None snaps); resize mid-animation; the pane changing mid-animation (reset is instant); a hash prompt Down at the last line; `MAX_OUTPUT` output; terminals smaller than 20x8 (no render, so `clamp` is not called and `tick` still terminates through `step_toward`'s minimum one-row progress toward the last known bound).

## Acceptance Criteria

- [ ] WHEN the user presses PgUp/PgDn/Home/End (a move of more than one row) with default settings, THE SYSTEM SHALL draw intermediate whole-row offsets and land exactly on the target within about 120 ms plus one frame, never drawing an offset beyond the clamp or past the target.
- [ ] WHEN the user presses Up/Down (one row), THE SYSTEM SHALL move the view on the next frame with no animation.
- [ ] WHEN the view is pinned to the bottom (End, or a downward scroll reaching the end) and new output arrives, THE SYSTEM SHALL follow to the new bottom, eased when the growth is more than one row.
- [ ] WHEN the user has scrolled up and new output arrives, THE SYSTEM SHALL keep the same visible rows.
- [ ] WHEN content shrinks or the terminal is resized during an animation, THE SYSTEM SHALL clamp the displayed offset to the new bound immediately and settle there.
- [ ] WHEN `LUUNA_TUI_ANIMATION` is `0`/`off`/`false`/`no`, THE SYSTEM SHALL apply every scroll move instantly.
- [ ] WHEN no animation is pending, `AppState::animating()` SHALL return false, so the T1 scheduler goes idle.
- [ ] `AppState::default()` is instant. Existing snapshot files are byte-identical, and every pre-existing test passes without depending on a clock.
- [ ] `step_toward` and `ScrollState` live in `src/scroll.rs` with the unit tests listed. No change to `wrapped_lines`, `cell_lines`, `safe_text` or unicode-width handling.
- [ ] Approval submission behavior and `approval_visible` are unchanged.

## Validation Commands

- `cargo fmt --all -- --check`
- `cargo clippy --locked -p luuna-tui --all-targets -- -D warnings`: the crate-scoped form of the CI convention (`.github/workflows/ci.yml:27`, `cargo clippy --locked --workspace --all-targets -- -D warnings`). Run the workspace form too if time allows.
- `cargo test --locked -p luuna-tui`: includes the new `scroll::tests` and `eased_scroll_settles_to_the_instant_frame`.
- `cargo test --locked -p luuna-tui scroll`: the focused check for this change.
- `git diff --exit-code -- crates/luuna-tui/tests/snapshots`: proves the settled snapshots are unchanged.
- `npm run test:tui-terminal`: real ConPTY start, resize and restore with eased motion on by default.
- `npm run test:tui-smoke`: script-mode regression (does not exercise scrolling; report it as such).

## Notes

- Intentional behavior change: today, after End, new streamed output does not follow (the stored offset is the old bottom). With this feature it follows. Pinning is explicit (End or scrolling down to the end), so one-shot read results and plan displays still open at the top as they do today.
- Exponential approach was chosen over a spring with velocity. It is critically damped (no overshoot), needs no velocity state, and with the one-row minimum step plus the deadline snap it terminates exactly. On a frame drop, the next tick covers more distance (dt-based) rather than slowing the motion.
- Interactive audits (`npm run test:tui-interactive-audit`) poll for screen predicates. A 120 ms ease should settle inside their waits, but if an audit step reads the screen right after a PgDn/End, set `LUUNA_TUI_ANIMATION=0` in that audit's environment rather than adding sleeps. Report it if done.
- conhost/ConPTY may redraw whole rows on each step. Six to eight frames of about 16 ms each per jump is bounded output. T1's DEC 2026 synchronized output reduces tearing where it is supported.
- No ADR is required for display-only presentation state. A1 records client frame pacing in `docs/`. Mention this feature to A1 if its ADR lists TUI motion settings.
- Evidence boundary: `TestBackend` and ConPTY tests prove the offsets are deterministic and that the terminal lifecycle works. They do not prove perceived smoothness on a given terminal or platform.
