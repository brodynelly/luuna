# Feature: Desktop visual-language foundation (ADR 0032, token split, lint revisions, sheet registration)

## Metadata

- Type: feature
- Source: orchestrator request. The desktop restyle is Stripe-inspired, but only as inspiration: no Stripe name, logo or asset may appear in code, comments or UI. The style-spec values are approximate recollections. Tune them, and never describe them as Stripe's tokens.
- Date: 2026-10-22
- Orchestration: run `stripe-ui-20261022-0905`, wave 1, item F2. Branch `orchestrate/stripe-ui-20261022`. Runs in parallel with F1 (`specs/feature-desktop-soehne-fonts.md`). Consumers: B (`specs/feature-desktop-stripe-primitives.md`), C (`specs/feature-desktop-stripe-shell.md`), D (`specs/feature-desktop-stripe-screens.md`). Visual QA belongs to item Q.
- Run notes: `.tac/runs/stripe-ui-20261022-0905/{work-items,scout-design,style-spec}.md`

## Feature Description

This item lays the token and rules foundation that waves 2 and 3 build on:

- An ADR that revises the font, opacity and transform rules and records the motion budget.
- A blurple, navy and cool-gray colour system in both schemes, using the same role names.
- A type scale retuned for Söhne's real weights.
- Radii, layered shadows and gradients in a new depth sheet.
- Easings, durations, motion distances and component sizes in a new motion sheet.
- A revised design lint.
- Pre-registration of every stylesheet that F1, B, C and D will add.

This item does not restyle components or screens. The app must stay fully readable and working with the new tokens before waves 2 and 3 land. Every existing token name keeps resolving. Judging visual quality is item Q's job.

## User Story

As the Luuna developer, I want one documented, test-enforced set of tokens and motion rules, so the primitive, shell and screen restyles can be built in parallel without inventing values, fighting the lint or editing each other's registration lines.

## Problem Statement

Several existing rules block the restyle:

- ADR 0013 and `docs/DESIGN-SYSTEM.md` require system fonts only (line 74: "no `@font-face`").
- The lint bans `opacity` everywhere (`design-system.test.ts:55`).
- DESIGN-SYSTEM.md:136 says text ancestors never get `transform`.
- `tokens.css` (266 lines) has one easing (`--ease: ease-out`), two durations, no shadows in dark, the weights 550 and 650 (which Söhne renders as 600 and 700), and no room under the 300-line cap.
- Every new sheet needs edits to `styles.css`, `EXPECTED_SHEETS` (line 20) and the layer expression (line 41). Today the expression maps any `design/<x>.css` to a nonexistent layer `<x>`. F1, B, C and D would all collide on these lines.

## Solution Statement

1. Write ADR 0032. It sets the rules, the gating and the motion budget. Update DESIGN-SYSTEM.md, the status lines of ADR 0013 and 0030, and CURRENT-ARCHITECTURE.md.
2. Split the tokens:
   - `tokens.css` keeps colours, tones, type and layout, and is retuned.
   - New `tokens-depth.css` holds shape, shadows, scrim, focus halo, glow and gradients.
   - New `tokens-motion.css` holds easings, durations, motion distances, component sizes, resting runtime variables, its own reduced-motion block and an append-only `item B` block.
3. Write the final manifest once, including stub files for sheets that later items fill. Replace the layer expression with an explicit `layerOf()` function.
4. Revise the lint:
   - Opacity rule as defined below.
   - Two new media features.
   - Durations and easings must be tokens.
   - Keyframe property allowlist.
   - No resting `forwards` fill on elements.
   - Filter and blur values must be tokens.
   - No `will-change`.
   - Token sheets get their own checks.
   - Contrast pairs for the new roles.
   - Reduced-motion coverage derived from the token sheets.
5. In `base.css` and `tailwind.css`, apply the type scale, tabular numbers, antialiasing, the focus halo, the selection colour and thin scrollbars.

## Out of Scope

- F1's files: `design/fonts.css` content (F2 may only create the stub, see Task 3), `design/platform.ts`, `main.tsx`, `tauri.conf.json`, `vite.config.ts`, `assets/fonts/*` and `THIRD-PARTY-NOTICES.md`. Do not edit the font-family lines `tokens.css:75-78`. Only the comment on line 74 changes.
- Restyling components, overlays, the shell or screens: `components.css`, `overlays.css`, `screens/*.css` (except creating stubs) and `ui/*`. That is B, C and D.
- `design/tone.ts`. The six tone names stay `success`, `active`, `danger`, `attention`, `neutral` and `interrupted`. No `warning`, `critical` or `info` names are added (see the tone mapping).
- `ui/glide.ts`, `ui/stickyScroll.ts`, `ui/useStickyScroll.ts`, the sessions logic, and the values of `--duration-follow`, `--follow-threshold` and the tail-caret tokens (ADR 0031). These tokens stay in `tokens.css`, unchanged.
- Runtime, schemas, TUI, api-client, the mono font, and a manual theme switch.
- Committing, unless the orchestrator authorizes it.

## Relevant Files

Read first: `AGENTS.md`, `AI-START-HERE.md`, `docs/CURRENT-ARCHITECTURE.md` (desktop paragraph, line 53), `docs/DESIGN-SYSTEM.md`, `docs/decisions/0013-desktop-design-system.md`, `0030-desktop-shell-and-tailwind.md`, `0031-client-frame-pacing.md`, the run notes, and the four sibling specs.

Edit:

- `docs/decisions/0032-stripe-inspired-desktop-visual-language.md` (new). The ADR.
- `docs/DESIGN-SYSTEM.md`: the sections listed in Task 1.
- `docs/decisions/0013-desktop-design-system.md` line 3 and `0030-desktop-shell-and-tailwind.md` line 3: add "amended by ADR 0032" to each status line.
- `docs/CURRENT-ARCHITECTURE.md` line 53: one sentence.
- `apps/desktop/src/design/tokens.css`: colours, tones, type and layout retuned. Shape, shadows and scrim move out. The motion block stays (the ADR 0031 tokens).
- `apps/desktop/src/design/tokens-depth.css` (new).
- `apps/desktop/src/design/tokens-motion.css` (new).
- `apps/desktop/src/design/base.css`: type scale, numerals, smoothing, focus halo, selection and scrollbars. Update the comment at line 19-20.
- `apps/desktop/src/design/tailwind.css`: theme references for the new type, colour and radius tokens.
- `apps/desktop/src/styles.css`: the final manifest.
- `apps/desktop/src/design/design-system.test.ts`: the lint revisions. It is 183 lines now and must stay at or under 300. If it would pass about 280, move the new lint helpers to `apps/desktop/src/design/lint.ts` (new, pure functions plus their fixture tests in `design/lint.test.ts`, new).
- Stubs (new; each is filled later by its owner): `design/fonts.css` (F1), `design/controls.css` and `design/motion.css` (B), `screens/shell.css` (C), `screens/sessions.css` (D).

Read only, as guards: `apps/desktop/src/design/components.test.ts` (300-line cap; it must keep passing), `design/node-fs.d.ts` (only `readFileSync(url, "utf8" | "latin1")` and `readdirSync` are typed; use those), `ui/glide.ts` (`parseCssTime`: confirm it parses `ms`, and write every duration token in `ms`), `scripts/mvp-ui-smoke.mjs` (rendered contrast in both schemes, 760 px).

## Implementation Plan

### Foundation: final sheet order and layers (pre-registered by F2)

The new `styles.css` is the complete list below. Later items never edit `styles.css`, `EXPECTED_SHEETS` or `layerOf`.

```css
@layer tokens, base, components, screens, utilities;
@import "./design/tokens.css" layer(tokens);
@import "./design/tokens-depth.css" layer(tokens);
@import "./design/tokens-motion.css" layer(tokens);
@import "./design/fonts.css" layer(tokens);          /* F1: last token sheet (its :root[data-platform] override) */
@import "./design/base.css" layer(base);
@import "./design/components.css" layer(components);
@import "./design/overlays.css" layer(components);
@import "./design/controls.css" layer(components);   /* B */
@import "./design/motion.css" layer(components);     /* B */
@import "./screens/app.css" layer(screens);
@import "./screens/shell.css" layer(screens);         /* C: directly after app.css */
@import "./screens/home.css" layer(screens);
@import "./screens/board.css" layer(screens);
@import "./screens/projects.css" layer(screens);
@import "./screens/workflows.css" layer(screens);
@import "./screens/candidate-review.css" layer(screens);
@import "./screens/project-components.css" layer(screens);
@import "./screens/help.css" layer(screens);
@import "./screens/settings.css" layer(screens);
@import "./screens/sessions.css" layer(screens);      /* D: after settings, before tailwind */
@import "./design/tailwind.css" layer(utilities);
```

Put the per-line comments in the manifest's header comment, not inline. The manifest test splits on `;`, and a comment after a `;` becomes part of the next element. The test strips comments before splitting, so inline comments would work, but keep the lines clean.

`EXPECTED_SHEETS` lists the same sheets in the same order, with `styles.css` first. Replace the line-41 ternary with:

```ts
const TOKEN_SHEETS = ["design/tokens.css", "design/tokens-depth.css", "design/tokens-motion.css"];
function layerOf(sheet: string): string {
  if (TOKEN_SHEETS.includes(sheet) || sheet === "design/fonts.css") return "tokens";
  if (sheet === "design/base.css") return "base";
  if (sheet === TAILWIND) return "utilities";
  if (sheet.startsWith("screens/")) return "screens";
  return "components"; // components, overlays, controls, motion
}
```

**Stub files.** The manifest test needs each non-manifest sheet to be non-empty after comment stripping and to contain at least one rule (`rules()` matches `selector { body }`, and an empty body counts). A comment-only stub fails. Each stub is therefore:

```css
/*
 * <purpose>. Owned by item <X> (run stripe-ui-20261022-0905); filled in wave <n>.
 * Placeholder: the manifest test requires one rule. Item <X> replaces this file's content.
 */
:root {}
```

This passes every current and revised check: no declarations, no media, nothing to resolve. The builder confirms it by running `npx vitest run src/design` after creating the stubs (Task 3). The purposes are:

- `fonts.css`: platform fonts.
- `controls.css`: buttons, fields, switch, tabs, table.
- `motion.css`: keyframes and motion primitives.
- `shell.css`: sidebar, nav pill, page header, view transitions.
- `sessions.css`: Sessions refinements.

**F1 runs in parallel.** At step 1, check whether `apps/desktop/src/design/fonts.css` already exists on the branch:

- If it exists, keep it untouched and only register it.
- If it does not, create the stub. If F1 later merges a full `fonts.css`, the integrator takes F1's content wholesale, and drops F1's duplicate manifest line, `EXPECTED_SHEETS` entry and line-41 edit, because `layerOf` already maps the sheet. Record this in the report for the integrator.

B, C and D find their sheets already registered and only replace the stub content. Their specs' registration steps become no-ops.

### Core: tokens

Comments in every token sheet must not contain the word "Stripe". D's check `git grep -i stripe -- apps/desktop/src` must print nothing. Use phrases like "calm, precise product look".

#### `tokens.css` (colours, tones, type, layout; target 285 lines or fewer)

1. **Moves out.**
   - Shape (`--radius-*`, `--border-width`, `--rule-width`, `--focus-*`, `--mark-*`, `--caret-*`, lines 113-126) goes to `tokens-depth.css`, with values unchanged except the radii.
   - Shadows and scrim (lines 68-72, 230-233) go to `tokens-depth.css`.
   - Everything else stays.
   - The motion block (lines 170-179) and its reduced-motion block (253-258) stay in place, unchanged except that `--ease: ease-out` moves to `tokens-motion.css` (see there), so ADR 0031's statement that these tokens live in `tokens.css` remains true.
   - The responsive (920/680) and `prefers-contrast` blocks stay. Every token they override must remain defined in `tokens.css` above them, because a later sheet's `:root` would beat an earlier `@media` override.
2. **Colour roles.** Both schemes use identical names, and every colour is `#rrggbb`. The planner verified the values below against every pair in the revised `PAIRS` list (Task 4), using the test's WCAG formula: 0 failures. The lowest light-scheme figures were text-subtle 4.74, accent 4.85, focus 4.10, border-control 3.06 and the success mark 3.74. The builder re-verifies with the test, and may tune values as long as the test passes.

   | Role | Dark | Light | Notes |
   | --- | --- | --- | --- |
   | `--color-bg` | `#0a1628` | `#f6f9fc` | page |
   | `--color-sidebar` | `#0c192d` | `#f0f4f8` | |
   | `--color-surface` | `#101c30` | `#ffffff` | card |
   | `--color-surface-raised` | `#17243a` | `#f8fafc` | row, tray, hover |
   | `--color-surface-sunken` | `#071121` | `#eef2f7` | pre, wells; also the "subtle surface" role in B/C/D |
   | `--color-field` / `-disabled` | `#071121` / `#101c30` | `#ffffff` / `#eef2f7` | |
   | `--color-control` / `-hover` | `#17243a` / `#1f2e47` | `#ffffff` / `#f3f6fa` | |
   | `--color-selected` / `-border` | `#1f2353` / `#5e58d8` | `#efeeff` / `#b7b3ff` | |
   | `--color-accent-tint` (new) | `#1f2353` | `#efeeff` | pale accent fill (active nav, selected rows) |
   | `--color-border` | `#1f2c42` | `#e3e8ee` | hairline |
   | `--color-border-strong` (new) | `#2c3b55` | `#cbd5e1` | decorative stronger divider or hover edge; **not** a control boundary |
   | `--color-border-control` | `#6f819b` | `#7d8a9c` | control edges, 3:1 |
   | `--color-text` | `#e3e9f1` | `#30405a` | body |
   | `--color-text-heading` (new) | `#f5f8fc` | `#0a2540` | headings, titles |
   | `--color-text-muted` | `#a3b1c4` | `#55657c` | |
   | `--color-text-subtle` | `#97a6ba` | `#5b6b82` | |
   | `--color-text-disabled` | `#5f6f86` | `#a3acb9` | exempt |
   | `--color-accent` | `#9590ff` | `#5851ea` | blurple; primary, links, selection text |
   | `--color-accent-hover` | `#aaa6ff` | `#4b45c6` | |
   | `--color-accent-active` (new) | `#bdbaff` | `#3f3aa8` | pressed primary |
   | `--color-on-accent` | `#0a1628` | `#ffffff` | |
   | `--color-focus` | `#a29dff` | `#635bff` | outline, 3:1 |
   | `--color-selection` (new) | `#353a86` | `#d6d3ff` | `::selection` (text 7.29 light, 8.18 dark) |
   | `--color-scrollbar` (new) | `#34445c` | `#c3ccd8` | thumb, decorative |

3. **Tones.** The six names stay; only the values change. The style spec's names map as follows: success → `success`, warning → `attention`, critical → `danger`, info and running → `active`. `active` stays a cyan-leaning blue, so the runtime working never reads as the blurple developer-action colour (principle 6). Neutral is cool gray, and interrupted is plum.

   | Tone | Dark fg / bg / border / mark | Light fg / bg / border / mark |
   | --- | --- | --- |
   | success | `#8fe0b4` `#0f3326` `#1f5a42` `#4ccf8d` | `#0d5c41` `#d7f5df` `#9fd9b3` `#178a5b` |
   | active | `#8bd6f4` `#0c3044` `#1c5570` `#4bbfe8` | `#075580` `#ddf2fb` `#98d0e8` `#0a7bab` |
   | danger | `#ffb4c1` `#43182a` `#6e2a40` `#ff7d95` | `#b0102f` `#ffe7ec` `#f3b3c0` `#d01a3e` |
   | attention | `#f5d48b` `#372a0d` `#5e4818` `#efb840` | `#7d5200` `#fff1cc` `#e9cd82` `#a26800` |
   | neutral | `#c4cedc` `#1e2a3d` `#34445c` `#8a9bb2` | `#3c4b61` `#ebeff4` `#c9d2de` `#68778d` |
   | interrupted | `#e6c0f4` `#351f44` `#563569` `#cb90e7` | `#76308a` `#f5e8fa` `#dab6e7` `#90409f` |

4. **Type** (replaces lines 74-99, keeping lines 75-78 byte-identical).
   - Line 74 comment becomes: "Type. Apple keeps the system SF stack below; other platforms get the bundled Söhne through design/fonts.css (ADR 0032). The CSP loads nothing from outside the bundle."
   - New role tokens:

     | Role | Size | Line height (unitless) | Notes |
     | --- | --- | --- | --- |
     | display | `--text-display: clamp(36px, 4.5vw, 48px)` | `--leading-display: 1.08` | |
     | h1 | `--text-h1: 28px` | `--leading-h1: 1.21` | |
     | h2 | `--text-h2: 20px` | `--leading-h2: 1.4` | |
     | h3 | `--text-h3: 16px` | `--leading-h3: 1.5` | |
     | body | `--text-body: 14px` | `--leading-body: 1.43` | |
     | small | `--text-small: 13px` | `--leading-small: 1.38` | |
     | caption | `--text-caption: 12px` | `--leading-caption: 1.33` | |
     | label | `--text-label: 11px` | `--leading-label: 1.45` | |

   - Tracking: `--tracking-display: -0.02em`, `--tracking-h1: -0.015em`, `--tracking-h2: -0.01em`, `--tracking-label: 0.05em`.
   - Old names stay and become aliases:
     - `--text-2xs: var(--text-label)`, `--text-xs: var(--text-caption)`, `--text-sm: var(--text-small)`, `--text-md: var(--text-body)`, `--text-lg: var(--text-h3)`.
     - `--text-title: var(--text-h1)`. The 680 px block keeps overriding `--text-title: 22px`; also add `--text-h1: 24px` there.
     - `--text-xl`, `--text-wordmark`, `--text-glyph`, `--leading-*` (old), `--tracking-tight`, `--tracking-title` and `--tracking-wide` keep their values.
   - **Weights, a deliberate remap.** Söhne ships static faces 300/400/500/600/700, and CSS font matching renders 550 as 600 and 650 as 700, which is too heavy.
     - New: `--weight-light: 300`, `--weight-regular: 400`, `--weight-medium: 500`, `--weight-semibold: 600`, `--weight-bold: 700`.
     - `--weight-strong: var(--weight-semibold)`. It was 650.
     - `--weight-medium` was 550; the role keeps its name and now renders Söhne Kräftig exactly, and SF Pro exactly on Apple.
     - Document the remap: 550 → 500 and 650 → 600.
5. **Layout retune.** `--sidebar-width: 240px` (was 232) and `--nav-height: 34px` (was 32). No other layout token changes.

#### `tokens-depth.css` (new; about 75 lines)

Header comment: shape, elevation and decorative layers. This is a literal-holding token sheet. It has a dark `:root` and a light override under `prefers-color-scheme: light`, and every light name must also be defined in dark.

- **Shape.** These are the moved tokens.
  - New role radii: `--radius-chip: 4px`, `--radius-input: 4px`, `--radius-button: 6px`, `--radius-card: 8px`, `--radius-menu: 8px`, `--radius-dialog: 12px`, `--radius-pill: 999px`.
  - Old radius names become aliases: `--radius-sm: var(--radius-chip)`, `--radius-md: var(--radius-button)` (was 7), `--radius-lg: var(--radius-card)` (was 11), `--radius-full: var(--radius-pill)`.
  - `--border-width`, `--rule-width`, `--focus-width`, `--focus-offset`, `--focus-inset`, `--mark-size`, `--mark-stroke`, `--caret-size` and `--caret-length` keep their values.
  - New: `--focus-ring-width: 4px`.
- **Elevation.** Shadows are navy-tinted and layered in light. Dark depth comes from the lighter surface plus an inset highlight.

  | Token | Dark | Light |
  | --- | --- | --- |
  | `--shadow-card` | `inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(2,8,20,0.45)` | `0 1px 1px rgba(10,37,64,0.04), 0 2px 5px rgba(10,37,64,0.06), 0 0 0 1px rgba(10,37,64,0.04)` |
  | `--shadow-popover` | `inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(2,8,20,0.4), 0 16px 36px rgba(2,8,20,0.5), 0 0 0 1px rgba(255,255,255,0.08)` | `0 2px 5px rgba(10,37,64,0.08), 0 15px 35px rgba(10,37,64,0.12), 0 0 0 1px rgba(10,37,64,0.05)` |
  | `--shadow-dialog` | `inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 60px -12px rgba(2,8,20,0.6), 0 18px 36px -18px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)` | `0 30px 60px -12px rgba(50,50,93,0.25), 0 18px 36px -18px rgba(0,0,0,0.3), 0 0 0 1px rgba(10,37,64,0.05)` |
  | `--shadow-button` | `0 1px 1px rgba(2,8,20,0.4)` | `0 1px 1px rgba(10,37,64,0.06), 0 1px 2px rgba(10,37,64,0.06)` |
  | `--shadow-button-hover` | `0 4px 8px rgba(2,8,20,0.45), 0 1px 3px rgba(0,0,0,0.3)` | `0 4px 6px rgba(50,50,93,0.11), 0 1px 3px rgba(0,0,0,0.08)` |
  | `--shadow-inset-highlight` | `inset 0 1px 0 rgba(255,255,255,0.12)` | `inset 0 1px 0 rgba(255,255,255,0.15)` |
  | `--shadow-kbd` | `inset 0 -1px 0 rgba(255,255,255,0.08)` | `inset 0 -1px 0 rgba(10,37,64,0.12)` |
  | `--color-focus-ring` | `rgba(162,157,255,0.4)` | `rgba(99,91,255,0.25)` |
  | `--color-scrim` | `rgba(2,8,20,0.6)` | `rgba(10,37,64,0.4)` |
  | `--color-glow` | `rgba(149,144,255,0.12)` | `rgba(99,91,255,0.08)` |

  These are not hex values, so the contrast parity map ignores them. They are decorative or halo values. The 3:1 focus obligation is carried by `--color-focus` on the outline.

  Scheme-independent tokens:
  - `--shadow-focus: 0 0 0 var(--focus-ring-width) var(--color-focus-ring)`.
  - Old names become aliases: `--shadow-panel: var(--shadow-card)` and `--shadow-overlay: var(--shadow-popover)`. In dark the panel was `none` and now gets the inset highlight; that is intentional.
- **Decorative layers.**
  - `--gradient-aurora` (subtle, the default) and `--gradient-aurora-vivid`. Each is 3-4 `radial-gradient(...)` layers over `transparent`, in violet `#a960ee`, coral `#ff333d`, sky `#90e0ff`, amber `#ffcb57` and the accent, written as `rgba()`.
    - Light, subtle: alpha at most 0.22 per stop.
    - Dark, subtle: alpha at most 0.16 per stop.
    - Vivid: at most 0.35 in light and 0.24 in dark.
  - `--gradient-wash-scrim: linear-gradient(to bottom, transparent, var(--color-bg))`.
  - `--gradient-shimmer: linear-gradient(90deg, var(--color-surface-raised), var(--color-control-hover), var(--color-surface-raised))`.
  - `--blur-aurora: 40px`, `--glow-size: 320px`.
  - The header comment states the rule: text never sits on the vivid wash, and text over the subtle wash must meet 4.5:1 against the composited background (item Q measures this).

#### `tokens-motion.css` (new; about 70 lines plus the item B block)

- **Easings.**
  - `--ease-standard: cubic-bezier(0.2, 0, 0, 1)`
  - `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`. B's drift guard compares against these exact numbers.
  - `--ease-in: cubic-bezier(0.4, 0, 1, 1)`
  - `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`, for small elements only (switch thumb, chips).
  - `--ease-linear: linear`.
  - `--ease` stays the base easing that `base.css` uses. Redefine it here as `var(--ease-standard)` and remove `--ease: ease-out` from `tokens.css`.
- **Durations.** All are in `ms`, because `parseCssTime` reads them:
  - `--duration-press: 80ms`
  - `--duration-micro: 140ms`
  - `--duration-standard: 220ms`
  - `--duration-large: 340ms`
  - `--duration-count: 800ms`
  - `--duration-draw: 400ms`
  - `--duration-shimmer: 1400ms`
  - `--duration-pulse: 1800ms`
  - `--duration-ambient: 24000ms`
  - `--duration-stagger: 35ms`

  `--duration-fast: 120ms` and `--duration-follow: 160ms` stay in `tokens.css`.
- **Motion distances.**
  - `--lift-y: -1px`, an integer pixel, so text does not blur on the lift.
  - `--press-scale: 0.98`, `--enter-scale: 0.96`.
  - `--reveal-offset: 8px`, `--toast-offset: 12px`.
  - `--pulse-scale: 2.2`.
  - `--stagger-cap: 10`, documented only (B's JS constant must mirror it).
- **Component sizes** (the roles that B, C and D need):
  - `--button-height: 32px`, `--row-height: 40px`, `--row-height-lg: 44px`.
  - `--tab-indicator-height: 2px`, `--progress-height: 2px`, `--dot-size: 6px`.
  - `--switch-width: 32px`, `--switch-height: 18px`, `--switch-thumb: 14px`, `--switch-travel: 14px`.
- **Resting values for runtime-written variables.** These are needed because the lint requires every `var()` to resolve, and they mirror the existing `--menu-x` pattern: `--tab-x: 0px`, `--tab-y: 0px`, `--tab-scale: 0`, `--mx: 50%`, `--my: 50%`, `--i: 0`, `--pill-y: 0px`, `--pill-h: 0px`.
- **Reduced motion.** One `@media (prefers-reduced-motion: reduce) { :root { … } }` block sets:
  - every duration defined in this sheet to `0ms`;
  - `--lift-y: 0px`, `--press-scale: 1`, `--enter-scale: 1`, `--reveal-offset: 0px`, `--toast-offset: 0px`, `--pulse-scale: 1`.

  Comment in the block: zero durations make transitions instant. Looping and entrance animations must still be switched off per selector with `animation: none` in their owner's reduced-motion block. A 0 ms infinite animation ends at its no-fill rest state, but owners must not rely on that.
- **The item B block.** Last in the file:

  ```css
  /* item B: append-only. Component-dimension tokens added by item B. Each new --duration-* must also be zeroed in the reduced-motion block below. */
  :root {}
  @media (prefers-reduced-motion: reduce) { :root {} }
  ```

  The guard test (Task 4) reads every reduced-motion block in the token sheets, so a B duration not zeroed here fails the test.

#### Role → final token name map (for B, C, D)

| Role named in B/C/D | Final token |
| --- | --- |
| accent / hover / active / tint / on-accent | `--color-accent`, `--color-accent-hover`, `--color-accent-active`, `--color-accent-tint`, `--color-on-accent` |
| selected fill / edge | `--color-selected`, `--color-selected-border` |
| heading / body / muted / subtle / disabled text | `--color-text-heading`, `--color-text`, `--color-text-muted`, `--color-text-subtle`, `--color-text-disabled` |
| surfaces (page, sidebar, card, raised, subtle or sunken, field, control) | `--color-bg`, `--color-sidebar`, `--color-surface`, `--color-surface-raised`, `--color-surface-sunken`, `--color-field`, `--color-control`, `--color-control-hover` |
| hairline / strong / control edge | `--color-border`, `--color-border-strong` (decorative), `--color-border-control` (secondary button and field edges keep this 3:1 edge) |
| focus outline / halo | `--color-focus` + `--focus-width`/`--focus-offset`; halo `--shadow-focus` (`--focus-ring-width`, `--color-focus-ring`) |
| radius chip/input, button, card/menu, dialog, pill | `--radius-chip`, `--radius-input`, `--radius-button`, `--radius-card`, `--radius-menu`, `--radius-dialog`, `--radius-pill` |
| shadow card, popover, dialog, button, button-hover, inset highlight, kbd, focus | `--shadow-card`, `--shadow-popover`, `--shadow-dialog`, `--shadow-button`, `--shadow-button-hover`, `--shadow-inset-highlight`, `--shadow-kbd`, `--shadow-focus` |
| scrim, glow colour/radius, aurora, wash scrim, aurora blur, shimmer | `--color-scrim`, `--color-glow`, `--glow-size`, `--gradient-aurora`, `--gradient-aurora-vivid`, `--gradient-wash-scrim`, `--blur-aurora`, `--gradient-shimmer` |
| easing standard / out / in / spring / linear | `--ease-standard`, `--ease-out`, `--ease-in`, `--ease-spring`, `--ease-linear` |
| duration press, micro, standard, large, count, check-draw, shimmer, pulse, ambient, stagger step | `--duration-press`, `--duration-micro`, `--duration-standard`, `--duration-large`, `--duration-count`, `--duration-draw`, `--duration-shimmer`, `--duration-pulse`, `--duration-ambient`, `--duration-stagger` |
| lift, press scale, enter scale, reveal offset, toast slide, pulse scale | `--lift-y`, `--press-scale`, `--enter-scale`, `--reveal-offset`, `--toast-offset`, `--pulse-scale` |
| type display, h1, h2, h3, body, small, caption, label (+ leading, tracking) | `--text-{display,h1,h2,h3,body,small,caption,label}`, `--leading-{same}`, `--tracking-{display,h1,h2,label}` |
| weights | `--weight-light`, `--weight-regular`, `--weight-medium` (500), `--weight-semibold`/`--weight-strong` (600), `--weight-bold` |
| primary button height, row height, nav item, sidebar width, rail | `--button-height`, `--row-height`/`--row-height-lg`, `--nav-height` (34), `--sidebar-width` (240), `--sidebar-compact` |
| tab indicator, progress track, dots, switch | `--tab-indicator-height`, `--progress-height`, `--dot-size`, `--switch-{width,height,thumb,travel}` |
| runtime-written vars | `--tab-x`, `--tab-y`, `--tab-scale`, `--mx`, `--my`, `--i`, `--pill-y`, `--pill-h` |
| hover/pointer gate | `@media (hover: hover) and (pointer: fine)` (approved) |

### Core: lint revisions (`design-system.test.ts`)

Implement each rule as a small named function, so it can be tested against fixture strings. Keep `declarations()` and `rules()`. Add a balanced-brace helper, `splitAtRules(css, name)`, that returns `{ inside: string[]; outside: string }` for `@keyframes` and `@media` blocks. The current regexes cannot see nesting.

1. **Exemptions.** The tokens-only loop exempts all `TOKEN_SHEETS` (not only `tokens.css`) plus the manifest. Token sheets get their own test instead:
   - Outside `@media`, they contain only `:root` rules.
   - They declare only custom properties, plus `color-scheme` in `tokens.css`.
   - Their media queries are from the approved list.
   - In `tokens-depth.css`, the light block's names are a subset of the dark block's names.
2. **Opacity.** This replaces line 55. An `opacity` declaration is allowed only in two places:
   - (a) Inside an `@keyframes` block. The value is a unitless number in [0, 1] or a `var(--…)`.
   - (b) In a rule where every comma-separated selector part ends in a decorative pseudo-element (`::before`, `::after`, `::backdrop`, or `::view-transition-old(…)`/`::view-transition-new(…)`). The value must be exactly `0` or `1`. These are layers without text, toggled for state, such as a glow layer at rest and on hover.

   Anything else fails with: `opacity only inside @keyframes or as 0/1 on a decorative pseudo-element (ADR 0032)`. `transition`/`transition-property` naming `opacity` stays allowed, since it is a property name, not a declaration. Static dimming, partial opacity on elements and state encoding by opacity all fail.
3. **Media.** `MEDIA` gains `"(hover: hover)"` and `"(pointer: fine)"`. Nothing else is needed: B and C use `@supports` for feature gating, and `@supports` stays unrestricted.
4. **Durations and easings are tokens.**
   - For `transition`, `transition-duration`, `transition-delay`, `transition-timing-function`, `animation`, `animation-duration`, `animation-delay` and `animation-timing-function` outside token sheets, the value must not contain an easing keyword or function: `\b(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b(?!-)` or `(?:cubic-bezier|steps|linear)\(`. Literal times are already caught by the length/duration regex.
   - Every comma-separated item of a `transition`/`animation` shorthand that is not `none` must contain `var(--duration-` and `var(--ease`. A delay may be `calc(var(--i) * var(--duration-stagger))`.
   - `transition: all` fails.
   - Watch the keyword regex: names like `--ease-out` and `--ease-linear` appear inside `var(...)`, so strip `var\([^)]*\)` from the value before testing for keywords.
5. **Keyframes.** Every declaration inside `@keyframes` must be one of: `transform`, `translate`, `scale`, `rotate`, `opacity`, `background-position`, `clip-path`, `stroke-dashoffset`. `stroke-dashoffset` is allowed for B's paint-only check draw.
6. **Nothing left behind at rest.** `animation` or `animation-fill-mode` containing `forwards` or `both` fails unless every selector part ends in a pseudo-element. Entrances use `backwards`. C's view-transition pseudo-elements use `both`, which is allowed.
7. **Filters.** `filter`, `backdrop-filter` and `-webkit-backdrop-filter` values must match `^(?:none|(?:[a-z-]+\(var\(--[\w-]+\)\)\s*)+)$`, for example `blur(var(--blur-aurora))`.
8. **No `will-change`.** The property `will-change` fails everywhere (DESIGN-SYSTEM.md "Following live output").
9. **Contrast pairs** (both schemes):
   - `SURFACES` gains `color-accent-tint`, `color-control-hover` and `color-selection`.
   - `TEXT` gains `color-text-heading`.
   - Add `["color-on-accent", "color-accent-active", 4.5]`.
   - Add `color-focus` at 3:1 on `color-selected`, `color-accent-tint` and `color-sidebar`.
   - Add `color-border-control` at 3:1 on `color-sidebar` and `color-control-hover`.
   - Add `tone-*-mark` at 3:1 on `color-surface-sunken` for all tones.
   - `color-text-subtle` and `color-text-muted` on `color-selection` are covered by `TEXT × SURFACES`. If that is too strict, drop only `color-selection` from `SURFACES` and add explicit `["color-text", "color-selection", 4.5]` and `["color-text-heading", "color-selection", 4.5]`. Report which you chose.
   - Update the `dark.size > 40` floor only if needed (it rises).
10. **Reduced-motion coverage.** This is a new test:
    - `durations` = every `--duration-*` name declared in a non-media `:root` of any `TOKEN_SHEETS` file.
    - `reduced` = names declared inside every `@media (prefers-reduced-motion: reduce)` block of those files, with values matching `^0m?s$`.
    - Expect `durations ⊆ reduced` and the list to be non-empty (at least 12 today).
    - Also expect `--lift-y`, `--reveal-offset` and `--toast-offset` to be `0px`, and `--press-scale`, `--enter-scale` and `--pulse-scale` to be `1`, in reduced motion.
11. **Fixture tests** for rules 2, 4, 5, 6 and 7, in a `describe("lint rules")` block (or in `design/lint.test.ts` if split out):
    - Pass: `@keyframes a { from { opacity: 0; transform: translateY(var(--reveal-offset)); } }`; `.g::before { opacity: 0 }`; `transition: transform var(--duration-standard) var(--ease-out)`; `animation: a var(--duration-large) var(--ease-out) backwards`; `filter: blur(var(--blur-aurora))`.
    - Fail: `.x { opacity: 0.5 }`; `.x::before { opacity: 0.4 }`; `.x { opacity: 1 }` (an element, not a pseudo-element); `transition: color var(--duration-fast) ease-out`; `transition: all var(--duration-fast) var(--ease)`; `animation: a var(--duration-large) var(--ease-out) forwards` on `.x`; `@keyframes b { from { width: 0 } }`; `filter: blur(4px)`; `will-change: transform`.
12. Leave the remaining rules unchanged: tone mapping only in `components.css`, the runtime-state selector ban, three `>` steps, scroll regions, `outline: none` only on `main:focus`, and `var()` resolution (which now spans all sheets, stubs included).

### Integration: `base.css`, `tailwind.css`, docs

**`base.css`** (111 lines now; target 140 or fewer):

- `body`: `font-size: var(--text-body); line-height: var(--leading-body); font-weight: var(--weight-regular)`. Add `-moz-osx-font-smoothing: grayscale`. Keep `font-synthesis: none` and `text-rendering`. Rewrite the line-19-20 comment for ADR 0032:
  - transforms on text ancestors only transiently, during interaction or a one-time entrance, at integer pixels;
  - no `will-change`;
  - opacity only in keyframes.
- **Headings** (sizes still strictly decrease):
  - `h1` stays `--text-xl` (the wordmark), coloured `--color-text-heading`.
  - `h2`: `--text-h2` / `--leading-h2` / `--tracking-h2` / semibold.
  - `h3`: `--text-h3` / `--leading-h3` / semibold.
  - `h4`: `--text-body` / semibold.
  - `h1-h4`: `color: var(--color-text-heading)`.
  - The page title keeps `--text-title` from `app.css`, which now resolves to `--text-h1`.
- `small`: `--text-caption`. `label`: `--text-caption`, medium weight.
- **Numerals.** `time, data, output, td, th, kbd, [data-numeric] { font-variant-numeric: tabular-nums; }`. Use `font-variant-numeric`, never `font-feature-settings`, per F1's warning that it would re-enable mono ligatures. Components add the Tailwind `tabular-nums` utility or their own rule for classed numbers (`.nav-count`, `.count-up`).
- **Focus.** Keep `:focus-visible { outline: var(--focus-width) solid var(--color-focus); outline-offset: var(--focus-offset); }` exactly. It is never removed, and forced colours rely on it. Add a field halo: `input:focus-visible, textarea:focus-visible, select:focus-visible { outline-offset: 0; border-color: var(--color-focus); box-shadow: var(--shadow-focus); }`. B composes `--shadow-focus` with button shadows.
- **Selection.** `::selection { background: var(--color-selection); color: var(--color-text-heading); }`.
- **Scrollbars.** `html { scrollbar-color: var(--color-scrollbar) transparent; }` (inherited) and `:where(html, body *) { scrollbar-width: thin; }`. These are standard properties only. WKWebView uses overlay scrollbars and ignores them, which is acceptable. Forced colours ignore `scrollbar-color`.
- Buttons keep their current base rules. Restyling them is B's job. `transition` still uses `var(--duration-fast) var(--ease)`, which passes rule 4.

**`tailwind.css`**: inside `@theme inline reference` add:

- `--text-{display,h1,h2,h3,body,small,caption,label}: var(--text-…)`, each with a `--text-<x>--line-height: var(--leading-<x>)` companion;
- `--color-text-heading`, `--color-accent-tint`, `--color-border-strong`, `--color-surface-sunken`;
- `--radius-button`, `--radius-card`, `--radius-pill`;
- `--font-weight-semibold`.

Every value stays `var(--x)`, which the Tailwind test enforces. Add no shadow or duration theme keys, because Tailwind cannot parse var-only shadows. Update the header comment.

**Docs**:

- **ADR 0032** (`docs/decisions/0032-stripe-inspired-desktop-visual-language.md`). Status: Accepted, 2026-10-22. It amends ADR 0013 decision 3 and DESIGN-SYSTEM.md. The ADR may say "inspired by Stripe's public product style"; code and UI never name it.
  - **Context**: the restyle request; the existing blocking rules (above).
  - **Decisions**:
    1. Fonts. Apple keeps the system SF Pro stack. Other platforms use bundled Söhne (300-700, upright and italic) served from `'self'` with `font-src 'self'`. Nothing is fetched remotely. Item F1 owns the detail (`design/fonts.css`, the `data-platform` attribute, the CSP and the licensing notice in `THIRD-PARTY-NOTICES.md`: commercial Klim face, sole-user exception, remove or license before distribution). Weight tokens map 550 → 500 and 650 → 600.
    2. Colour and depth. A blurple accent, navy text and cool grays in both schemes with identical role names. New roles: accent active and tint, text heading, border strong, selection, scrollbar, focus halo. The six tones and their meanings are unchanged; record the style-spec name mapping (warning → attention, critical → danger, info → active). Layered navy-tinted shadows in light; lighter surfaces plus an inset highlight in dark. Gradients and aurora come from tokens only. The values are tuned approximations, not anyone's published tokens.
    3. Opacity. Revises "never opacity". Opacity is allowed only inside `@keyframes`, and as an exact 0/1 toggle on decorative pseudo-elements, with tokenised durations. It is never used for static dimming, disabled states or state encoding. Disabled stays a colour token. Every entrance ends at full opacity, so the rendered contrast audit measures it.
    4. Transform. Revises DESIGN-SYSTEM.md:136. Buttons and cards may lift 1 px on hover (an integer pixel, `--lift-y`) and scale to 0.98 on press (`--duration-press`). Entrances translate or scale only through a one-time keyframe with `backwards` fill. No transform remains on a text-bearing element at rest and there is no `will-change`. A resting transform is allowed only on decorative, text-free elements (marks, indicators, pills, washes) and on the off-screen skip link. Live output (`pre[data-live]`, `ol.events` and their ancestors) never gets transform, opacity, filter or entrance motion (ADR 0031).
    5. The active chip pulse. A CSS-only `::after` ring on `.state[data-tone="active"]` (B) and on the live connection mark (C). It signals that the runtime is working. It never encodes evidence or approval state. It is suppressed under reduced motion and forced colours. The tail caret stays steady: evidence never pulses.
    6. Motion budget and restraint:
       - Only `transform`, `opacity`, `background-position`, `clip-path` and `stroke-dashoffset` (the check draw) animate.
       - Durations: micro 140, standard 220, large 340 ms; ambient 24 s or more for decorative drift.
       - Entrances play once per mount, with the stagger capped at 10.
       - Motion conveys state or continuity, never decoration on evidence.
       - Under reduced motion there is no drift, shimmer, count-up or stagger, state changes are instant, and every duration token is 0 (test-enforced).
       - Durations and easings are tokens only (lint).
    7. Platform gating. WebView2 (evergreen Chromium) and macOS WKWebView differ:
       - Gate optional features with `@supports`: `view-transition-name`, `transition-behavior: allow-discrete`, `@starting-style`, `backdrop-filter` (with the `-webkit-` prefix for WKWebView).
       - In JS, use `document.startViewTransition?.()` with a direct-update fallback.
       - Hover effects are gated by `(hover: hover) and (pointer: fine)`.
       - Every gated feature has a static fallback that is complete and readable.
    8. Contrast. Every text pair meets 4.5:1 (marks, edges and focus 3:1) in both schemes, test-enforced. Text over a gradient must meet 4.5:1 against the composited background. Text never sits on the vivid wash. Item Q verifies rendered contrast in both schemes.
    9. Approvals and evidence never animate away. Plans, approval controls, hashes, checks, verdicts, baselines, publication records and alerts get no exit animation, fade, dim, auto-dismiss or hover-only visibility. Notices stay untimed.
  - **Alternatives**: an animation library (rejected: CSS plus DOM-free controllers suffice, and it would add a dependency); bundling SF Pro (rejected: licence); keeping system fonts (rejected by the owner).
  - **Consequences**: token split into three sheets plus `fonts.css`; final manifest pre-registered; lint revisions; item Q owns visual verification; unit tests are not rendering evidence.
- **DESIGN-SYSTEM.md** (affected sections only):
  - Header line 3: add ADR 0032.
  - Principles 6 and 7, and the "lavender" wording at lines 10-11 and 111: make it "accent (blurple)", and make "tokens" `design/tokens*.css`.
  - **Files block**: add `tokens-depth.css`, `tokens-motion.css`, `fonts.css` (F1), `controls.css` and `motion.css` (B), `screens/shell.css` (C) and `screens/sessions.css` (D), each with a one-line role. D's later Files-block edit for `sessions.css` then becomes a no-op; D still adds `ui/stats.tsx`.
  - Line 44: fonts are bundled from `'self'`, and nothing is fetched remotely.
  - **Tokens table**: new values and the new roles.
  - Line 74 **Scales**: rewrite for the type scale, weights 300-700 (550/650 remapped), radii 4/6/8/12/pill, shadows, motion tokens and fonts per ADR 0032. Keep the mono sentence.
  - **Components** Button row: hover lift and press scale; disabled still never uses opacity.
  - Line 136: revised transform/opacity sentence.
  - Add a short **Motion** section summarizing ADR 0032 decisions 4-7.
  - Accessibility line 144: reduced motion is instant everywhere, with no drift, shimmer, count-up or stagger.
  - **Enforcement** line 150: the revised lint list.
  - **Changing the system**: a new duration also goes into reduced motion.
- **CURRENT-ARCHITECTURE.md** line 53: append one sentence. "Since [ADR 0032](decisions/0032-stripe-inspired-desktop-visual-language.md) the desktop uses a blurple/navy visual language with bundled Söhne off Apple platforms, layered depth and a token-only, reduced-motion-safe motion budget; approvals and evidence never animate."
- **ADR 0013** and **ADR 0030** status lines: append "; amended by [ADR 0032](0032-stripe-inspired-desktop-visual-language.md) (fonts, opacity, transform, motion)".

## Step by Step Tasks

1. **Baseline.**
   - Run `git status` and `git log --oneline -10`, and record whether F1 has merged (`design/fonts.css` present) or any B/C/D sheet exists.
   - Run `cd apps/desktop && npx vitest run src/design` and `npm run test --workspace @luuna/desktop`. Record any pre-existing failures separately.
   - Confirm that `parseCssTime` in `ui/glide.ts` accepts `ms`.
2. **Write ADR 0032** first, then the docs edits (Integration → Docs). Check: the ADR's status is Accepted, it is dated 2026-10-22, and it links ADR 0013, 0030 and 0031.
3. **Manifest and stubs.**
   - Rewrite `styles.css` to the Foundation list, with the header comment updated to list owners.
   - Create stubs for `tokens-depth.css` and `tokens-motion.css` (filled in steps 4-5), and for `fonts.css` (only if absent), `controls.css`, `motion.css`, `screens/shell.css` and `screens/sessions.css`.
   - Update `EXPECTED_SHEETS`, `TOKEN_SHEETS` and `layerOf`.
   - Check: `npx vitest run src/design` passes the manifest test, which proves the `:root {}` stubs pass.
4. **Move shape, shadows and scrim** into `tokens-depth.css` with old values first. Run `npx vitest run src/design` (everything still resolves). Then add the new radius roles, shadows, focus halo, glow and gradients, in dark plus light.
5. **Write `tokens-motion.css`**: easings (move `--ease`), durations, distances, sizes, resting runtime variables, the reduced-motion block and the item B block.
6. **Retune `tokens.css`**: colour roles and tones (tables), the type scale and aliases, the weight remap, the layout retune, the line-74 comment. Check: at most 290 lines (`wc -l`), with room left for later roles.
7. **Revise the lint** (rules 1-12) with fixture tests. If the file would exceed about 280 lines, extract the pure helpers to `design/lint.ts` with `design/lint.test.ts`. Check: the fixture tests fail on each "fail" string and pass on each "pass" string.
8. **Fix existing sheets that the new lint flags.** Expected: none. Today's transitions use `var(--duration-fast) var(--ease)`, and `components.css` has no opacity or keyframes. If one is flagged, fix it with tokens only, without restyling, and report it.
9. **Update `base.css` and `tailwind.css`** (Integration).
10. **Validate.** Run every Validation Command. Also do a manual readability spot check if `npm run dev --workspace @luuna/desktop` can run locally: open `http://127.0.0.1:1420` in both OS schemes and confirm it is readable. Report it as not run if it cannot. Visual quality is item Q's.
11. **Report**, including:
    - every file changed;
    - `wc -l` of `tokens*.css`, `base.css` and `design-system.test.ts`;
    - the F1 `fonts.css` handling (stub created or existing kept, and the integrator instructions);
    - the final role → token table pointer (this spec);
    - any tuned colour values and their test results;
    - an explicit statement that rendering, motion feel and rendered contrast are unverified until item Q.
    Run `git status` and confirm that only the files listed in Relevant Files changed.

## Testing Strategy

- **Static lint** (`design-system.test.ts`, run by `npm test`):
  - manifest order and layers via `layerOf`;
  - the token-sheet structure test;
  - tokens-only rules on every non-token sheet, including the stubs;
  - `var()` resolution across all sheets;
  - colour-role parity and depth-sheet light ⊆ dark;
  - WCAG pairs in both schemes, including the new roles;
  - reduced-motion coverage derived from the token sheets.
- **Rule fixtures**: the pass and fail strings in lint rule 11 prove each new rule both accepts and rejects. A rule that cannot fail is not evidence.
- **Regression**: `components.test.ts` (300-line cap) and every existing desktop test pass unchanged. Old token names resolve: the `var()` test covers every existing `var(--x)` reference in the current sheets.
- **Build**: `npm run build` compiles Tailwind with the new theme keys, and Vite bundles the stubs.
- **Not proven here**: real WebView2 and WKWebView rendering, Söhne weights, the feel of the shadows, contrast over gradients and motion quality. These are item Q's, with Playwright screenshots in both schemes at 1280 and 760 px, the smokes, and reduced-motion emulation.

## Acceptance Criteria

- [ ] ADR 0032 exists (Accepted, 2026-10-22) and covers fonts, colour/depth, opacity, transform, pulse, the motion budget, platform gating, contrast and evidence permanence. DESIGN-SYSTEM.md, the ADR 0013 and 0030 status lines and CURRENT-ARCHITECTURE.md line 53 are updated. No "Stripe" appears under `apps/desktop/src`.
- [ ] `tokens.css` is at most 290 lines. `tokens-depth.css` and `tokens-motion.css` exist. Every token name that existed before this item still resolves. Both schemes define identical colour roles. Font lines 75-78 are byte-identical.
- [ ] The new roles exist in both schemes and pass contrast: accent hover/active/tint, text heading, border strong, selection, scrollbar, and the focus halo. Every role in the role → token table is defined.
- [ ] The weights are 300/400/500/600/700. `--weight-medium` is 500 and `--weight-strong` is 600.
- [ ] Every `--duration-*` is zeroed under reduced motion, and the test derives the list from the token sheets.
- [ ] `styles.css`, `EXPECTED_SHEETS` and `layerOf` already contain every F1, B, C and D sheet in the final order. The stubs pass the lint.
- [ ] Opacity, media, duration/easing, keyframe, fill-mode, filter and `will-change` rules are enforced, with passing and failing fixtures.
- [ ] `base.css` applies the type scale, tabular numerals, smoothing, a never-removed focus outline plus field halo, the selection colour and thin scrollbars. `tailwind.css` references only tokens.
- [ ] All validation commands pass. The app remains readable in both schemes before waves 2 and 3.

## Validation Commands

The commands come from `apps/desktop/package.json`, the root `package.json` and the run notes. There is no TAC section in `AGENTS.md`. Run them from the repo root unless stated.

- `cd apps/desktop && npx vitest run src/design`: lint, the fixtures, contrast in both schemes, reduced-motion coverage, the manifest, and the 300-line cap.
- `npm run typecheck --workspace @luuna/desktop`
- `npm run test --workspace @luuna/desktop`
- `npm run build`
- `wc -l apps/desktop/src/design/tokens.css apps/desktop/src/design/tokens-depth.css apps/desktop/src/design/tokens-motion.css apps/desktop/src/design/base.css apps/desktop/src/design/design-system.test.ts`: each is at most 300, and `tokens.css` is at most 290.
- `git diff apps/desktop/src/design/tokens.css | grep -E "^[-+]\s+--font-(sans|display|mono):"`: must print nothing (font lines untouched).
- `git grep -n -i "stripe" -- apps/desktop/src`: must print nothing.
- `git diff --check`

## Notes

- **F1 parallelism.** Both F1 and F2 touch `styles.css` and `design-system.test.ts`, and may both create `design/fonts.css`. Resolution:
  - keep F2's manifest, `EXPECTED_SHEETS` and `layerOf`;
  - drop F1's duplicate registration;
  - keep F1's `fonts.css` content over the stub;
  - `fonts.css` stays the last `tokens`-layer import, so its `:root[data-platform="other"]` override wins over `tokens.css` `:root` through specificity.
- **B, C and D adjustments.** Their registration steps are no-ops. They replace stub content only. B appends its tokens only in the `item B` block of `tokens-motion.css`. C's pulse may use the unitless opacity values allowed in keyframes. C/D's "subtle surface" is `--color-surface-sunken`. Secondary buttons and fields keep `--color-border-control` as their edge; `--color-border-strong` is decorative.
- **Cascade caveat.** A token overridden in an `@media` block must be defined in the same sheet above that block. That is why layout, type and the follow tokens stay in `tokens.css` with their responsive and reduced-motion blocks.
- **Values are tuned recollections.** The planner computed contrast for the proposed palette with the test's own formula (0 failures). The shadows, gradients and motion values are starting points for item Q to tune. None of them is a published third-party token.
- **Risk.** Retuned colours, weights and h2/h3 sizes change today's unstyled screens. Spot-check readability. The 760 px no-horizontal-scroll smoke stays item Q's, since larger headings only wrap.
