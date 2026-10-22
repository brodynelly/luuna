# ADR 0031: client frame pacing - coalesced presentation over the authoritative event stream

Date: 2026-10-22. Status: accepted. Builds on [ADR 0015](0015-bounded-runtime-and-history.md) (bounds unchanged), [ADR 0013](0013-desktop-design-system.md) (tokens) and [ADR 0029](0029-rust-terminal-workbench.md) (terminal renderer). Implementation status: the desktop transport and motion, the TUI frame clock with synchronized output, and the TUI eased scrolling (decision 4, last paragraph) are merged.

## Context

The architecture promises resumable SSE to the desktop, but the session view read cursor pages by polling, and `LuunaClient.streamEvents` was unused by it. Bursty streaming made the session view and the terminal repaint once per event, which stutters. The owner asked for smooth rendering in both clients. Neovide is the inspiration: presentation is paced by display frames and decoupled from when input or events arrive.

## Decision

1. **Arrival is decoupled from presentation.** Clients may coalesce display work so that at most one commit or draw happens per frame. Coalescing is display-only: stored client models, event lists and resume cursors are never dropped, merged or reordered. Every durable event received is applied in order; only the repaint is batched. The runtime still decides every state; clients only choose when to paint.
2. **Desktop live transport.** For a live (non-terminal) run the desktop consumes the existing resumable route `GET /api/v1/runs/{id}/stream?after=<cursor>` through `LuunaClient.streamEvents`, resuming from the last applied event ID (`apps/desktop/src/sessions/followSession.ts`). It falls back to the cursor-page reads (`eventPage`, `readEventPages`) when the stream is refused (capacity: the 16-stream SSE limit), fails, has a gap, or the run is settled; paging also repairs gaps. Records of one animation frame are applied as one batch (`frameCoalescer.ts`, `requestAnimationFrame` with a 16 ms timer where it is absent). No runtime, route, schema or catalog change. ADR 0015 bounds are unchanged: 200 live payloads or about 1 MiB display window, 1 Mi-character assistant text limit, on-demand historical pages, 16 SSE streams.
3. **Desktop motion stays DOM-based.** The live session list and Pi response keep scrolled to the newest content while the reader is within `--follow-threshold` of the bottom: new content glides there over about `--duration-follow` with a critically damped spring (`ui/glide.ts`, `ui/stickyScroll.ts`, `ui/useStickyScroll.ts`). Release is by user intent (wheel, pointer, touch, navigation keys), and returning near the bottom re-pins. The live assistant text carries a steady CSS-only tail caret that is not selected, copied or announced and is removed when the run is terminal. Durations and thresholds are tokens in `apps/desktop/src/design/tokens.css` (ADR 0013 point 3; recorded in `docs/DESIGN-SYSTEM.md`). `prefers-reduced-motion: reduce` sets the follow duration to 0 ms and jumps instead of easing. A canvas/WebGL renderer is rejected for now: it would break the DOM-reading browser smokes (`scripts/mvp-ui-smoke.mjs`, `scripts/m6-ui-smoke.mjs`, `scripts/performance-ui-smoke.mjs`, `scripts/windows-native-startup-smoke.mjs`), the accessibility audit and live regions, native text selection and copy, and the rendered contrast checks of ADR 0013.
4. **TUI frame clock** (`crates/luuna-tui`, ADR 0029). A dedicated input thread (`input.rs`) feeds an event-driven loop with a dirty flag (`frame.rs`, `FrameClock`): draw only when state changed or an animation is in flight, capped at 60 Hz by default (`LUUNA_TUI_FPS`, clamped to 30..144), with no redraws while idle. Each frame is wrapped in DEC private mode 2026 synchronized updates (`CSI ? 2026 h` ... `CSI ? 2026 l`, `terminal.rs`), opt-out with `LUUNA_TUI_SYNC=0` (also `false`, `off`, `no`); the end sequence is always attempted and terminals that ignore the mode are unaffected.

   Eased scrolling (`crates/luuna-tui/src/scroll.rs`, [specs/feature-tui-eased-scroll.md](../../specs/feature-tui-eased-scroll.md)): scrolling of output and detail panes eases over whole rows (no sub-cell rendering, about 120 ms) for jumps of more than one row, and a one-row move is instant. `LUUNA_TUI_ANIMATION=0` (also `off`, `false`, `no`) makes every move instant. The view follows new output only after the user pins it to the bottom (End, or a downward scroll that reaches the end), and any upward scroll releases it. Easing is display-only: the target offset is where the user asked to go, and the displayed offset is what is drawn.

## Alternatives considered

- **Canvas/WebGL renderer for the desktop:** rejected for the reasons in point 3.
- **Server-side delta batching in the runtime:** would change stream semantics and evidence granularity for a presentation concern, and would not reduce the TUI's draw cost.
- **Tauri IPC event forwarding through the Rust shell:** adds a second transport and a privileged forwarding path beside the authenticated loopback HTTP client, and would serve neither the TUI nor a browser client.

## Consequences

No runtime, schema or capability-catalog change; ADR 0015 bounds are unchanged. DOM smokes and the accessibility and contrast audits keep working. Motion adds tokens in both colour schemes per ADR 0013. The TUI stops redrawing while idle. SSE capacity exhaustion falls back to pages rather than failing. `docs/CURRENT-ARCHITECTURE.md` is updated to match.

## Validation and limits

Unit tests (frame-coalescing reducers, Ratatui `TestBackend`, jsdom/Vitest) prove ordering, no-loss and dirty-flag behaviour only. They do not prove real WebView or terminal frame timing; that needs measured runs on a real WebView (Tauri/Chromium) and a real terminal (ConPTY/tmux), reported separately like other platform evidence. A frontend build is not evidence of smoothness, and fixture or synthetic runs do not establish provider or other-platform behaviour.
