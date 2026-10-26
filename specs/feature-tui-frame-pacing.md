# Feature: Event-driven frame pacing and synchronized output for the Rust terminal

## Metadata

- Type: feature
- Source: request; orchestration run `smooth-render-20261022-0801`
- Date: 2026-10-22
- Orchestration: wave 1, item T1. Wave 2 item T2 "eased scrolling" builds on the frame clock and animation hooks defined here (`FrameClock::request_animation_frame`, `AppState::animating`, `AppState::advance_animations`). Do not implement easing in T1.
- Depends on: integrated `specs/feature-rust-tui-foundation.md`, `specs/feature-rust-tui-workbench.md`, `specs/feature-rust-tui-launch-validation.md`; ADR 0029.

## Feature Description

`crates/luuna-tui` currently redraws unconditionally on every loop iteration (`src/main.rs` ~101-141), and the loop is paced by `event::poll(35ms)`. As a result, an idle workbench does about 28 full draws per second, and runtime events can take up to 35 ms to appear because a bridge event does not wake the loop. This feature applies the Neovide principle: a fixed frame clock that is independent of when events arrive. The loop blocks until terminal input, a bridge event, a frame deadline or the shutdown check wakes it. It drains all pending work, then draws at most once per frame interval and only when something changed or an animation is running. Each draw is wrapped in DEC 2026 synchronized output, so terminals that support it never show a half-painted frame.

## User Story

As a Luuna terminal user, I want the workbench to update immediately when the runtime reports something and to stay smooth and flicker-free, without using CPU while it sits idle.

## Solution Statement

Add three units and change `main.rs` to use them.

1. **`src/frame.rs` (new): pure `FrameClock`.** Every method takes `now: Instant` (an injected clock), so it is deterministic in tests. It tracks `dirty`, a one-shot animation request and `last_frame`. It computes the next deadline and enforces a minimum frame interval (default 60 Hz, configurable with `LUUNA_TUI_FPS`, clamped to 30..=144).
2. **`src/input.rs` (new): dedicated blocking input thread.** The thread runs `crossterm::event::poll` and `read`, and feeds a bounded `tokio::sync::mpsc` channel with `blocking_send`. Dropping the handle stops and joins the thread.
3. **`src/terminal.rs`: `draw_frame` helper.** It emits `BeginSynchronizedUpdate` (`ESC[?2026h`) before `Terminal::draw` and always emits `EndSynchronizedUpdate` (`ESC[?2026l`) afterwards, including when the draw fails. A thread-local "sync open" flag lets the panic hook and `TerminalGuard::drop` close an open update. `LUUNA_TUI_SYNC=0` turns synchronized output off.

`main.rs` replaces the poll/draw/yield loop with `tokio::select!` over input, `Bridge::recv`, the frame deadline and a shutdown check tick. The token prompt (`secret`) reuses the same input channel and redraws only when its value changes.

**Why an input thread instead of crossterm `EventStream`:** `EventStream` needs the crossterm `event-stream` feature. That changes the `crossterm` dependency list in `Cargo.lock` (it adds `futures-core`) and also needs a `StreamExt` provider, which is a new direct dependency (`futures-util` or `tokio-stream`). Internally, crossterm 0.28 `EventStream` also starts a waker thread for each pending poll. A dedicated thread:

- needs no feature, dependency or lockfile change, so `Cargo.toml` and `Cargo.lock` stay untouched and `cargo build --locked` holds;
- has explicit stop/join semantics, so input reading stops before `TerminalGuard` restores the terminal;
- can be shared by the token prompt and the main loop, so only one reader of crossterm's global event source exists.

The thread's own `event::poll` timeout (50 ms) only limits how quickly the thread notices the stop flag. Input is delivered as soon as it arrives, and the render loop never busy-polls.

## Out of Scope

- Eased or animated scrolling, or any animation (T2). T1 only adds the hooks, which default to "not animating".
- Changing `ui::render`, `views::render`, the theme, layouts, snapshots, the JSONL protocol, `bridge.rs` queue sizes, `packages/tui` or the Node bridge.
- Changing crossterm or ratatui versions or features, adding dependencies, or editing `Cargo.toml` or `Cargo.lock`.
- Mouse support, new key bindings, and changes to `Shutdown` signal/marker semantics (only how often the marker is checked changes, see Notes).
- Adding new `terminal.clear()` calls. Resize only marks the frame dirty; ratatui's own `autoresize` inside `draw` stays as it is.
- ADR or `docs/CURRENT-ARCHITECTURE.md` edits, and `.claude/experts/tui/expertise.yaml` updates. The orchestrator integrates these; Notes suggests the wording.
- Commits, pushes and branch management.

## Relevant Files

- `AGENTS.md`, `docs/decisions/0029-rust-terminal-workbench.md`, `.claude/experts/tui/expertise.yaml`: boundaries (Node bridge is the only runtime path, terminal restoration, bounded queues). Read these first.
- `crates/luuna-tui/Cargo.toml`: confirms ratatui `=0.29.0` (feature `crossterm`), crossterm `=0.28.1`, and tokio features `rt-multi-thread, sync, time, macros, signal` are already enough. **No change.**
- `Cargo.lock`: **must not change.** Verify with `git diff --exit-code Cargo.lock`.
- `crates/luuna-tui/src/lib.rs`: export the new `frame` and `input` modules.
- `crates/luuna-tui/src/frame.rs` (new): `FrameClock`, `fps_from`, `sync_from`, `DEFAULT_FPS`, `MIN_FPS`, `MAX_FPS`, and unit tests.
- `crates/luuna-tui/src/input.rs` (new): `Input` (thread handle and receiver), `INPUT_QUEUE`, `INPUT_POLL`.
- `crates/luuna-tui/src/terminal.rs`: add `draw_frame`, the thread-local sync flag, `close_sync`, sync-aware `TerminalGuard::drop` and `install_panic_restore`, and writer-capture tests. Existing `Shutdown`, `Screen` and `TerminalGuard::enter` behavior is unchanged.
- `crates/luuna-tui/src/app.rs`: add `AppState::animating(&self) -> bool` (returns `false`) and `AppState::advance_animations(&mut self, _dt: Duration)` (no-op). These are the T2 extension points; no other changes.
- `crates/luuna-tui/src/main.rs`: rewrite the loop at ~101-141 and `secret` at ~144-188 around select, the clock, `draw_frame` and `Input`.
- `crates/luuna-tui/src/bridge.rs`: read only. Use the existing `Bridge::recv` (async) and `try_recv`; `QUEUE_SIZE` (32) from `protocol.rs` stays.
- `crates/luuna-tui/tests/terminal_lifecycle.rs`: must stay green. It scans raw PTY bytes with `contains`, and the inserted `?2026h/l` sequences do not break the substring checks for `start-session`, `doctor`, `Service token (hidden)`, `?1049h/l` or `?25h`. Add the optional idle check described in task 9.
- `crates/luuna-tui/tests/workbench.rs`, `tests/snapshots/*.txt`, and `src/ui.rs` tests (~324-400): use `TestBackend` directly. They must stay byte-identical, so do not regenerate snapshots.
- `crates/luuna-tui/tests/bridge_process.rs`: unchanged and must stay green.
- `scripts/tui-terminal.mjs`: its VT model (`TerminalScreen`, private-mode handling ~127-136) already ignores unknown private modes such as 2026. Read only.
- `scripts/tui-terminal.test.mjs`, `scripts/tui-smoke.mjs`, `scripts/tui-native-audit.mjs`, `packages/tui/src/native.mjs`: timing consumers. Their timeouts (30 ms/50 ms polling with 8-15 s limits, `shutdownMs = 3000`) remain valid; see Notes. No change.
- `crates/luuna-tui/README.md`: document `LUUNA_TUI_FPS`, `LUUNA_TUI_SYNC` and the render cadence.

## Implementation Plan

### Foundation

Record `git status` and the baseline commit. Confirm `cargo test --locked -p luuna-tui` passes before any change, and record any pre-existing failures separately.

`src/frame.rs` public API. Adjust names only if clippy requires it, and keep these semantics:

```rust
pub const DEFAULT_FPS: u32 = 60;
pub const MIN_FPS: u32 = 30;
pub const MAX_FPS: u32 = 144;
/// None, empty, unparsable or zero -> DEFAULT_FPS; otherwise clamp(MIN_FPS, MAX_FPS).
pub fn fps_from(value: Option<&str>) -> u32;
/// Synchronized output default on; "0", "false", "off", "no" (trimmed, ASCII case-insensitive) disable it.
pub fn sync_from(value: Option<&str>) -> bool;

pub struct FrameClock { interval: Duration, dirty: bool, animation_requested: bool, last_frame: Option<Instant> }
impl FrameClock {
    pub fn new(fps: u32) -> Self;            // interval = 1s / fps.clamp(MIN_FPS, MAX_FPS) (nanosecond precision)
    pub fn from_env() -> Self;               // new(fps_from(env LUUNA_TUI_FPS))
    pub fn interval(&self) -> Duration;
    pub fn mark_dirty(&mut self);
    pub fn is_dirty(&self) -> bool;
    /// One-shot, like requestAnimationFrame: schedules exactly one more frame at cadence.
    /// Animators (T2) must re-request every frame while they animate.
    pub fn request_animation_frame(&mut self);
    /// None when neither dirty nor animation requested (idle: block indefinitely).
    /// Otherwise Some(max(now, last_frame + interval)); Some(now) if no frame has been drawn.
    pub fn next_deadline(&self, now: Instant) -> Option<Instant>;
    pub fn should_draw(&self, now: Instant) -> bool;   // next_deadline(now).is_some_and(|d| d <= now)
    /// Time since the previous frame, clamped to at most 4 * interval (Duration::ZERO for the first frame),
    /// for T2 easing via AppState::advance_animations. Does not mutate.
    pub fn frame_delta(&self, now: Instant) -> Duration;
    /// Record a completed frame: clears dirty and the animation request, sets last_frame = now.
    pub fn frame_drawn(&mut self, now: Instant);
}
```

`src/input.rs`:

```rust
pub const INPUT_QUEUE: usize = 64;
pub const INPUT_POLL: Duration = Duration::from_millis(50); // stop-flag responsiveness only
pub struct Input { receiver: tokio::sync::mpsc::Receiver<io::Result<crossterm::event::Event>>, stop: Arc<AtomicBool>, thread: Option<std::thread::JoinHandle<()>> }
impl Input {
    pub fn spawn() -> io::Result<Self>;      // std::thread::Builder::new().name("luuna-tui-input")
    pub async fn recv(&mut self) -> Option<io::Result<Event>>;
    pub fn try_recv(&mut self) -> Option<io::Result<Event>>;
}
impl Drop for Input { /* stop.store(true); join the thread (it exits within INPUT_POLL) */ }
```

The thread loops as follows. If `stop` is set, it exits. Otherwise it calls `event::poll(INPUT_POLL)`:

- `Ok(true)`: call `event::read()`. Forward only `Key` events whose kind is not `Release`, plus `Paste` and `Resize`. Drop everything else (mouse, focus, release) so it never wakes the loop. Forward with `blocking_send`; if that fails, the receiver is gone, so exit.
- An `Err` from either call: send it once, then exit.

Bounded `blocking_send` provides backpressure. Crossterm's global event reader must have only this one consumer: after `Input::spawn`, `main.rs` must not call `event::poll` or `event::read` on any path.

### Core

In `terminal.rs`, add the synchronized draw helper:

```rust
thread_local! { static SYNC_OPEN: Cell<bool> = const { Cell::new(false) }; }
pub fn draw_frame<W: Write>(terminal: &mut Terminal<CrosstermBackend<W>>, sync: bool,
                            render: impl FnOnce(&mut ratatui::Frame)) -> io::Result<()>;
```

`draw_frame` works as follows:

1. If `sync`, `queue!(terminal.backend_mut(), BeginSynchronizedUpdate)?` and set `SYNC_OPEN` to true.
2. `let drawn = terminal.draw(render).map(|_| ());`
3. If `sync`, `let ended = execute!(terminal.backend_mut(), EndSynchronizedUpdate);` and clear `SYNC_OPEN` regardless of the result. Return `drawn.and(ended)`, so a draw error wins but End is always attempted.

`TerminalGuard::drop` and the hook from `install_panic_restore` first call `close_sync(&mut io::stdout())`. This private helper writes `EndSynchronizedUpdate` only if `SYNC_OPEN` is true, then clears the flag. With sync disabled, or between frames, no `?2026` bytes are written during restoration. A panic inside the render closure therefore leaves the terminal neither frozen in a synchronized update nor in raw mode or the alternate screen. The existing restore order stays the same, with `close_sync` added at the front.

Crossterm 0.28.1's `BeginSynchronizedUpdate` and `EndSynchronizedUpdate` are a no-op `Ok(())` on the legacy WinAPI path and plain ANSI elsewhere. Terminals without DEC 2026 support ignore the private mode, which is what makes the feature harmless where unsupported.

### Integration

`main.rs`, in this order after `Shutdown::install()`:

1. `TerminalGuard::enter()`
2. `guard.screen()`
3. `let mut input = Input::spawn()?;`
4. `let sync = sync_from(env LUUNA_TUI_SYNC)`
5. `let mut clock = FrameClock::from_env();`

Pass `&mut input`, `sync` and the shutdown reference into `secret`. Before the `run()` return path drops `guard`, it must drop `input`, then `terminal`, then `guard`. Because `Input`'s `Drop` stops and joins the thread, no terminal input is consumed after restoration. Declare `input` after `guard` so reverse drop order also holds on early `?` returns.

Main loop (replaces ~101-141):

```text
clock.mark_dirty(); bridge_open = true
shutdown_tick = tokio::time::interval(SHUTDOWN_POLL = 100ms), MissedTickBehavior::Delay
loop {
  if shutdown.requested() -> break Ok(0)
  flush app.queue to bridge.send exactly as today (on error: app.transport_failed; break inner); mark_dirty if anything was popped
  if app.bridge_failed && !transport_stopped { bridge.shutdown().await; transport_stopped = true; mark_dirty }
  if app.animating() { clock.request_animation_frame() }
  now = Instant::now()
  if clock.should_draw(now) {
      app.advance_animations(clock.frame_delta(now))
      draw_frame(&mut terminal, sync, |f| ui::render(f, &mut app, theme))   // on Err break Err
      clock.frame_drawn(now)
      if app.animating() { clock.request_animation_frame() }   // frame_drawn clears the request
  }
  if app.quit -> break Ok(0)
  deadline = clock.next_deadline(Instant::now())
  tokio::select! {
    biased;
    event = input.recv() => match event {
        Some(Ok(e)) => { handle(e); then drain input.try_recv() up to INPUT_QUEUE more, handling each }
        Some(Err(e)) => break Err(e),
        None => break Err(io::Error::other("Terminal input closed")),
    },
    event = bridge.recv(), if bridge_open && !transport_stopped => match event {
        Some(r) => { apply(r); then drain bridge.try_recv() up to QUEUE_SIZE more (same Ok/Err handling as today) ; mark_dirty }
        None => { bridge_open = false; if !app.bridge_failed { app.transport_failed("Bridge event channel closed. Inspect runtime state before retrying an in-flight mutation.") }; mark_dirty }
    },
    _ = sleep_until(deadline), if deadline.is_some() => {}
    _ = shutdown_tick.tick() => {}
  }
}
```

The handler for each input event:

- `Key` → `app.key(key)` and `mark_dirty`
- `Paste(text)` → `app.paste(&text)` and `mark_dirty`
- `Resize(..)` → `mark_dirty` only

Notes on this loop:

- Use `tokio::time::Instant::from_std` for `sleep_until`.
- The deadline and shutdown-tick branches never mark dirty, so an idle loop wakes only for the shutdown check and never draws.
- Drawing is checked at the top of every iteration, so a constant bridge stream cannot starve rendering. Draws happen whenever the deadline has passed, whichever branch woke the loop.
- `biased` input-first order plus per-wake drain caps keep keyboard input responsive under bridge load. That was the purpose of the old 32-event cap.
- Several wakes within one interval only accumulate state, then produce one draw. This is the coalescing behavior.
- Remove `tokio::task::yield_now()`.

`secret` (~144-188) becomes `async fn secret(terminal, theme, shutdown, input: &mut Input, sync: bool, clock: &mut FrameClock)`. It keeps the same text, keys and limits (8192 bytes, `safe_text` on paste, single-line paste only, Esc and Ctrl+C cancel, Enter on a non-empty value connects). It draws through `draw_frame` only when dirty (initially, and after each handled key, paste or resize). It waits with `select!` over `input.recv()`, `sleep_until(deadline)` and a 100 ms shutdown tick, and the shutdown check returns `Ok(None)` exactly as today. The old 35 ms poll+draw loop is removed.

## Step by Step Tasks

1. Read `AGENTS.md`, ADR 0029, `.claude/experts/tui/expertise.yaml` and the three `specs/feature-rust-tui-*.md`. Run `git status`, then run `cargo test --locked -p luuna-tui` as a baseline and record the result.
2. Create `crates/luuna-tui/src/frame.rs` with the API above and export `pub mod frame;` from `src/lib.rs`.
3. Add unit tests in `frame.rs` (`#[cfg(test)]`, base `let t0 = Instant::now();`, offsets only, no sleeping):
   - `idle_clock_never_schedules`: a new clock that has drawn once and is not dirty gives `next_deadline(t0 + 10s) == None` and `!should_draw`.
   - `first_dirty_frame_draws_immediately`: a new clock plus `mark_dirty` → `should_draw(t0)`.
   - `burst_within_interval_coalesces_to_one_frame`: frame at t0; `mark_dirty` 20 times at t0+1..t0+15 ms. `should_draw` is false for every t < t0+interval, true exactly at `t0 + interval`; after `frame_drawn`, `next_deadline == None`.
   - `animation_frames_follow_cadence`: request a frame each iteration and simulate 1 s at 1 ms steps, drawing whenever `should_draw`. The number of frames is `fps` (±1), and consecutive frames are never less than `interval` apart.
   - `animation_request_is_one_shot`: after `frame_drawn`, with no new request, the deadline is `None`.
   - `cap_respected_under_dirty_storm`: `mark_dirty` before every 1 ms step for 1 s gives at most `fps + 1` frames.
   - `fps_env_parsing`: `fps_from(None|Some("")|Some("abc")|Some("0")) == 60`; `"10" → 30`, `"1000" → 144`, `"120" → 120`, `" 90 " → 90` (trimmed).
   - `sync_env_parsing`: defaults true; `"0"`, `"false"`, `"OFF"`, `"no"` give false; `"1"` and `"yes"` give true.
   - `frame_delta_is_clamped`: ZERO before the first frame; `4 * interval` after a 10 s gap.
4. Create `crates/luuna-tui/src/input.rs` (`Input`, `INPUT_QUEUE`, `INPUT_POLL`, filtering, `Drop` stop+join) and export `pub mod input;`. Document in a module comment that it is the sole crossterm event consumer and why the thread was chosen over `EventStream` (no lockfile change).
5. In `src/terminal.rs`, add `draw_frame`, `SYNC_OPEN`, `close_sync`, and call `close_sync` from `TerminalGuard::drop` and the panic hook. Add tests in `terminal.rs` using `Terminal::with_options(CrosstermBackend::new(writer), TerminalOptions { viewport: Viewport::Fixed(Rect::new(0, 0, 12, 3)) })`. A fixed viewport means no real terminal size query, so the tests run without a TTY.
   - `synchronized_draw_brackets_output`: with `sync=true`, render a `Paragraph::new("frame-pacing")`. The captured bytes contain exactly one `\x1b[?2026h` and one `\x1b[?2026l`, in that order, and the `frame-pacing` cells appear between them.
   - `sync_opt_out_emits_no_2026`: with `sync=false`, neither sequence appears and the text is still rendered.
   - `end_is_emitted_when_draw_fails`: a test `Write` writes fail while an `fail: Rc<Cell<bool>>` flag is set, and the flag is cleared after the first failure. `draw_frame` returns `Err`, the captured bytes end with `\x1b[?2026l`, and `SYNC_OPEN` is false.
   - `close_sync_writes_only_when_open`: `close_sync` into a `Vec<u8>` writes nothing when the flag is closed. After the flag is set (test-only setter or a `draw_frame` with a panicking closure inside `catch_unwind`), it writes `\x1b[?2026l` once and clears the flag.
6. In `src/app.rs`, add `pub fn animating(&self) -> bool { false }` and `pub fn advance_animations(&mut self, _dt: std::time::Duration) {}`. Doc comments must name them as the frame-clock hooks for T2 eased scrolling. Make no other change to `AppState`.
7. Rewrite the `main.rs` loop and `secret` as described in Integration:
   - remove every `event::poll` / `event::read` and the `Duration::from_millis(35)` uses;
   - keep the `Bridge::spawn`, `token.clear()`, `bridge.shutdown().await`, `drop(terminal)` and `drop(guard)` sequencing, with `input` dropped before `terminal` and `guard`;
   - add `const SHUTDOWN_POLL: Duration = Duration::from_millis(100);`.
8. Update `crates/luuna-tui/README.md` with a short "Rendering" section:
   - frames are event-driven, capped at `LUUNA_TUI_FPS` (default 60, range 30-144), with zero redraws when idle;
   - DEC 2026 synchronized output is on by default and turned off with `LUUNA_TUI_SYNC=0`;
   - the input thread exists, and shutdown-marker latency is ≤100 ms.
9. Optional real-binary idle evidence: report it if done, and do not weaken an existing assertion to add it. In `tests/terminal_lifecycle.rs`, after the catalog is visible and before the arrow, resize and quit input, wait 300 ms to settle, record the captured length, wait 1 s, and count `\x1b[?2026h` in the new bytes.
   - Assert ≤ 3. This tolerance allows bridge health/connection updates, which arrive about every 2 s.
   - Only assert when the stream contains any `?2026h` at all, because ConPTY may consume private modes. When it contains none, print `idle frame check skipped: ?2026 not passed through by this PTY` via `eprintln!` so the omission is visible in `--nocapture` output.
10. Run the Validation Commands. Fix failures introduced by this change and report unrelated baseline failures separately. Confirm `git diff --exit-code Cargo.lock` and that `tests/snapshots/` has no diff. Run `git status` at the end.

## Testing Strategy

- **Unit (`frame.rs`):** idle → no frame; a burst of events within one interval → exactly one frame; animation → frames at cadence; the frame cap holds under a dirty storm; animation requests are one-shot; environment parsing and bounds; delta clamping. All use an injected `Instant`, with no sleeps and no flakiness.
- **Unit (`terminal.rs`):** writer-capture backend proves the `?2026h` … content … `?2026l` ordering, the opt-out, End on a draw error, and `close_sync` restore behavior.
- **Unchanged rendering:** `src/ui.rs` tests and `tests/workbench.rs` snapshots run unmodified. Byte-identical snapshots show that `ui::render` output did not change.
- **Process/PTY:** `tests/terminal_lifecycle.rs` covers the real binary through portable-pty:
  - the catalog appears after an F2 keypress (proving input-thread delivery and an event-driven redraw);
  - resize, arrow keys, quit and the shutdown marker work;
  - the hidden-token prompt and marker cancellation work (proving the async `secret` path and the 100 ms marker tick);
  - restoration sequences are present and the owned bridge stops.

  `tests/bridge_process.rs` stays as it is.
- **Node:** `npm run test:tui-terminal` (VT model and ConPTY driver) and `npm run test:tui-smoke` (command-mode parity against a built runtime). Neither exercises the Rust render loop. State that explicitly in the report rather than counting them as render evidence.
- **Edge cases:**
  - bridge channel closed → no hot loop, the branch is disabled and a failure is shown;
  - transport stopped → the branch is disabled;
  - an input error ends the loop with terminal restoration;
  - a resize storm → one frame per interval;
  - a panic during render → `?2026l`, then the existing restore sequence;
  - `LUUNA_TUI_FPS` out of range is clamped;
  - `NO_COLOR` is unaffected.

## Acceptance Criteria

- [ ] WHEN no input, bridge event or animation request occurs, THE SYSTEM SHALL perform zero draws and SHALL block in `select!`. Its only wake-ups are the 100 ms shutdown check, which never draws.
- [ ] WHEN a bridge event arrives while idle and the last frame is older than one interval, THE SYSTEM SHALL wake immediately and draw on that wake, without the former ≤35 ms polling latency.
- [ ] WHEN multiple input or bridge events arrive within one frame interval, THE SYSTEM SHALL apply all of them and render one coalesced frame. Draws are never closer together than `1s / clamp(LUUNA_TUI_FPS, 30, 144)` (default 60 Hz).
- [ ] WHEN `AppState::animating()` returns true, THE SYSTEM SHALL request frames at the clock cadence and call `advance_animations(dt)` before each draw. T1's default implementation never animates.
- [ ] WHEN synchronized output is enabled (default), THE SYSTEM SHALL wrap every draw, including the token prompt, in exactly one `ESC[?2026h` / `ESC[?2026l` pair. It SHALL emit the End sequence on draw errors and on panic or guard restoration if an update is open. WHEN `LUUNA_TUI_SYNC=0`, it SHALL emit no `?2026` bytes.
- [ ] WHEN the terminal is resized, THE SYSTEM SHALL mark the frame dirty and redraw without any added `terminal.clear()`.
- [ ] The secret prompt keeps its existing keys, limits, `safe_text` paste handling and shutdown cancellation; the token never appears in output.
- [ ] `TerminalGuard` restoration (`?2004l`, `?25h`, `?1049l`, raw mode) holds on quit, Ctrl-C, the shutdown marker, errors and panics. The input thread is joined before the guard is dropped.
- [ ] The Node bridge remains the only runtime path; `QUEUE_SIZE`/`MAX_FRAME` bounds and per-wake drain caps are preserved; `bridge.rs`, `protocol.rs` and `ui.rs` rendering are unchanged.
- [ ] `Cargo.toml` and `Cargo.lock` are unchanged, and `cargo build --locked -p luuna-tui` passes.
- [ ] The snapshot files in `crates/luuna-tui/tests/snapshots/` are byte-identical and existing tests pass. The new `frame` and `terminal` unit tests pass.

## Validation Commands

The commands follow CI (`.github/workflows`: `cargo fmt --all -- --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings`), `package.json` scripts and ADR 0029, scoped to the crate.

- `cargo fmt -p luuna-tui -- --check`
- `cargo clippy --locked -p luuna-tui --all-targets -- -D warnings`
- `cargo build --locked -p luuna-tui`
- `git diff --exit-code -- Cargo.lock crates/luuna-tui/Cargo.toml crates/luuna-tui/tests/snapshots` (no lockfile, manifest or snapshot change)
- `cargo test --locked -p luuna-tui --lib frame` (new scheduler tests)
- `cargo test --locked -p luuna-tui --lib terminal` (new DEC 2026 writer-capture tests)
- `cargo test --locked -p luuna-tui`
- `cargo test --locked -p luuna-tui --test workbench` (snapshot byte-identity)
- `cargo test --locked -p luuna-tui --test terminal_lifecycle -- --nocapture` (real PTY: event-driven wake, secret prompt, marker, restoration; shows the idle-check note)
- `cargo test --locked -p luuna-tui --test bridge_process`
- `npm run test:tui-terminal`
- `npm run test:tui-smoke` (builds `luuna-runtime` with `cargo build --locked`; command-mode evidence only)
- `git diff --check`
- Recommended native evidence on Windows when a runtime build and components checkout are available: `npm run test:tui-interactive-audit -- --runtime target/debug/luuna-runtime.exe --components-root . --out "$env:TEMP/luuna-frame-pacing-<timestamp>"` (PowerShell). If it cannot be run, report it as not executed.

## Notes

- **Timing assumptions checked:**
  - `tests/terminal_lifecycle.rs` polls captured bytes every 30 ms with 12 s and 8 s limits, and re-sends F2 every 150 ms until the catalog appears.
  - `scripts/tui-native-audit.mjs` `screenContains` waits up to 15 s.
  - `scripts/tui-terminal.test.mjs` waits up to 100×50 ms.

  All of these only need the screen to settle eventually. Frames now arrive sooner (≤ 1 interval after an event instead of ≤ 35 ms plus a draw), so they stay valid. The real risk is a state change that forgets to mark the frame dirty, which shows up as a stale screen and a timeout in these tests. The rule "every handled input or bridge wake marks dirty" is deliberately coarse to avoid that.
- **Shutdown marker latency** rises from about 35 ms to ≤100 ms (`SHUTDOWN_POLL`), still far inside the launcher's `shutdownMs = 3000` in `packages/tui/src/native.mjs`. OS signals go through the same tick. An optional later improvement is to make `Shutdown` expose a `tokio::sync::Notify` for immediate signal wakes. That is out of scope here because it changes `Shutdown`.
- **DEC 2026 on Windows:** ConPTY or older consoles may consume or ignore `?2026`, and crossterm's WinAPI path is a no-op. The VT model in `scripts/tui-terminal.mjs` ignores unknown private modes. Synchronized output is a smoothness improvement, not a correctness dependency.
- **Ratatui `autoresize`** inside `Terminal::draw` still clears and resizes its buffers after a size change. That now happens inside the synchronized update, which removes resize flicker on supporting terminals.
- **For T2:** call `clock.request_animation_frame()` indirectly by returning `true` from `AppState::animating()` while a scroll animation is in flight, and advance the easing state in `AppState::advance_animations(dt)`. `dt` is clamped to 4 intervals so a stalled frame does not jump. T2 must not draw outside `draw_frame` or add timers to the loop.
- **Suggested orchestrator follow-ups** (not part of T1 implementation):
  - add a one-paragraph ADR 0029 amendment, or a line in `docs/CURRENT-ARCHITECTURE.md`, recording the event-driven render loop, frame cap and `LUUNA_TUI_FPS`/`LUUNA_TUI_SYNC`;
  - refresh `.claude/experts/tui/expertise.yaml` with the `frame.rs` and `input.rs` key symbols.
- No fixture or PTY result establishes real-provider behavior or another platform's terminal behavior. Report the PTY/ConPTY used.
