# ADR 0035: match Mantine's default theme for the token layer, and use Outfit for headings

Date: 2026-10-22. Status: Accepted. Supersedes [ADR 0033](0033-ledger-design-system.md)'s palette (the Ledger colour values), its typography decisions (decision 3, the Ledger type styles and the Söhne font amendment and typography amendment); amends [ADR 0013](0013-desktop-design-system.md) decision 2 (tone colour families). Rules in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) follow this ADR.

## Context

The owner directed that the whole theming and CSS token layer match Mantine's default theme exactly, and that the font be the one mantine.dev uses. This deliberately replaces ADR 0033's Ledger palette, its type styles and its Söhne font. Mantine is used for **values only**: design tokens are facts, Mantine is MIT licensed, and no Mantine source or stylesheet is vendored.

**Values source.** `@mantine/core` 9.7.3 as served by jsDelivr (`esm/core/MantineProvider/default-theme.mjs`, `default-colors.mjs`, `styles.css`), plus mantine.dev's typography page and site CSS, read 2026-10-22 and recorded in [`specs/mantine-theme-values.md`](../../specs/mantine-theme-values.md). The typed truth table the tests use is `packages/ui/src/design/mantine-values.ts`.

## Decisions

1. **Adopt Mantine's default theme values.** Light is Mantine's light scheme (body `#fff`, text `#000`, default border gray-4, primary blue), dark is its dark scheme (body dark-7 `#242424`, text dark-0 `#c9c9c9`, default border dark-4, primary blue shade 8). The 14 palettes are available as `--color-<palette>-<0..9>`. Every ADR 0033 role name is kept so components keep working; only the values change. `design/mantine-tokens.test.ts` pins every token to `mantine-values.ts`, which replaces the Ledger `tokens.json` pin.
2. **Where Mantine's value fails the repo contrast gate, the nearest passing value is used and recorded here.** The gate is not weakened: text 4.5:1, marks, control edges and focus 3:1, computed from the hex in both schemes. The deviation table below is the complete list, and a test recomputes each ratio and requires the Mantine value to fail and the value used to pass.
3. **Fonts: Mantine's system stack for body and UI text, Outfit for headings, titles and display, at weight 600.** This is exactly the split mantine.dev uses: its docs body text uses Mantine's stack, and its titles, headings and nav titles use Outfit (`--docs-font-primary: "Outfit", sans-serif`, weight 600). `--font-sans` is the Mantine body stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"`), `--font-display` is `"Outfit"` followed by that stack, and `--font-mono` is Mantine's monospace stack. **To set the body in Outfit as well, change one token: `--font-sans: var(--font-display);`** in `tokens-scale.css`.
   - Outfit is SIL OFL 1.1. Two variable woff2 files (latin, latin-ext; `font-weight: 100 900`; Mantine's `unicode-range` for each; `font-display: swap`) are bundled in `packages/ui/src/assets/fonts/outfit/` with `OFL.txt`, served from `'self'`. Vite never inlines `.ttf` or `.woff2` as `data:` URIs, nothing is fetched remotely, and the CSP keeps `font-src 'self'`.
   - **Söhne is no longer referenced** by any stylesheet, test, script or document except as history. Its ten TTFs were deleted from the working tree at the owner's direction (2026-10-22) together with `platform.ts`, its test, its export and the `applyPlatform` call in `main.tsx`, which only set a `data-platform` attribute that no stylesheet read. The TTFs remain in Git history; a history purge is still the owner's decision and is required before publication (`THIRD-PARTY-NOTICES.md`). The `data-platform` and `data-type` font overrides are deleted.
4. **Type scale.** Mantine font sizes (`--font-size-xs..xl` 12, 14, 16, 18, 20 px), line heights (`--line-height-xs..xl` 1.4, 1.45, 1.55, 1.6, 1.65), weights (`--font-weight-regular` 400, `-medium` 600, `-bold` 700) and headings h1 to h6 (`--heading-N-size` 34, 26, 22, 18, 16, 14 px with line heights 1.3, 1.35, 1.4, 1.45, 1.5, 1.5). The body is `--font-size-md` (16 px), line height 1.55, antialiased. Mantine has no letter spacing, so every tracking token is `0em`. Because Mantine's medium weight is 600, Luuna's earlier medium (500) and semibold (600) both resolve to 600.
5. **Heading mapping (Luuna roles to Mantine's scale).** Mantine's headings are weight 700; Luuna sets them at 600 in Outfit, as mantine.dev does (`--font-weight-heading`).

   | Luuna role | Mantine | Size / line height | Weight |
   | --- | --- | --- | --- |
   | page title (`--text-page-title`, also the legacy `--text-h1`, `-display`, `-title`) | h2 | 26 px / 1.35 | 600 |
   | metric-lg and the wordmark (`--text-metric-lg`, legacy `--text-xl`) | h3 | 22 px / 1.4 | 600 |
   | section title (`--text-section-title`, legacy `--text-h2`) | h4 | 18 px / 1.45 | 600 |
   | body-strong (legacy `--text-h3`) | md | 16 px / 1.55 | 600 |
   | body | md | 16 px / 1.55 | 400 |
   | label | sm | 14 px / 1.45 | 600 |
   | caption, overline | xs | 12 px / 1.4 | 400, 600 |
   | metric | xl | 20 px / 1.4 | 600 |
   | mono | sm | 14 px / 1.55 | 400 |

   Mantine h1 (34 px) is `--heading-1-size`, used by `--text-glyph`; no Luuna role needs it as a heading. The `h1` to `h4` elements take the display face at weight 600 (`base.css`).
6. **Shape and elevation.** Radius `--radius-xs..xl` is 2, 4, 8, 16, 32 px (Mantine's default radius is md, 8 px); the existing `--radius-sm/md/lg/xl` names are those values. Panels, cards, dialogs and menus use md (8 px) as Mantine's default does, so component and screen sheets that read `--radius-lg` or `--radius-xl` now read `--radius-md` and `--radius-card` aliases md. Shadows `--shadow-xs..xl` are Mantine's exact strings. `--shadow-card` is xs in light and `none` in dark, `--shadow-button` is `none`, `--shadow-popover` is md.
7. **Tone mapping to Mantine palettes** (amends ADR 0013 decision 2 and replaces ADR 0033 decision 5's colours). Success is the teal family (Mantine's success role is teal-8). Active (the runtime is working) is the blue family, the primary and anchor colour; it is told apart from the accent by its ring mark and text exactly as before. Danger is the red family (Mantine's error role). Attention is the orange family (yellow and orange are Mantine's warning colours; orange is the only one dark enough to pass). Neutral is `ink-body` on `fill-strong` with an `ink-muted` mark (gray). **Interrupted shares the neutral family** as before; it stays distinct through its pause-bar mark and runtime text, and is never danger. The legacy tone aliases are unchanged and pinned.
8. **Surfaces and roles.** Surface is the body, surface-raised the paper/default ground (light), surface-muted gray-0 (light) or dark-8, fill gray-1 or dark-6, fill-strong gray-2 or dark-5, field the default ground, separator gray-3 or dark-5, border the default border. Ink is Mantine's `bright` (black or white), ink-body its `text`, ink-muted and ink-subdued its `dimmed` (adjusted below). Accent is the filled primary, accent-text the anchor, accent-hover the filled hover, focus-ring the focus ring (primary). Charts, banner, toast, `ai` and the soft status grounds have no Mantine role; they are palette shades (listed in `mantine-values.ts`).

## What stays from ADR 0032 and ADR 0033

The motion budget (only transform, opacity, background-position, clip-path and stroke-dashoffset animate; entrances play once; reduced motion zeroes durations; no `transition: all`, no `will-change`; duration and easing tokens), the opacity and transform rules, no gradients, no coloured left-border cards, platform-independent contrast, the focus ring (2 px, offset 2 px), evidence never animates, runtime authority, the six tones with three channels (colour family, shape mark, unchanged runtime text), `data-capability` and `data-surface` markers, light default with dark from `data-theme` or the OS, identical role names in both schemes, hex-only values, the five token sheets plus `fonts.css`, the legacy alias sheet, and the lints and bans. Dark cards and buttons keep no shadow (Mantine's dark scheme adds none to Paper by default).

## Contrast deviations (Mantine value, value used, ratios)

Each row is a role whose Mantine value fails in its scheme. The ratio is the foreground on the ground named in the pair, with every other token as used; `design/mantine-tokens.test.ts` recomputes both.

| Scheme | Token | Mantine value | Value used | Pair | Mantine | Used | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| light | `--ink-muted` | gray-6 `#868e96` | gray-7 `#495057` | ink-muted on surface | 3.32 | 8.18 | dimmed fails text contrast on white; gray-7 is the nearest passing shade |
| light | `--ink-subdued` | gray-6 `#868e96` | gray-7 `#495057` | ink-subdued on surface | 3.32 | 8.18 | same dimmed role and fix |
| light | `--border-strong` | gray-4 `#ced4da` | gray-6 `#868e96` | border-strong on surface | 1.49 | 3.32 | control edges need 3:1; default-border is a hairline |
| light | `--accent` | blue-6 `#228be6` | blue-8 `#1971c2` | ink-on-accent on accent | 3.56 | 5.02 | white on filled blue-6 fails |
| light | `--accent-hover` | blue-7 `#1c7ed6` | blue-9 `#1864ab` | ink-on-accent on accent-hover | 4.20 | 6.09 | one step darker than the accent |
| light | `--accent-text` | blue-6 `#228be6` | blue-8 `#1971c2` | accent-text on surface | 3.56 | 5.02 | anchor blue-6 fails on white |
| light | `--info` | blue-6 `#228be6` | blue-8 `#1971c2` | info on info-soft | 3.20 | 4.52 | info text on its tint |
| light | `--success` | teal-8 `#099268` | teal-9 `#087f5b` | success on success-soft | 3.68 | 4.67 | teal-8 text on its tint fails |
| light | `--danger` | red-6 `#fa5252` | red-9 `#c92a2a` | danger on danger-soft | 3.07 | 5.10 | red-8 passes on white (4.51) but not on its tint |
| light | `--warning` | orange-6 `#fd7e14` | `#c8420e` (orange-9 at 92%) | warning on warning-soft | 2.37 | 4.56 | the darkest orange, orange-9, is 4.30:1 on white and fails, so it is scaled to 92% (the lightest scale that passes every attention ground) |
| dark | `--ink-muted` | dark-2 `#828282` | dark-1 `#b8b8b8` | ink-muted on surface | 4.04 | 7.83 | dimmed fails on the dark body |
| dark | `--ink-subdued` | dark-2 `#828282` | dark-1 `#b8b8b8` | ink-subdued on surface | 4.04 | 7.83 | same dimmed role and fix |
| dark | `--border-strong` | dark-4 `#424242` | dark-2 `#828282` | border-strong on surface | 1.54 | 4.04 | control edges need 3:1 |
| dark | `--surface-raised` | dark-6 `#2e2e2e` | dark-7 `#242424` | accent on surface-raised | 2.70 | 3.09 | Mantine's paper ground leaves filled blue-8 marks under 3:1 on cards; cards share the body shade and are told apart by their border |
| dark | `--focus-ring` | blue-8 `#1971c2` | blue-7 `#1c7ed6` | focus-ring on field | 2.70 | 3.24 | the ring is under 3:1 on dark-6 fields |
| dark | `--success` | teal-8 `#099268` | teal-6 `#12b886` | success on surface | 3.93 | 6.08 | teal-8 text fails on the dark body |
| dark | `--danger` | red-8 `#e03131` | red-5 `#ff6b6b` | danger on surface | 3.44 | 5.59 | error red-8 fails on the dark body |
| dark | `--ink-on-danger` | white | black `#000000` | ink-on-danger on danger | 2.78 | 7.57 | white on the lighter dark danger fails |
| dark | `--warning` | orange-8 `#e8590c` | orange-6 `#fd7e14` | warning on surface | 4.34 | 6.04 | orange-8 text fails on the dark body |

Values that exactly match Mantine and also pass: light body, text, default border, disabled colour, focus ring (blue-6, 3.56:1 on white); dark body, text, default border, disabled colour, primary shade 8 (white on it is 5.02:1), anchor (blue-4, 6.27:1), field ground. Derived values that are not palette shades: the four dark soft grounds (`#22303c`, `#20352e`, `#402626`, `#412c20`) are the shade-8 colour of the family at 15% over the dark body (Mantine's light-variant alpha), and the light warning above. Dark `ink` is Mantine's `bright` (white) and dark `ink-body` its text (`#c9c9c9`); light dimmed text and dark dimmed text are nearly as strong as body text because of the 4.5:1 gate.

**Not mapped.** Mantine's placeholder colour (gray-5 2.07:1 on white, dark-3 2.83:1 on the body) fails text contrast; the placeholder keeps the `ink-muted` role (the legacy `--color-text-subtle`). The scrim keeps its earlier black at 40% (light) and 60% (dark): Mantine's overlay value was not part of the verified source.

## Consequences

- New custom properties (all literals live in token sheets): `--color-<palette>-<0..9>` for dark, gray, red, pink, grape, violet, indigo, blue, cyan, teal, green, lime, yellow and orange (in `tokens.css`); `--font-stack`, `--font-size-xs..xl`, `--line-height-xs..xl`, `--font-weight-regular|medium|bold|heading`, `--heading-1..6-size` and `--heading-1..6-line-height`, `--spacing-xs..xl` (10, 12, 16, 20, 32 px), `--breakpoint-xs..xl` (36, 48, 62, 75, 88 em) (in `tokens-scale.css`); `--radius-xs` and `--shadow-xs..xl` (in `tokens-depth.css`). The existing 4 px `--space-N` rhythm stays beside `--spacing-*`.
- The font-size lint still requires `var(--text-*)`; the Mantine `--font-size-*` names are available to token sheets and the legacy `--text-lg` alias, and a later pass may extend the lint.
- `fonts.css` is rewritten for Outfit; the Söhne `@font-face` rules, the metric fallback and the platform and `data-type` overrides are deleted. Body text is 16 px (was 14 px), so dense layouts are larger; no screen sheet was edited for that, and the real rendering has not been checked.
- Alternatives rejected: vendoring Mantine's CSS or components (the owner asked for values only); weakening the contrast gate to keep Mantine's exact colours; `light-dark()` (breaks the hex contrast parser); setting the body in Outfit (mantine.dev does not).
- Not verified here: any real rendering, WebView2 font loading, and the smoke script `node scripts/mvp-ui-smoke.mjs`.
