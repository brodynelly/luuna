# Chore: ADR 0031 client frame pacing and the desktop streaming correction

## Metadata

- Type: chore
- Source: user request (smooth rendering for the desktop and terminal clients), October 22
- Date: 2026-10-22
- Orchestration: run `smooth-render-20261022-0801`, wave 1, item A1 (documentation decision that the later desktop and TUI rendering items implement)

## Chore Description

Record one architecture decision, ADR 0031, that governs how both clients present the runtime's authoritative event stream smoothly, and make the minimal matching corrections to `docs/CURRENT-ARCHITECTURE.md`. This is a documentation-only change: no source, schema, runtime route, catalog entry or test changes.

Why: `docs/CURRENT-ARCHITECTURE.md` currently says the desktop talks to the runtime over "authenticated HTTP + resumable SSE" (line 39) and lists "streamed state" as the desktop integration proof (line 137), while the desktop session view actually polls cursor pages (`apps/desktop/src/sessions/useSessionReplay.ts` and `apps/desktop/src/sessions/EventList.tsx` call `client.eventPage(...)`; `LuunaClient.streamEvents` in `packages/api-client/src/index.ts` exists but the desktop does not use it). This run makes the desktop consume the existing SSE route with cursor-page fallback, and adds frame pacing to both clients. AGENTS.md requires material architecture changes to be recorded in an ADR and the current architecture updated; this item does that before the implementation items land.

ADR 0031 must record, as decided (not as proposals):

1. **Arrival is decoupled from presentation** (inspired by Neovide's frame-paced renderer). Clients may coalesce display work so that at most one commit/draw happens per frame. Coalescing is display-only: the stored client model, event lists and resume cursors are never dropped, merged or reordered; every durable event received is applied in order, only the repaint is batched.
2. **Desktop live transport.** For a live (non-terminal) run the desktop consumes the existing resumable SSE route `GET /api/v1/runs/{id}/stream?after=<cursor>` through `LuunaClient.streamEvents`, resuming from the last applied event ID, and falls back to the existing cursor-page reads (`eventPage` / `readEventPages`) when the stream is refused (capacity, the 16-stream SSE limit), fails, or the run is settled. No runtime, route, schema or catalog change. ADR 0015 bounds are unchanged (200 live payloads / about 1 MiB display window, 1 Mi-character assistant text limit, on-demand historical pages, 16 SSE streams).
3. **Desktop motion stays DOM-based.** Sticky-bottom scrolling with eased catch-up (it releases when the user scrolls up and re-engages at the bottom) and a streaming-tail indicator on the live assistant text. Durations and easing come from tokens in `apps/desktop/src/design/tokens.css` (ADR 0013 point 3); `prefers-reduced-motion: reduce` disables easing and animation and jumps instead. A canvas/WebGL renderer is rejected for now because it would break the DOM-reading browser smokes (`scripts/mvp-ui-smoke.mjs`, `scripts/m6-ui-smoke.mjs`, `scripts/performance-ui-smoke.mjs`, `scripts/windows-native-startup-smoke.mjs`), the accessibility audit and live regions, native text selection/copy, and the rendered contrast checks of ADR 0013.
4. **TUI frame clock** (`crates/luuna-tui`, ADR 0029). An event-driven loop with a dirty flag: draw only when state changed or an animation is in flight, capped at about 60 Hz, with zero redraws while idle. Each frame is wrapped in DEC private mode 2026 synchronized updates (`CSI ? 2026 h` ... `CSI ? 2026 l`) with an environment-variable opt-out; terminals that ignore the mode are unaffected. Scrolling of output/event panes eases over whole rows (no sub-cell rendering) with its own opt-out, and jumps when disabled.
5. **Validation limits.** Unit tests (frame-coalescing reducers, Ratatui `TestBackend`, jsdom/Vitest) prove ordering, no-loss and dirty-flag behaviour only. They do not prove real WebView or terminal frame timing; that requires measured runs on a real WebView (Tauri/Chromium) and a real terminal (ConPTY/tmux), reported separately like other platform evidence. A frontend build is not evidence of smoothness.
6. **Alternatives considered and rejected:** canvas/WebGL renderer (point 3 reasons); server-side delta batching in the runtime (would change runtime/stream semantics and evidence granularity for a presentation concern, and would not help the TUI's draw cost); Tauri IPC event forwarding through the Rust shell (adds a second transport and a privileged forwarding path beside the authenticated loopback HTTP client, and would not serve the TUI or a browser client).

## Out of Scope

- Any code: desktop SSE consumption, coalescing hooks, motion CSS/tokens, TUI frame clock, DEC 2026 or eased scrolling. Those are later items of this orchestration run.
- Runtime, `schemas/`, `schemas/capability-catalog.json`, `packages/api-client` changes, and any change to ADR 0015 bounds.
- Editing earlier ADRs (0013, 0015, 0029, 0030): ADR 0031 references them, it does not amend their text. Historical documents (`VALIDATION-REPORT.md`, `docs/FOUNDATION-STATUS.md`, `AI-START-HERE.md`, `docs/RELEASE-EVIDENCE.md`, `docs/HIG-REVIEW-2026-10-22.md`) are not edited. `VALIDATION-REPORT.md` must not change.
- The milestone table row at `docs/CURRENT-ARCHITECTURE.md` line 137 ("Desktop integration | Real service connection, run actions, streamed state and reconnection | ...") stays as written: it is a required-proof criterion, and this document change does not establish it.
- Commits, pushes, branches. The orchestrator integrates.

## Relevant Files

- `AGENTS.md`, `docs/CURRENT-ARCHITECTURE.md`, `docs/decisions/0013-desktop-design-system.md`, `docs/decisions/0015-bounded-runtime-and-history.md`, `docs/decisions/0029-rust-terminal-workbench.md`, `docs/decisions/0030-desktop-shell-and-tailwind.md` - read first; ADR 0031 cites them.
- `docs/decisions/0031-client-frame-pacing.md` - **new**; the decision record.
- `docs/CURRENT-ARCHITECTURE.md` - modify minimally: the delivery paragraph near lines 29-34, the diagram at line 39, the client rendering paragraph at line 49 and the terminal paragraph at lines 55-61.
- `apps/desktop/src/sessions/useSessionReplay.ts`, `apps/desktop/src/sessions/EventList.tsx`, `packages/api-client/src/index.ts` (`streamEvents`, `eventPage`, `readEventPages`) - read only, to name the real symbols correctly.
- `docs/decisions/` has no index file (no README); `README.md` line 31 links the directory generically. No index update is needed; do not create one.
- `specs/` - read only: if sibling specs of run `smooth-render-20261022-0801` already define exact TUI opt-out variable names, use those names in the ADR; otherwise describe them as "an environment-variable opt-out" without inventing names.

## Step by Step Tasks

1. Run `git -C C:/Users/localhost/github/luuna status --short` and record it; preserve any existing user changes.
2. Read the files listed under Relevant Files. Confirm `docs/decisions/0031-*` does not already exist (`git ls-files docs/decisions`). If 0031 is taken, use the next free number and use it consistently in every step below.
3. Create `docs/decisions/0031-client-frame-pacing.md` following the format of ADR 0029/0030:
   - Title line: `# ADR 0031: client frame pacing - coalesced presentation over the authoritative event stream`.
   - Status line: `Date: 2026-10-22. Status: accepted.` followed by one sentence naming related records: builds on [ADR 0015](0015-bounded-runtime-and-history.md) (bounds unchanged), [ADR 0013](0013-desktop-design-system.md) (tokens) and [ADR 0029](0029-rust-terminal-workbench.md) (terminal renderer); relative links in the `0013-...md` style.
   - `## Context`: the desktop polls cursor pages while the architecture promises SSE; bursty streaming makes the session view and terminal repaint per event, which stutters; the owner asked for smooth rendering in both clients; Neovide as inspiration (frame-paced presentation decoupled from input/event arrival).
   - `## Decision`: numbered points 1-4 from the Chore Description, using real names (`LuunaClient.streamEvents`, `eventPage`, `readEventPages`, `/api/v1/runs/{id}/stream`, `prefers-reduced-motion`, `design/tokens.css`, `crates/luuna-tui`, DEC mode 2026). State explicitly: the runtime still decides every state; clients only choose when to paint.
   - `## Alternatives considered`: the three alternatives with the rejection reasons from point 6.
   - `## Consequences`: no runtime/schema/catalog change; ADR 0015 bounds unchanged; DOM smokes and accessibility/contrast audits keep working; motion adds tokens in both schemes per ADR 0013; the TUI stops redrawing while idle; SSE capacity exhaustion falls back to pages rather than failing.
   - `## Validation and limits`: point 5, plus: fixture or synthetic runs do not establish provider or other-platform behaviour.
   - Keep it under about 90 lines; plain Markdown, no emojis.
4. Edit `docs/CURRENT-ARCHITECTURE.md`, minimally:
   - In the ADR 0015 paragraph (lines 29-34) add one sentence: since [ADR 0031](decisions/0031-client-frame-pacing.md) the desktop follows a live run through the resumable SSE route `/api/v1/runs/{id}/stream` and falls back to cursor pages when the stream is unavailable or the run has settled; the ADR 0015 bounds are unchanged.
   - Line 39 diagram: keep the shape; change the edge label so it is accurate, for example `authenticated HTTP + resumable SSE (cursor-page fallback)`, keeping the column alignment of the `├──` lines below.
   - At the end of the design-system paragraph (line 49) add one sentence: presentation is frame-paced per ADR 0031 (display-only coalescing to one commit per frame; stored events and cursors never dropped, merged or reordered; DOM-based, token-driven, reduced-motion-aware motion).
   - At the end of the terminal paragraph (lines 55-61) add one sentence: the native renderer draws on an event-driven frame clock (dirty flag, about 60 Hz cap, no idle redraws) with DEC 2026 synchronized updates and eased whole-row scrolling, each with an opt-out (ADR 0031).
   - Change nothing else (line 137 table row stays as is).
5. Run the Validation Commands and fix any failures caused by this change. Report any pre-existing failure separately with its output.
6. Run `git status --short` again; only `docs/decisions/0031-client-frame-pacing.md` (new) and `docs/CURRENT-ARCHITECTURE.md` (modified) should be added by this item.

## Validation Commands

The repository has no Markdown lint or link checker (`package.json` scripts and `.github/workflows/ci.yml` were checked); the commands below are the real repository checks plus change-specific checks. Run from `C:/Users/localhost/github/luuna`.

- `node scripts/check-contracts.mjs` (also `npm run test:contracts`) - catalog/route contracts still pass; this item must not affect them.
- `node scripts/check-hygiene.mjs` - CI hygiene check.
- `git diff --check` - no whitespace errors.
- `git status --short` - only the two documentation files changed; `VALIDATION-REPORT.md` absent from the output.
- Change-specific link and content check (exits non-zero on failure):

  ```bash
  node -e "const fs=require('fs'),path=require('path');let bad=0;for(const f of ['docs/CURRENT-ARCHITECTURE.md','docs/decisions/0031-client-frame-pacing.md']){const t=fs.readFileSync(f,'utf8');for(const m of t.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)){if(/^https?:/.test(m[1]))continue;const p=path.resolve(path.dirname(f),m[1]);if(!fs.existsSync(p)){console.error(f+': broken link '+m[1]);bad=1}}}const a=fs.readFileSync('docs/CURRENT-ARCHITECTURE.md','utf8'),d=fs.readFileSync('docs/decisions/0031-client-frame-pacing.md','utf8');for(const [n,ok] of [['architecture cites ADR 0031',a.includes('decisions/0031-client-frame-pacing.md')],['architecture names stream route',a.includes('/runs/{id}/stream')],['ADR accepted',/Status: accepted/i.test(d)],['ADR dated',d.includes('2026-10-22')],['ADR alternatives',/canvas|WebGL/.test(d)&&/batch/i.test(d)&&/IPC/.test(d)],['ADR DEC 2026',d.includes('2026 synchronized')||/mode 2026/.test(d)],['ADR reduced motion',d.includes('prefers-reduced-motion')]]){if(!ok){console.error('missing: '+n);bad=1}}process.exit(bad)"
  ```

- `git diff --stat -- VALIDATION-REPORT.md` - must print nothing.

## Notes

- The architecture sentence about desktop SSE describes the behaviour decided by ADR 0031 and implemented by later items of this run. If the orchestrator drops the desktop SSE item, this sentence must be reverted or reworded before integration; the ADR itself stays valid as a decision.
- Do not claim smoothness, frame timing or provider behaviour as achieved anywhere; ADR 0031 records the decision and the evidence that would be needed.
- The capability catalog already marks the desktop session list with `data-capability="runs.events runs.stream"` (`EventList.tsx` line 48); no catalog change is needed.
- `.claude/worktrees/` contains another checkout with copies of these docs; edit only the main checkout's files.
