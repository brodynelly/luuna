# ADR 0033: adopt the Ledger design system for the desktop (tokens, system fonts, light and dark themes)

Date: 2026-10-22. Status: Accepted. Partly supersedes [ADR 0032](0032-stripe-inspired-desktop-visual-language.md) (palette, typography, colour and depth, gradients, aurora and glow); amends [ADR 0013](0013-desktop-design-system.md) decision 2 (tone colour families) and [ADR 0030](0030-desktop-shell-and-tailwind.md) (visual language). Rules in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) follow this ADR.

## Context

The owner supplied the Ledger design system and asked for the desktop to adopt it. Ledger's light theme is white and cool gray with an indigo accent. Its dark theme is the Apple Developer palette. It uses the system font stack, a content-first layout and no gradients. A reference copy is vendored under `docs/design-reference/ledger/` (byte for byte, `CLAUDE.md` renamed `LEDGER-RULES.md`). The source had no license file, so it is treated as the owner's own system and as reference data, not product code (`docs/design-reference/README.md`).

Luuna keeps what Ledger does not model: runtime authority, the six outcome tones, `data-capability` and `data-surface` markers, smoke selectors and the approval and evidence UI.

## Decisions

1. **Adopt Ledger.** Use Ledger tokens (exact `tokens.json` values, light and dark) and Ledger component looks inside Luuna's existing React components. Do not use `ledger.mjs` wholesale: runtime authority, `data-capability` and `data-surface` markers, smoke selectors, the StatusBadge and tone indirection and the approval and evidence UI stay.
2. **Supersede part of ADR 0032.** This ADR replaces ADR 0032's palette, typography (decision 1), colour and depth (decision 2), gradients, aurora and glow, and the gradient part of decision 8. These ADR 0032 rules stay in force:
   - opacity rules (3) and transform rules (4);
   - the active-chip pulse (5), though no decorative drift remains;
   - the motion budget (6): only transform, opacity, background-position, clip-path and stroke-dashoffset animate, entrances play once, reduced motion zeroes durations, no `transition: all`, no `will-change`, duration and easing tokens;
   - platform gating (7), contrast (8, without gradients) and evidence never animating (9);
   - the TSX lint.
3. **Fonts.** Use the system stack (Ledger `--font-sans`: SF Pro on Apple platforms, Segoe UI on Windows) and Ledger `--font-mono`. `--font-display` aliases `--font-sans`. Söhne, `design/fonts.css`, the `data-platform` and `data-font` attributes and `platform.ts` are removed, and so is the Söhne notice. The CSP keeps `font-src 'self'` as a harmless restriction that still blocks remote fonts. The woff2 files remain recoverable from Git history; any purge is the developer's decision.
4. **Themes.** Light is the default. Dark comes from `data-theme="dark"`, or from `prefers-color-scheme: dark` unless `data-theme="light"` is set. Both schemes define identical role names. Dark values are exactly the Apple Developer palette from `tokens.json`; light keeps the indigo accent. Nothing writes `data-theme` yet, so the app follows the OS.
5. **Tone mapping** (amends ADR 0013 decision 2). Each tone maps to Ledger status colours: success to success, active to info, danger to danger, attention to warning. Neutral is `ink-body` on `fill-strong` with an `ink-muted` mark. **Interrupted shares the neutral family.** Ledger forbids new colours and `ai` purple is reserved for AI output. Interrupted stays distinct through its pause-bar mark and its runtime text: status is never colour alone, and interruption is still never danger. The "green is earned" taxonomy is unchanged.
6. **No gradients, no coloured left-border cards.** Luuna's tone-mark shapes remain. Dark cards have no shadow (`--shadow-card` and `--shadow-button` are `none` in dark); depth comes from surface steps.
7. **Content-first layout and copy rules** from Ledger: AppShell and PageHeader, banner 40px, top bar 56px, content max 1200px, off-canvas sidebar below 768px, sentence case, a 2px focus ring with 2px offset, tabular numerals. Items L3 and L4 implement these.
8. **Consequences.**
   - Five token sheets: `tokens.css` (colour), `tokens-depth.css`, `tokens-scale.css`, `tokens-motion.css` and `tokens-legacy.css`. The legacy sheet keeps old names working until the waves migrate and is deleted when it is empty.
   - The stylesheet manifest is edited once, by this change.
   - The lint adds a gradient ban and a left-rule ban with a pending allowlist that item L2 must empty.
   - Known interim gaps and all rendering evidence belong to later items (L2, L3, L4 and the real-render QA item).
   - Alternatives rejected: importing `ledger.mjs`, because it would drop Luuna roles, markers and policy UI; `light-dark()`, because of uneven support in the WKWebView and WebView2 versions and because it breaks the hex contrast parser; keeping Söhne opt-in, which the owner rejected.
