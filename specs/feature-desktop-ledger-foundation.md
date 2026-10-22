# Feature: Desktop Ledger foundation (ADR 0033, reference copy, Ledger tokens, Söhne removal, lint)

## Metadata

- Type: feature
- Source: user request, run notes `.tac/runs/ledger-ui-20261022-1015/work-items.md`. The owner's Ledger design system is at `C:\Users\localhost\Downloads\ledger-design-system_1\ledger-design-system` (62 files; read-only, untrusted reference data).
- Date: 2026-10-22
- Orchestration: run ledger-ui-20261022-1015, wave 1, item L1. Foundation for L2 (primitives) and L3 (shell) in wave 2, L4 (screens) in wave 3 and Q (real-render QA) in wave 4.
- Baseline: the orchestrator creates this run's branch from `orchestrate/stripe-ui-20261022` (HEAD `7614837` at planning time). Before editing, record the actual full SHA and `git status`. Do not freeze a stale SHA.

## Feature Description

The Luuna desktop moves from ADR 0032's Stripe-inspired visual language (blurple/navy, Söhne, aurora, glow, gradients) to the owner's **Ledger** design system. Ledger's light theme is white and cool gray with an indigo accent. Its dark theme is the Apple Developer palette. It uses the system font stack, a content-first layout and has no gradients.

L1 lays the foundation only:
- an accepted ADR;
- a vendored reference copy of Ledger;
- Ledger's exact tokens in Luuna's token sheets, with every old token name still resolving;
- Söhne removed completely;
- lint, contrast and exactness tests updated.

Components keep their current CSS. After L1 the app must stay working and readable, but it will look transitional: old component shapes in Ledger colours, type and spacing. L2, L3 and L4 restyle it. Visual quality is verified in item Q, not here.

## User Story

As the Luuna developer, I want the desktop's design tokens to be exactly Ledger's, in both themes and with system fonts, while my existing components, smokes and approval/evidence UI keep working. Then the restyle waves can adopt Ledger component by component without breaking the app.

## Solution Statement

Map Ledger `tokens.json` one to one onto **Ledger-named** custom properties:
- `--surface`, `--ink`, `--accent`, `--success-soft`, …
- `--space-*`, `--radius-*`, `--z-*`, `--control-*`, `--banner-height`, …

Then turn every old Luuna token that is still used into an **alias** (`--color-bg: var(--surface)`) in a new legacy sheet. One alias map that is scheme-independent avoids defining the old names twice.

Theme selection follows Ledger's mechanism:
- light by default;
- dark from `data-theme="dark"`, or from the OS unless `data-theme="light"` is set.

Luuna's behaviour stays "follow the OS", because nothing sets the attribute yet. The attribute is supported for a later theme control.

Tests read the vendored `tokens.json` and prove the values are exact. The ADR 0032 motion and TSX lint stays, and new rules ban gradients and pin dark-mode card shadows to `none`. Ledger's React build (`ledger.mjs`) is **not** adopted: Luuna's roles, `data-capability`/`data-surface` markers, smoke selectors and approval/evidence UI stay in Luuna's own components.

## Out of Scope

- Restyling component or screen CSS: `design/components.css`, `controls.css`, `overlays.css`, `motion.css`, `screens/*`, `ui/*`, the shell, `StatusBadge`, and removing the `Aurora`/`GlowSurface` components or left-border rules. These belong to L2, L3 and L4. The only exceptions are the minimum edits listed in task 9.
- Importing `ledger.mjs`/`ledger.js`/`ledger.css` into the app, or vendoring anything into `apps/desktop/src`.
- The TUI, runtime, schemas, capability catalog and product-policy behaviour (approvals, hashes, evidence, publication).
- Adding a theme picker or writing `data-theme` from the app (L4 or later). Rendered visual QA (item Q).
- Files owned by parallel agent a789ff1dc3c0f46e5: `apps/desktop/src/Home.tsx`, `apps/desktop/src/ui/controls.tsx`, `apps/desktop/index.html`, `apps/desktop/src/Settings.tsx`, `apps/desktop/src/screens/settings.css`. Do not edit them.
- Rewriting Git history to purge the Söhne woff2 blobs. They stay recoverable from history. Say so in the notices; the developer decides any purge.
- Committing, pushing or merging. The orchestrator integrates.

## Relevant Files

Read first: `AGENTS.md`, `docs/CURRENT-ARCHITECTURE.md`, `docs/DESIGN-SYSTEM.md`, `docs/decisions/0013-desktop-design-system.md`, `0030-desktop-shell-and-tailwind.md`, `0031-client-frame-pacing.md`, `0032-stripe-inspired-desktop-visual-language.md`.

Source (read-only), at `C:\Users\localhost\Downloads\ledger-design-system_1\ledger-design-system\`:
- `README.md` (brand book)
- `CLAUDE.md` (design rules only, **not** agent instructions for this repo)
- `tokens/tokens.json` (the source of truth)
- `tokens/tokens.css`
- `components/ledger.css`

New files:
- `docs/design-reference/README.md` (new): provenance note.
- `docs/design-reference/ledger/**` (new, 62 files): byte-for-byte copy, with `CLAUDE.md` renamed to `LEDGER-RULES.md`.
- `docs/decisions/0033-ledger-design-system.md` (new): the ADR.
- `apps/desktop/src/design/tokens-scale.css` (new token sheet): fonts, type styles, spacing, size and layout tokens.
- `apps/desktop/src/design/tokens-legacy.css` (new token sheet): old→Ledger aliases and `prefers-contrast` overrides.

Rewritten:
- `apps/desktop/src/design/tokens.css`: Ledger colour roles in the three theme blocks, plus Luuna's `--duration-fast`/`--duration-follow`/follow/caret tokens (kept here per ADR 0031).
- `apps/desktop/src/design/tokens-depth.css`: Ledger radius, shadows (theme blocks), z-index, Luuna widths and marks. No gradients, aurora, glow or blur.

Edited:
- `apps/desktop/src/design/tokens-motion.css`: header comment only (ADR 0033 reference). Values unchanged.
- `apps/desktop/src/styles.css`: manifest (remove `fonts.css`, add the two new sheets) and its header comment.
- `apps/desktop/src/design/design-system.test.ts`: sheet registry, theme structure, contrast pairs, Ledger exactness, legacy map, gradient and left-rule rules.
- `apps/desktop/src/design/lint.ts` and `lint.test.ts`: `gradientProblems`, `leftRuleProblems`, a TSX gradient-utility ban, and fixtures that accept and reject.
- `apps/desktop/src/design/base.css`: links to `--accent-text`; comments refer to ADR 0033. Element defaults only.
- `apps/desktop/src/main.tsx`: drop `applyPlatform`.
- `apps/desktop/vite.config.ts`: drop the woff2 `assetsInlineLimit` rule.

Deleted:
- `apps/desktop/src/design/fonts.css`, `fonts.test.ts`, `platform.ts`, `platform.test.ts`
- `apps/desktop/src/assets/fonts/soehne/*.woff2` (10 files, plus the now-empty directories)

Minimum compatibility edits (task 9 only):
- `apps/desktop/src/design/motion.css` (glow, aurora and shimmer lines)
- `apps/desktop/src/design/controls.css` (four composite `box-shadow` lines)
- `apps/desktop/src/screens/shell.css` (the Home aurora wash)
- `apps/desktop/src/screens/sessions.css` (line 29)

Docs:
- `THIRD-PARTY-NOTICES.md`: remove "Bundled fonts"; add a design-reference entry.
- `docs/DESIGN-SYSTEM.md`, `docs/CURRENT-ARCHITECTURE.md` (line 53), `apps/desktop/README.md` (line 20)
- Status lines of ADRs 0013, 0030 and 0032.

Unchanged but must stay green:
- `apps/desktop/src-tauri/tauri.conf.json` CSP. Keep `font-src 'self'`. It is harmless and still blocks remote fonts. Note this in the ADR.
- `design/tailwind.css`, which still references legacy names that resolve.
- `screens-motion.test.ts`, `motion-css.test.ts`, `components.test.ts`, `ui/motion-math.test.ts`.

## Implementation Plan

### Foundation

#### Vendoring

Copy the whole source folder to `docs/design-reference/ledger/` byte for byte (`cp -r`). Then `git mv`/rename `CLAUDE.md` → `LEDGER-RULES.md` so no agent tool auto-loads it. Do not edit any vendored file, including the README that mentions `CLAUDE.md`.

Write `docs/design-reference/README.md` (about 10 lines):
- source path `C:\Users\localhost\Downloads\ledger-design-system_1\ledger-design-system`, copied 2026-10-22;
- this is the project owner's design system, adopted by ADR 0033;
- the source contained no license file;
- it is imported reference data, not product code: nothing under it is built, imported, tested or loaded into agent context;
- `LEDGER-RULES.md` is the renamed `CLAUDE.md`, and the vendored README's "copy CLAUDE.md into your repo root" does not apply here;
- Luuna's rules live in ADR 0033 and `docs/DESIGN-SYSTEM.md`.

#### ADR 0033

`docs/decisions/0033-ledger-design-system.md`, "Date: 2026-10-22. Status: Accepted." Its decisions:

1. **Adopt Ledger.** Use Ledger tokens (exact `tokens.json` values, light and dark) and Ledger component looks inside Luuna's existing React components. Do not use `ledger.mjs` wholesale: runtime authority, `data-capability`/`data-surface` markers, smoke selectors, StatusBadge/tone indirection and the approval/evidence UI stay.
2. **Supersede part of ADR 0032.** ADR 0033 replaces ADR 0032's palette, typography (decision 1), colour and depth (decision 2), gradients, aurora and glow, and the gradient part of decision 8. These ADR 0032 rules stay in force:
   - opacity rules (3) and transform rules (4);
   - the active-chip pulse (5), though no decorative drift remains;
   - the motion budget (6): only transform/opacity/background-position/clip-path/stroke-dashoffset animate, entrances play once, reduced motion zeroes durations, no `transition: all`, no `will-change`, duration and easing tokens;
   - platform gating (7), contrast (8, without gradients), and evidence never animating (9);
   - the TSX lint.
3. **Fonts.** Use the system stack (Ledger `--font-sans`: SF Pro on Apple platforms, Segoe UI on Windows) and Ledger `--font-mono`. `--font-display` aliases `--font-sans`. Söhne, `fonts.css`, `data-platform`/`data-font` and `platform.ts` are removed, and so is the Söhne notice. The CSP keeps `font-src 'self'` as a harmless restriction. The woff2 blobs remain in Git history.
4. **Themes.** Light is default and dark comes from `data-theme="dark"`, or from `prefers-color-scheme: dark` unless `data-theme="light"`. Both schemes define identical role names. Dark values are exactly the Apple Developer palette from `tokens.json`; light keeps the indigo accent.
5. **Tone mapping** (amends ADR 0013 decision 2: "colour family" per tone). Each tone maps to Ledger status colours: success→success, active→info, danger→danger, attention→warning. neutral→`ink-body` on `fill-strong` with an `ink-muted` mark. **interrupted shares the neutral family.** Ledger forbids new colours, and `ai` purple is reserved for AI output. Interrupted stays distinct through its pause-bar mark and its runtime text: status is never colour alone, and interruption is still never danger. The "green is earned" taxonomy is unchanged.
6. **No gradients, no coloured left-border cards.** Luuna's tone-mark shapes remain. Dark cards have no shadow (`--shadow-card`/`--shadow-button` are `none` in dark); depth comes from surface steps.
7. **Content-first layout and copy rules** from Ledger: AppShell+PageHeader, banner 40px, top bar 56px, content max 1200px, off-canvas sidebar below 768px, sentence case, a 2px focus ring with 2px offset, tabular numerals. L3 and L4 implement these.
8. **Consequences.**
   - Five token sheets: `tokens.css` (colour), `tokens-depth.css`, `tokens-scale.css`, `tokens-motion.css`, `tokens-legacy.css`. The legacy sheet keeps old names working until the waves migrate and is deleted when it is empty.
   - The manifest is edited once by L1.
   - The lint adds a gradient ban and a left-rule ban with a pending allowlist that L2 must empty.
   - Interim known gaps (see Notes) and rendering evidence belong to item Q.
   - Alternatives rejected: importing `ledger.mjs`, because it would drop Luuna roles, markers and policy UI; `light-dark()`, because of uneven support in the WKWebView/WebView2 versions and because it breaks the hex contrast parser; keeping Söhne opt-in, which the owner rejected.

Status-line updates:
- **ADR 0013**: append "; amended by ADR 0033 (Ledger palette, tone colour mapping, system fonts)".
- **ADR 0030**: append "; amended by ADR 0033 (visual language)".
- **ADR 0032**: change to "Status: Accepted; partly superseded by ADR 0033 (decisions 1 and 2, gradients/aurora/glow, and the font and gradient consequences); decisions 3 to 7 and 9 and the lint consequences remain in force".

Update `docs/DESIGN-SYSTEM.md`:
- the header status;
- principles 4 to 6: accent wording; interrupted uses the neutral family plus pause bars; "accent means the developer acts; info means the runtime works, distinguished by mark and text";
- the files tree: remove `fonts.css`, add the two sheets and describe each;
- the Tokens section: Ledger names, the old→new table pointer and the theme mechanism;
- the font paragraphs at lines 93 and 181: system stack only.

In `CURRENT-ARCHITECTURE.md` line 53, replace the final ADR 0032 sentence with an ADR 0033 sentence. In `apps/desktop/README.md` line 20, replace "dark by default" with "light by default, dark from the OS or `data-theme`; Ledger tokens (ADR 0033)".

### Core: token sheets

**Theme selectors.** These are the only selectors allowed in token sheets:
- `:root` (scheme-independent);
- `:root, :root[data-theme="light"]` (light);
- `:root[data-theme="dark"]` (dark);
- `:root:not([data-theme="light"])`, inside `@media (prefers-color-scheme: dark)`.

Specificity: the dark attribute and media blocks are (0,2,0) and beat light `:root` (0,1,0). `data-theme="light"` excludes the media block.

**`tokens.css`** contains:
- every `color.tokens` entry from `tokens.json` under its Ledger name (`--surface` … `--info-soft`, including `--scrim`, `--banner`, `--toast*`, `--chart-*`, `--ai`, `--control-selected`), with `color-scheme` set in each theme block. The dark attribute block and the dark media block are identical;
- a scheme-independent `:root` with `--duration-fast: 120ms`, `--duration-follow: 160ms`, `--follow-threshold`, `--tail-caret-*`, and their reduced-motion zeroing (moved unchanged from the old sheet).

**`tokens-depth.css`** contains:
- `:root`: Ledger `--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 8px`, `--radius-xl: 12px`, `--radius-full: 9999px`; `--z-sticky` 10, `--z-menu` 30, `--z-drawer` 40, `--z-dialog` 50, `--z-toast` 60; Luuna `--border-width`, `--rule-width`, `--focus-width: 2px`, `--focus-offset: 2px`, `--focus-inset`, `--mark-size`, `--mark-stroke`, `--caret-*`; and `--shadow-focus: 0 0 0 1px var(--focus-ring)` (Ledger fields: focus border plus a 1px ring).
- Theme blocks (same three selectors): the exact Ledger `--shadow-button`, `--shadow-card`, `--shadow-popover` (`none`/`none`/hairline popover in dark).
- No `--gradient-*`, `--blur-aurora`, `--glow-size`, `--color-glow`, `--shadow-inset-highlight` or `--focus-ring-width` (the last two lose all uses after task 9; delete them if `git grep` finds none).

**`tokens-scale.css`** (new) contains:
- **Fonts.** Ledger `--font-sans` and `--font-mono` exactly; `--font-display: var(--font-sans)`.
- **Ledger type styles as tokens.** The font-size lint requires `font-size: var(--text-*)`. For each style use `--text-<style>`, `--leading-<style>` (px, as in Ledger), `--weight-<style>` and, for page-title only, `--tracking-page-title: -0.01em`. The styles are page-title 28/36/700, metric-lg 24/32/600, section-title 20/28/600, metric 20/28/600, body-strong 14/20/600, body 14/20/400, label 13/18/500, caption 12/16/400, overline 12/16/500, mono 13/20/400. Name collisions resolve to Ledger: `--text-body`, `--text-label` (11→13px) and `--text-caption` take Ledger values.
- **Weights.** Luuna `--weight-light` to `--weight-bold` stay.
- **Spacing.** Ledger exact: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` **20**, `-6` **24**, `-8` 32, `-12` 48. Luuna `-5` and `-6` shrink from 24 and 32; this is intentional and noted. Luuna half steps `--space-0-5`, `-1-5`, `-2-5` stay.
- **Sizes.** Ledger `--control-sm` 28, `--control-md` 32, `--control-lg` 40, `--sidebar-width` 240, `--drawer-width` 440, `--dialog-width` 480, `--banner-height` 40, `--topbar-height` **56** (was 64; drop the 680px override), `--content-max-width` 1200, `--fold-reference` 768.
- **Luuna-only layout tokens**, with values unchanged: `--app-min-width`, `--layout-max`, `--connect-width`, `--palette-*`, `--menu-*`, `--viewport-height`, `--sidebar-compact`, `--nav-height`, `--icon-*`, `--gutter`, `--section-gap`, `--panel-pad`, `--aside-width`, `--rail-width`, `--facts-term`, `--field-min`, `--hint-min`, `--measure`, `--number-width`, `--scroll-max`, `--textarea-min`, `--plan-max`, `--empty-min`, `--skeleton-*`, `--checkbox-size`, `--field-line`, `--control-pad-x*`, `--text-wordmark`, `--text-glyph`, the unitless `--leading-none|tight|code|prose` and `--leading`, and `--tracking-tight|title|wide`.
- The 920px and 680px gutter media blocks. Remove the 680px `--text-h1` and `--text-title` overrides: Ledger type is fixed.

**`tokens-legacy.css`** (new, the last token sheet) contains only `:root { --old: var(--new) }` aliases, plus the `@media (prefers-contrast: more)` block. A legacy alias is defined once and resolves per theme through the Ledger role it points to.

Keep an alias for **every** custom property that the old token sheets defined and that `git grep -E "var\(--NAME\b"` finds outside the token sheets at the L1 base commit. The "every var() resolves" test is the backstop. Required mapping (record this exact table in DESIGN-SYSTEM.md):

| Old name | → Ledger |
| --- | --- |
| `--color-bg`, `--color-sidebar` | `--surface` |
| `--color-surface`, `--color-control` | `--surface-raised` |
| `--color-surface-raised`, `--color-control-hover`, `--color-field-disabled` | `--fill` |
| `--color-surface-sunken` | `--surface-muted` |
| `--color-field` | `--field` |
| `--color-selected`, `--color-accent-tint`, `--color-selection` | `--accent-soft` |
| `--color-selected-border`, `--color-accent` | `--accent` |
| `--color-accent-hover`, `--color-accent-active` | `--accent-hover` |
| `--color-on-accent` | `--ink-on-accent` |
| `--color-focus`, `--color-focus-ring` (if still used) | `--focus-ring` |
| `--color-border` | `--separator` |
| `--color-border-strong`, `--color-scrollbar` | `--border` |
| `--color-border-control` | `--border-strong` |
| `--color-text` | `--ink-body` |
| `--color-text-heading` | `--ink` |
| `--color-text-muted`, `--color-text-subtle` | `--ink-muted` (not `ink-subdued`: legacy subtle text sits on fills and fields, where subdued fails 4.5:1) |
| `--color-text-disabled` | `--ink-disabled` |
| `--color-scrim` | `--scrim` |
| `--tone-success-{fg,bg,border,mark}` | `--success`, `--success-soft`, `--success-soft`, `--success` |
| `--tone-active-*` | `--info`, `--info-soft`, `--info-soft`, `--info` |
| `--tone-danger-*` | `--danger`, `--danger-soft`, `--danger-soft`, `--danger` |
| `--tone-attention-*` | `--warning`, `--warning-soft`, `--warning-soft`, `--warning` |
| `--tone-neutral-*` and `--tone-interrupted-*` | `--ink-body`, `--fill-strong`, `--fill-strong`, `--ink-muted` |
| `--radius-chip` | `--radius-sm` |
| `--radius-input`, `--radius-button` | `--radius-md` |
| `--radius-card`, `--radius-menu` | `--radius-lg` |
| `--radius-dialog` | `--radius-xl` |
| `--radius-pill` | `--radius-full` |
| `--shadow-panel` | `--shadow-card` |
| `--shadow-dialog`, `--shadow-overlay` | `--shadow-popover` |
| `--shadow-button-hover` | `--shadow-button` |
| `--shadow-kbd` | `none` (the only non-var value allowed here) |
| `--control-height` | `--control-md` |
| `--control-height-sm` | `--control-sm` |
| `--content-max` | `--content-max-width` |
| `--text-display`, `--text-h1`, `--text-title` (+ `--leading-display`/`-h1`, `--tracking-display`/`-h1`) | `--text-page-title` (+ leading/tracking) |
| `--text-h2` (+ leading) | `--text-section-title` |
| `--text-h3` (+ leading) | `--text-body-strong` |
| `--text-xl` | `--text-metric-lg` |
| `--text-lg`, `--text-md` | `--text-body` |
| `--text-small`, `--text-sm` | `--text-label` |
| `--text-xs`, `--text-2xs` | `--text-caption` |
| `--leading-small`, `--leading-caption`, `--leading-label` | the matching Ledger leading |
| `--tracking-h2`, `--tracking-label` | `--tracking-none` |
| `--weight-strong` | `--weight-semibold` |

For the two tracking aliases, define `--tracking-none: 0em` in `tokens-scale.css`.

The `prefers-contrast: more` block in `tokens-legacy.css` sets `--color-border: var(--border-strong)`. `--color-text-subtle` is already `ink-muted`.

### Integration: tests and lint

**`design-system.test.ts`:**

- `TOKEN_SHEETS = ["design/tokens.css", "design/tokens-depth.css", "design/tokens-scale.css", "design/tokens-motion.css", "design/tokens-legacy.css"]`.
- `EXPECTED_SHEETS`: the manifest, the token sheets in that order, then the rest unchanged, without `design/fonts.css`.
- `layerOf`: token sheets → `tokens`.
- `MEDIA`: add `(prefers-color-scheme: dark)`. Remove `(prefers-color-scheme: light)`: no non-token sheet uses it, per `git grep`.
- The token-sheet test allows only the theme selectors above, and the `:not(...)` selector only inside the dark media block.
- **Theme structure** (replaces "the depth sheet's light names are a subset"). For `tokens.css` and `tokens-depth.css`:
  - parse the light, dark-attribute and dark-media blocks;
  - the light name set equals the dark name set;
  - the dark-attribute map equals the dark-media map, name for name and value for value;
  - the scheme-independent `:root` redefines no themed name;
  - `color-scheme` is `light` / `dark` / `dark`.
- **Ledger exactness** (new). Read `new URL("../../../../docs/design-reference/ledger/tokens/tokens.json", import.meta.url)` with `node:fs`. Assert, comparing hex in lowercase, that:
  - every `color.tokens[].value.light` / `.dark` equals the sheet's light and dark value;
  - `shadow.tokens` matches in both themes;
  - `spacing`, `radius`, `zIndex` and `size` tokens match by name in the scheme-independent blocks;
  - `type.families.sans` / `mono` equal `--font-sans` / `--font-mono`;
  - each `type.groups[].styles[]` matches its `--text-*`, `--leading-*` and `--weight-*` tokens.
- **Dark cards are flat**: the dark `--shadow-card` and `--shadow-button` equal `none`. This is how the Ledger "no box-shadow on cards in dark" rule is enforced. Literal shadows outside tokens are already banned.
- **Legacy map** (new):
  - every `tokens-legacy.css` value is `var(--x)` for a name defined in another token sheet, or `none`;
  - a pinned `LEGACY` record of the colour and tone rows above must match, so changing a semantic mapping needs a test edit and an ADR note.
- **Contrast** (replaces `SURFACES`/`TEXT`/`PAIRS`). Compute real WCAG ratios from the light and dark maps of `tokens.css` (all `#rrggbb` custom properties). Pairs use Ledger names, from the tokens.json usage notes:
  - **4.5:1**:
    - `ink` and `ink-body` on `surface`, `surface-muted`, `surface-raised`, `surface-overlay`, `field`, `fill`, `fill-strong`, `accent-soft`, `control-selected`;
    - `ink-body` on all four `*-soft`;
    - `ink-muted` on `surface`, `surface-muted`, `surface-raised`, `surface-overlay`, `field`, `fill`, `accent-soft`;
    - `ink-subdued` on `surface`, `surface-muted` and `surface-raised` only (surfaces-only rule);
    - `accent-text` on `surface`, `surface-muted`, `surface-raised`, `surface-overlay`, `field`, `accent-soft` (**not** `fill`);
    - each of `success`, `danger`, `warning`, `info` on its own `*-soft`, `surface`, `surface-muted` and `surface-raised`;
    - `ink-on-accent` on `accent` and `accent-hover`;
    - `ink-on-danger` on `danger`;
    - `ink-on-toast` and `toast-action` on `toast`;
    - `ink-on-banner` on `banner`;
    - `ink` on `accent-soft` (`::selection`).
  - **3:1**:
    - `border-strong` on `surface`, `surface-muted`, `surface-raised`, `surface-overlay`, `field`;
    - `focus-ring` on the same five;
    - `accent` (indicators) on `surface`, `surface-muted`, `surface-raised`.
  - **Documented exclusion**: assert dark `accent-text` on `fill` is **below** 4.5 (4.18). A comment says "links never sit on fill (Ledger)", so the exclusion is a recorded fact and not a silent gap.
  - **Resolved tones**: resolve each `--tone-<tone>-{fg,bg,mark}` through `tokens-legacy.css` to Ledger hex. Assert fg on bg, `surface` and `surface-raised` at 4.5, and mark on bg, `surface`, `surface-raised` and `surface-muted` at 3, for all six tones in both themes.
  - Planning-time ratios from the source tokens: all of these pass. The tightest are dark `ink-muted`/`fill` 4.90, `success`/`success-soft` 4.54, `ink-on-accent`/`accent-hover` 4.51, `ink-subdued`/`surface-raised` 4.65, `focus-ring`/`surface-raised` 3.58, `border-strong`/`surface-raised` 3.32, and `ink-muted` on `fill-strong` (neutral mark) 3.89.
- **Gradient rule**: `gradientProblems` on **every** sheet, token sheets included. Also, no token sheet defines a name matching `/gradient|aurora|glow/`.
- **Left-rule rule**: run `leftRuleProblems` on every non-token sheet. The result must be a subset of `LEFT_RULE_PENDING`, an exact `file: selector` list that you generate at L1 time. Expect entries such as `components.css` `.record[data-tone]`, `.record-list.record-rows > .record[data-tone]`, `.failure-note[data-tone]`, `.callout[data-tone]`, `.error`, the accent rules near lines 127/134/216, and `overlays.css` line 60. Every pending entry must still match a real rule, so stale entries fail and L2 must shrink the list to empty.
- Keep the other tests unchanged: tokens-only, tone indirection, state selectors, reduced-motion derivation (`>= 12` durations still holds, because `--duration-ambient` stays), the Tailwind reference check and var resolution.

**`lint.ts`:**
- `gradientProblems(css)`: flags any value matching `/\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/i`.
- `leftRuleProblems(css)`: flags `border-left`, `border-left-color`, `border-inline-start` and `border-inline-start-color` whose value references `--tone-`, `--color-accent`, `--accent` or `--rule-width`, and `box-shadow` values containing `inset var(--rule-width)`.
- Do **not** add either rule to `motionProblems`; they are separate and wired in the test above.
- `tsxStyleProblems`: also reject utilities matching `^(?:bg-(?:linear|radial|conic|gradient)-|from-|via-|to-(?!$))` and strings containing `gradient(`. Check that no current TSX breaks; the planning `git grep` found none.
- Update header comments to "ADR 0032 motion rules, ADR 0033".

**`lint.test.ts`:**
- Add accept and reject fixtures for both new helpers and the TSX gradient ban. A rule that cannot fail is not evidence.
- Rename the fixture `var(--blur-aurora)` to `var(--blur-sm)`, so no removed name survives in tests.

**`screens-motion.test.ts`:** evidence selectors and the live-output guard stay **unchanged**. Do not weaken any product-policy guard.

## Step by Step Tasks

1. Revalidate: read the instructions and ADRs above, record the base SHA and `git status`, and confirm the parallel-agent files are untouched. Run `npx vitest run src/design` (in `apps/desktop`) for a baseline.
2. Vendor Ledger into `docs/design-reference/ledger/`, rename `CLAUDE.md`→`LEDGER-RULES.md`, and write `docs/design-reference/README.md`. Verify that 62 files are present and that the bytes are identical (validation commands).
3. Write ADR 0033 and update the status lines of ADRs 0013, 0030 and 0032.
4. Rewrite `tokens.css` and `tokens-depth.css`, and create `tokens-scale.css` and `tokens-legacy.css`, per Core. Keep each at or under 300 lines; expect about 180, 70, 120 and 110.
5. Update `styles.css`: the import order is tokens, tokens-depth, tokens-scale, tokens-motion, tokens-legacy, then the rest unchanged; drop `fonts.css` and update the header comment (manifest edited by ADR 0033). Update the `tokens-motion.css` header comment.
6. Remove Söhne:
   - delete `design/fonts.css`, `fonts.test.ts`, `platform.ts`, `platform.test.ts` and `assets/fonts/soehne/` (10 woff2), and remove empty `assets/fonts` directories;
   - remove the `applyPlatform` import, the type import and the call from `main.tsx`;
   - remove the `assetsInlineLimit` property from `vite.config.ts`;
   - replace the notices' "Bundled fonts" section with a "Design reference" entry (Ledger copy, owner's system, no license file present, not covered by Luuna's MIT grant, docs only) and one line: "Söhne was removed by ADR 0033; earlier commits still contain the files."
7. Update `base.css`: `a { color: var(--accent-text); }`, and change the ADR 0032 references in comments to "ADR 0032 motion rules, retained by ADR 0033". No other edits.
8. Update `lint.ts`, `lint.test.ts` and `design-system.test.ts` per Integration. Generate `LEFT_RULE_PENDING` from the helper's output on the current sheets and paste it sorted.
9. Make only these compatibility edits after the token removals, and list each in the final report:
   - **`design/motion.css`**:
     - delete the `@keyframes aurora-drift` line;
     - replace the `.aurora { … }` and `.aurora[data-intensity="vivid"]` rules with `.aurora { display: none; }`;
     - in `.glow-surface::before`, replace `background: radial-gradient(…)` with `background: none`, keeping the rule, the hover and reduced-motion rules and the selectors that `motion-css.test.ts` checks;
     - in `.skeleton-row`, replace `var(--gradient-shimmer)` with `var(--color-control-hover)`.
   - **`design/controls.css`**, lines 18, 24, 25, 27, where Ledger's dark `none` would make the composite lists invalid:
     - `button:focus-visible` → `box-shadow: var(--shadow-button)` (the ring comes from the outline);
     - `button.primary` → `var(--shadow-button)`;
     - `button.primary:hover` → `var(--shadow-button-hover)`;
     - `button.primary:focus-visible` → `var(--shadow-button)`.
   - **`screens/shell.css`**: delete the Home wash `::before` rule and its `@keyframes aurora-drift` (about lines 211–226). Keep `.view > .page[data-surface="home"] { position: relative; isolation: isolate; }` and its comment, reworded.
   - **`screens/sessions.css`** line 29: `background: var(--color-surface-raised);` and the comment "Empty states: a quiet ground behind the selection prompt."
   - Nothing else. If another removed name breaks a sheet, add a legacy alias rather than editing the component.
10. Update the docs: `docs/DESIGN-SYSTEM.md` (including the old→new table), `docs/CURRENT-ARCHITECTURE.md` line 53 and `apps/desktop/README.md` line 20.
11. Run every validation command. Fix the failures this change introduced, and report unrelated baseline failures separately. Record `git status`, and confirm no parallel-agent file and no vendored byte changed.

## Testing Strategy

- **Unit (lint).** Fixtures prove `gradientProblems`, `leftRuleProblems` and the TSX gradient ban both accept and reject.
- **Token structure.** Theme block parity, the selector allowlist, dark attribute = dark media, the 300-line cap and manifest equality.
- **Exactness.** Every Ledger value is compared against the vendored `tokens.json`, so a typo fails.
- **Contrast.** Real WCAG ratios for the Ledger pairs and for the six resolved tones in both themes, plus the documented links-on-fill exclusion.
- **Regression.** The whole desktop suite, including `screens-motion.test.ts` evidence guards, `motion-css.test.ts`, `components.test.ts`, the primitives, CandidateReview and SessionParts tests (Aurora markup is unchanged) and the motion-math drift tests.
- **Build.** `npm run build` proves the bundle compiles without fonts, and `dist/assets` holds no woff2.
- **Limits.** Unit tests and the build are not rendering evidence. Readability in real WebViews is checked lightly here if possible (optional `node scripts/mvp-ui-smoke.mjs`, which audits rendered contrast in both OS schemes). Item Q owns the full check.

## Acceptance Criteria

- [ ] `docs/design-reference/ledger/` holds exactly 62 files, byte-identical to the source, with `LEDGER-RULES.md` in place of `CLAUDE.md`. `docs/design-reference/README.md` records the source path, the date, owner status, the missing license file and "reference data, not product code". Nothing is vendored under `apps/desktop/src`.
- [ ] ADR 0033 is Accepted (2026-10-22). It records the supersession and retention split with ADR 0032, the system fonts, the theme mechanism, the tone mapping (interrupted shares the neutral family and keeps its pause mark), the bans on gradients and left-border cards, the CSP decision and the Git history note. The ADR 0013/0030/0032 status lines, DESIGN-SYSTEM.md, CURRENT-ARCHITECTURE.md and the desktop README are updated.
- [ ] Every Ledger colour, shadow, space, radius, z-index, size, font and type-style token is defined with its exact `tokens.json` value, in both themes where themed (test-enforced).
- [ ] Dark is applied by `data-theme="dark"` or by the OS unless `data-theme="light"`. With no attribute the app follows the OS.
- [ ] Every old token referenced outside the token sheets still resolves (var-resolution test). The legacy sheet holds only aliases, and the pinned colour and tone map matches the table.
- [ ] Söhne is gone: no `fonts.css`, woff2, `platform.ts`, `applyPlatform`, `data-platform`/`data-font`, woff2 Vite rule or Söhne notice. `font-src 'self'` stays.
- [ ] No `gradient(` in any stylesheet and no gradient/aurora/glow token. Dark `--shadow-card` and `--shadow-button` are `none`. Left-rule uses are limited to the explicit pending list.
- [ ] The motion, opacity, timing, will-change, reduced-motion and TSX lint rules, and the evidence-motion guards, are unchanged or stricter.
- [ ] Only the task 9 edits touch component, screen or shell CSS, and no parallel-agent file is modified.
- [ ] The app builds and the desktop suite passes. The report states that visual quality is pending L2, L3, L4 and Q.

## Validation Commands

Run these from the repository root unless stated. They come from the root and desktop manifests and from `AGENTS.md`/`AI-START-HERE.md`; the repo has no TAC section.

- `cd apps/desktop && npx vitest run src/design` (new and changed design tests)
- `npm run typecheck --workspace @luuna/desktop`
- `npm run test --workspace @luuna/desktop`
- `npm run build`
- `node scripts/check-contracts.mjs`
- `node scripts/check-hygiene.mjs`
- `git grep -i -E "aurora|söhne|soehne" -- apps/desktop/src`. Expect no `söhne`/`soehne`. The remaining `aurora` hits are explained: `.aurora`/`.aurora-host` selectors in `design/motion.css`, the `Aurora` component and its uses in `ui/surfaces.tsx`, `ui/content.tsx`, `Home.tsx` and `project-components/ProjectComponents.tsx`, and absence assertions in `ui/primitives.test.tsx`, `CandidateReview.test.tsx` and `sessions/SessionParts.test.tsx`. L2 removes the component.
- `git grep -n -E "gradient\(|--gradient-|--blur-aurora|--glow-size|--color-glow|data-platform|data-font|applyPlatform|woff2" -- apps/desktop` (expect no output)
- `git ls-files docs/design-reference/ledger | wc -l` (expect 62 once staged), or `find docs/design-reference/ledger -type f | wc -l` before staging
- `diff -r --exclude=CLAUDE.md --exclude=LEDGER-RULES.md "C:/Users/localhost/Downloads/ledger-design-system_1/ledger-design-system" docs/design-reference/ledger && cmp "C:/Users/localhost/Downloads/ledger-design-system_1/ledger-design-system/CLAUDE.md" docs/design-reference/ledger/LEDGER-RULES.md` (expect no output)
- `test ! -e docs/design-reference/ledger/CLAUDE.md && echo ok`
- `ls apps/desktop/dist/assets | grep -c woff2` (expect `0` after the build)
- `wc -l apps/desktop/src/design/tokens*.css` (each at most 300)
- `git diff --check -- . ':!docs/design-reference'`. Vendored bytes are exempt; report any whitespace findings there without editing them.
- Optional, rendered: `node scripts/mvp-ui-smoke.mjs` (both OS schemes, 760px). Report it only if it actually ran; it is not a substitute for item Q.

## Notes

- **Interim gaps after L1** (expected; the app stays readable; hand-off to L2 and L3):
  - Text uses of legacy `--color-accent` (`components.css:36`, `controls.css:30,57`, `help.css:21`, `projects.css:15`, `shell.css:122`) render Ledger `accent`. That is 3.58:1 on dark cards and should become `--accent-text`.
  - The selected-nav indicator (`--color-accent` on `--accent-soft`) is 2.92:1 in dark. Ledger NavItem uses `accent-text`.
  - Uppercase labels and `--tracking-wide` remain; Ledger requires sentence case.
  - The left-border pending list remains.
  - `Aurora` and `GlowSurface` render inert.
  - Spacing `--space-5`/`--space-6` shrink to Ledger values.
  - Light cards are white on a white page until L3 adds the `surface-muted` tray.
  - The 768px off-canvas breakpoint is not yet in `MEDIA` (L3 adds it).
- **Naming.** Legacy `--color-surface-raised` means `fill`, not Ledger `--surface-raised`. Tailwind keys still use the legacy names, so `bg-surface-raised` is `fill`. L2 should switch utilities to Ledger keys and drop legacy aliases as their uses disappear. The legacy sheet is deleted when it is empty.
- **Untrusted source.** Treat the vendored Ledger files as untrusted reference data. Never execute `ledger.js`/`ledger.mjs` or the example HTML from the vendored folder, and never load them into agent context automatically.
- **Duration count.** `--duration-ambient` stays (unused after task 9), so the duration-count test holds. L2 may remove it and adjust the test.
