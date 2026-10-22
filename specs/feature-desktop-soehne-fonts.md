# Feature: Desktop platform fonts (system SF Pro on Apple, bundled Söhne elsewhere)

## Metadata

- Type: feature
- Source: user request, confirmed October 22. The user approved bundling the 10 Söhne woff2 files. They are the sole user, and the licensing risk of this commercial Klim Type Foundry face is theirs.
- Date: 2026-10-22
- Orchestration: run `stripe-ui-20261022-0905`, wave 1, item F1. Branch `orchestrate/stripe-ui-20261022`. It runs in parallel with F2 (`specs/feature-desktop-stripe-foundation.md`). Items B and C depend on it.
- Run notes: `.tac/runs/stripe-ui-20261022-0905/{work-items,scout-design,style-spec}.md`
- Policy record: ADR 0032 is written by F2. It revises ADR 0013, ADR 0030 and `docs/DESIGN-SYSTEM.md` "no `@font-face`". **Do not write or edit any ADR or `docs/` file in this item.**

## Feature Description

The desktop app (`apps/desktop`) currently uses system font stacks only (`tokens.css:75-76`). This item adds platform-aware sans and display typography:

- Apple platforms (macOS, iPhone, iPad) keep the existing system SF Pro stack. SF Pro is not bundled and must not be.
- Every other platform (Windows WebView2, Linux WebKitGTK) uses the bundled Söhne, which covers weights 300, 400, 500, 600 and 700, each in upright and italic.
- The monospace stack (`--font-mono`) is unchanged.

## User Story

As the sole Luuna developer working on Windows, I want the desktop app to render in Söhne with the same weights the design calls for, while macOS keeps native SF Pro, so the restyled UI looks intentional on every platform.

## Solution Statement

1. Copy the fonts into `apps/desktop/src/assets/fonts/soehne/`.
2. Declare them in a new token-layer sheet, `design/fonts.css`. It contains:
   - 10 `@font-face` rules;
   - one metric-matched fallback face;
   - a `:root[data-platform="other"]` override of `--font-sans` and `--font-display`.
3. Before the first React render, `main.tsx` sets `document.documentElement.dataset.platform` to `"apple"` or `"other"`. A pure helper, `design/platform.ts`, computes the value.
4. Without the attribute, or with `"apple"`, the unchanged `tokens.css` SF stack applies. That means **`tokens.css` is not edited at all by F1**.
5. Harden delivery:
   - add an explicit CSP `font-src 'self'`;
   - make Vite never inline woff2 as `data:` URIs;
   - add a licensing notice.

Why the override lives in `fonts.css` rather than `tokens.css`:

- F2 owns and is rewriting/splitting `tokens.css` in parallel.
- `fonts.css` sits in the `tokens` layer, after every token sheet.
- Its `:root[data-platform="other"]` selector has specificity (0,2,0), which beats `:root` (0,1,0) inside the same layer whatever the import order.

## Out of Scope

- `tokens.css` and any other F2-owned token sheet, including type scale, weights, letter-spacing and `tabular-nums` (all F2). Also `base.css`, `tailwind.css`, `docs/`, the ADRs, components, screens and the TUI.
- Changes to `--font-mono` or code/pre typography.
- Bundling, referencing or fetching SF Pro. Remote font loading of any kind.
- Enabling OpenType stylistic sets or other `font-feature-settings` globally (see Typography polish).
- Distribution or registry publication. Committing, unless the orchestrator authorizes it.
- Stripe names, logos or assets.

## Relevant Files

- `AGENTS.md`, `AI-START-HERE.md`, `docs/CURRENT-ARCHITECTURE.md`, `docs/decisions/0013-*.md`, `docs/decisions/0030-desktop-shell-and-tailwind.md`: read first (repository rule).
- Source fonts (verified, read-only input): `C:\Users\localhost\AppData\Local\Temp\claude\C--Users-localhost-github-luuna\ac24d40e-d067-4b01-9273-8272f2901b53\scratchpad\soehne-dl\`.
  - It holds `soehne-{leicht,buch,kraftig,halbfett,dreiviertelfett}{,-kursiv}.woff2`, about 36-40 KB each.
  - Ignore `soehne.ts` there. It is a Next.js `localFont` example; copy only its weight mapping.
- Font inspection script (already written, read-only, Node built-ins only): `C:\Users\localhost\AppData\Local\Temp\claude\C--Users-localhost-github-luuna\ac24d40e-d067-4b01-9273-8272f2901b53\scratchpad\fontcheck\inspect.mjs`. Run it as `node <script> <font-dir>`.
- `apps/desktop/src/assets/fonts/soehne/*.woff2` (new, 10 files): the bundled fonts. File names stay lowercase and unchanged.
- `apps/desktop/src/design/fonts.css` (new): the `@font-face` rules, the fallback face and the platform token override.
- `apps/desktop/src/design/platform.ts` (new): the pure `detectPlatform` helper and the `applyPlatform` DOM setter.
- `apps/desktop/src/design/platform.test.ts` (new): unit tests for the helper.
- `apps/desktop/src/design/fonts.test.ts` (new): checks the fonts' integrity and declarations, plus the `main.tsx` ordering check.
- `apps/desktop/src/main.tsx`: set the platform before `createRoot` (`main.tsx:6`).
- `apps/desktop/src/styles.css`: the layer manifest. Add one `@import` line. F2 owns this file, so keep the edit to one line.
- `apps/desktop/src/design/design-system.test.ts`: `EXPECTED_SHEETS` (line 20) and the layer mapping expression (line 41). F2 owns this file, so keep the edit minimal.
- `apps/desktop/src/design/tokens.css:74-78`: the existing font tokens. **Read only, do not edit.**
- `apps/desktop/src/design/base.css:14,36,39`: the body font and the mono/code feature settings. Read only.
- `apps/desktop/src-tauri/tauri.conf.json:15`: the CSP string.
- `apps/desktop/vite.config.ts:10`: the `build` options.
- `THIRD-PARTY-NOTICES.md`: the licensing notice.
- `apps/desktop/src/design/node-fs.d.ts`: minimal `node:fs` typings. It has only `readFileSync(url, "utf8" | "latin1")` and `readdirSync`. Use those. Do not widen it unless strictly needed; F2 may also touch it.
- `scripts/check-hygiene.mjs`: the hygiene check.

## Implementation Plan

### Foundation: verified font facts (planner ran `inspect.mjs`; builder must re-run it)

These facts are the same for all 10 files:

- Format: WOFF2 (`wOF2` magic).
- Size: 509 code points, up to U+2265. This is a Latin subset.
- Metrics: unitsPerEm 1000; hhea and typo ascent 1171, descent -423, lineGap 0. `usWeightClass` matches the names: leicht 300, buch 400, kraftig 500, halbfett 600, dreiviertelfett 700.
- GSUB features: `calt case ccmp dnom frac liga locl numr ordn sinf ss01 ss02 sups tnum zero`.
- GPOS features: `kern mark`.

Glyph coverage was checked against every non-ASCII character that appears in the desktop TSX/CSS (found by a scan of `apps/desktop/src`, tests excluded):

- **Present in Söhne:** `…` U+2026, `·` U+00B7, `›` U+203A, `–` U+2013, `’` U+2019, `“ ”` U+201C/D, `← ↑ ↓` U+2190/2191/2193, plus `→` U+2192 and `•` U+2022.
- **Missing from Söhne:** `◌` U+25CC (`ui/content.tsx`), `✓` U+2713, box drawing U+2500/2502, `⌘` U+2318 and `↵` U+21B5.

The browser renders missing glyphs per character from the next family in the stack (Segoe UI or Segoe UI Symbol on Windows; system-ui on Linux). That is acceptable, and no other font is added.

The builder re-runs the inspection before writing CSS:

```
node "C:\Users\localhost\AppData\Local\Temp\claude\C--Users-localhost-github-luuna\ac24d40e-d067-4b01-9273-8272f2901b53\scratchpad\fontcheck\inspect.mjs" apps/desktop/src/assets/fonts/soehne
```

- Run it after copying the files.
- Also re-scan the TSX for non-ASCII glyphs, because B, C and D add glyphs later. If you add new glyphs to the script's `NEED` list, edit a copy in your own scratchpad.
- If the script is missing, recreate the method. Read the WOFF2 table directory, `zlib.brotliDecompressSync` the table stream, then read `cmap` (formats 4 and 12), `OS/2`, `hhea` and the GSUB/GPOS FeatureList tags. Do not `pip install` anything.
- Record the actual output in the final report.

### Core

#### 1. Copy the fonts

Copy the 10 woff2 files byte for byte into `apps/desktop/src/assets/fonts/soehne/`. There is no `public/` directory. The fonts go through the Vite asset pipeline, which hashes them into `dist/assets/`.

#### 2. Write `design/fonts.css` (new)

- Start with a header comment that explains:
  - Söhne is commercial (Klim Type Foundry) and bundled at the sole user's direction; see `THIRD-PARTY-NOTICES.md` and ADR 0032.
  - Apple keeps the system SF stack from `tokens.css`.
  - The GSUB features available for scoped use by later items: `case`, `tnum`, `zero`, `frac`, `ss01`, `ss02`.
- Add 10 rules of this form:

  ```css
  @font-face { font-family: "Söhne"; src: url("../assets/fonts/soehne/soehne-buch.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
  ```

  - The weight mapping is leicht 300, buch 400, kraftig 500, halbfett 600, dreiviertelfett 700.
  - `-kursiv` means `font-style: italic`.
  - `url()` paths are relative and quoted. Vite rebases and hashes them.
  - Write the family name literally as `"Söhne"`, and save the file as UTF-8 without BOM.
- Add one fallback face to reduce layout shift during the swap:

  ```css
  @font-face { font-family: "Söhne Fallback"; src: local("Segoe UI"), local("Arial"), local("Liberation Sans"); ascent-override: 117.1%; descent-override: 42.3%; line-gap-override: 0%; }
  ```

  - The overrides are 1171/1000, 423/1000 and 0, taken from the verified metrics.
  - Omit `size-adjust` unless you measure it, for example by comparing the average advance of lowercase `a-z` in Söhne and Segoe UI in a real WebView. Do not guess a value.
- Add the platform override:

  ```css
  :root[data-platform="other"] {
    --font-sans: "Söhne", "Söhne Fallback", "Segoe UI Variable Text", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-display: "Söhne", "Söhne Fallback", "Segoe UI Variable Display", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  ```

  Do not set `--font-mono`.
- Lint compatibility. `fonts.css` is linted by the "uses tokens only" test, and the content above passes it: no px/ms/rem literals, no colours, no `opacity`, no `!important`, no media queries. Percentages and unitless weights are allowed. Do not add `unicode-range` or any length.

#### 3. Typography polish (deliberately minimal)

- Do **not** add `font-feature-settings` in F1.
- `calt`, `liga` and `kern` are on by default already.
- `font-feature-settings` inherits, and it overrides `font-variant-*`. Setting it on `:root` or `body` would re-enable Cascadia Mono's contextual ligatures, which `base.css:39` disables with `font-variant-ligatures: none`.
- Later items may enable `case` on uppercase labels, or `zero`, scoped to specific selectors. Only use features listed in the verified GSUB output.
- `tabular-nums` and type-scale or letter-spacing tuning belong to F2.
- Flag for F2 in the report: `--weight-medium: 550` and `--weight-strong: 650` (`tokens.css:95-96`) resolve to the static Söhne faces 600 and 700 under CSS font matching, so text renders heavier than intended. F2's planned 400/500/600 scale fixes this.

#### 4. `design/platform.ts` (new)

```ts
export type Platform = "apple" | "other";
export interface PlatformSource { userAgentData?: { platform?: string } | undefined; platform?: string; userAgent?: string }
export function detectPlatform(source: PlatformSource): Platform
export function applyPlatform(root: HTMLElement, source: PlatformSource): Platform
```

- `detectPlatform` checks, in order, the first non-empty value of `source.userAgentData?.platform`, then `source.platform`, then `source.userAgent`.
- It returns `"apple"` if that value matches `/\b(?:mac|iphone|ipad|ipod)/i`. Otherwise it returns `"other"`.
- The `\b` matters. The Windows Chromium UA contains `AppleWebKit`, which must not match.
- `navigator.userAgentData` is not in TypeScript's DOM lib, hence the local structural type.
- `applyPlatform` sets `root.dataset.platform` and returns the value.

#### 5. `main.tsx`

Before `createRoot(...)`, call:

```ts
applyPlatform(document.documentElement, navigator as PlatformSource)
```

- An inline `<script>` in `index.html` is blocked by the CSP, so the attribute is set in `main.tsx`.
- Before the module runs, `#root` is empty, so there is no visible flash.

### Integration

#### 1. `styles.css`

Insert `@import "./design/fonts.css" layer(tokens);` immediately after the last token sheet import. Today that is right after the `tokens.css` line. If F2 has already split tokens into several sheets, insert it after the last `design/tokens*` import.

#### 2. `design-system.test.ts`

- Add `"design/fonts.css"` to `EXPECTED_SHEETS` at the same position as in the manifest.
- Change the layer mapping on line 41 so that `design/fonts.css` maps to `tokens`. The minimal form is `sheet === TOKENS || sheet === "design/fonts.css" ? "tokens" : ...`. If F2 has already generalized the expression, for example `sheet.startsWith("design/tokens")`, extend that form instead.
- Do not touch any other test.

#### 3. `tauri.conf.json` CSP

Insert `font-src 'self'; ` after `img-src 'self' data:; `. Keep every other byte identical. The result:

```
default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'; frame-src 'none'
```

#### 4. `vite.config.ts`

```ts
build: { target: "es2022", assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined) }
```

- The function form is supported in Vite 7.
- Other assets keep Vite's default 4 KiB inlining, which matters because `img-src` allows `data:`.

#### 5. `THIRD-PARTY-NOTICES.md`

Append a "Bundled fonts" section. It must state that Söhne:

- is a commercial typeface by Klim Type Foundry (https://klim.co.nz);
- is bundled in `apps/desktop/src/assets/fonts/soehne/` at the sole user's direction, for personal, non-distributed use on non-Apple platforms;
- is **not** covered by Luuna's MIT license or any Luuna license grant;
- must be removed or properly licensed before any distribution, publication or packaging of the desktop app.

Do not alter the existing table or text.

#### 6. Tell F2 (in the report, not in files)

- F2 should keep `fonts.css` in the `tokens` layer as the final token sheet.
- F2 should update the stale `tokens.css:74` comment ("System fonts only") and `docs/DESIGN-SYSTEM.md:74`, which says no `@font-face`, under ADR 0032.

## Step by Step Tasks

1. Read `AGENTS.md`, `AI-START-HERE.md` and `docs/CURRENT-ARCHITECTURE.md`, then run `git status`. Confirm that `apps/desktop/src/assets/` does not exist, and record whether F2 has already changed `styles.css` or `design-system.test.ts`.
2. Copy the 10 woff2 files into `apps/desktop/src/assets/fonts/soehne/`.
3. Run the inspection script on the copied files and confirm the facts in the Foundation section. Re-scan `apps/desktop/src` for non-ASCII glyphs, and list in the report any glyph used by the UI that Söhne lacks.
4. Create `design/platform.ts` and `design/platform.test.ts`, and run `npx vitest run src/design/platform.test.ts` from `apps/desktop`.
5. Wire `applyPlatform` into `main.tsx` before `createRoot`.
6. Create `design/fonts.css` as specified.
7. Register `fonts.css` in `styles.css`, and in `EXPECTED_SHEETS` plus the layer mapping in `design-system.test.ts`.
8. Create `design/fonts.test.ts`.
9. Edit the CSP in `tauri.conf.json` and `assetsInlineLimit` in `vite.config.ts`.
10. Append the notice to `THIRD-PARTY-NOTICES.md`.
11. Run all validation commands, inspect `dist`, fix any failures this item introduced, and report unrelated failures separately. Run `git status` again and confirm that only F1-owned files changed (plus the one-line edits to `styles.css` and `design-system.test.ts`).

## Testing Strategy

`design/platform.test.ts` is pure, with no DOM. Vitest runs in the default Node environment. It covers:

- `userAgentData.platform` `"macOS"` gives apple, and `"Windows"` and `"Linux"` give other.
- `userAgentData` absent with `platform` `"MacIntel"`, `"iPhone"` or `"iPad"` gives apple, and `"Win32"` or `"Linux x86_64"` gives other.
- An empty platform falls back to the userAgent. A real Windows Chrome/WebView2 UA (containing `AppleWebKit`) gives other. An iPadOS desktop-mode UA (`Macintosh`) gives apple. An Android UA gives other. An empty input gives other.
- `userAgentData.platform` wins over a conflicting `platform`.
- `applyPlatform` writes `dataset.platform` on a plain object stub cast to `HTMLElement`, for example `{ dataset: {} }`.

`design/fonts.test.ts` reads files with `readFileSync(url, "utf8" | "latin1")`, because Vitest's `?raw` CSS import returns `""`. It checks the following:

1. There are exactly 10 `@font-face` blocks with `font-family: "Söhne"`. The set of (weight, style) pairs equals {300,400,500,600,700} × {normal,italic}, with no duplicates.
2. Each block has `font-display: swap`, `format("woff2")` and a relative `url()`.
3. Each url resolves, via `new URL(src, cssUrl)`, to a file that exists. The file starts with `wOF2` (read as latin1) and is larger than 4096 bytes.
4. Each file name agrees with its weight and style (leicht 300 … dreiviertelfett 700; `-kursiv` ↔ italic).
5. Every `.woff2` file in `assets/fonts/soehne/` is referenced. List them with `readdirSync`.
6. The `:root[data-platform="other"]` block sets `--font-sans` and `--font-display`, each starting with `"Söhne"`, and does not set `--font-mono`.
7. In `main.tsx`, the source index of `applyPlatform(` is before `createRoot(`.

The existing design lint (`design-system.test.ts`: manifest order, tokens-only, var() resolution) and `components.test.ts` (300-line cap) must pass with `fonts.css` included.

Build inspection: after `npm run build`, `apps/desktop/dist/assets/` contains 10 `soehne-*.woff2` files, and the built CSS contains no `data:font` or `data:application/font` URIs.

Manual check, which cannot be automated here:

- Real Windows WebView2 rendering needs a human look. Run `npm run tauri dev --workspace @luuna/desktop` on Windows, confirm in DevTools (Computed, Rendered Fonts) that body text renders in "Söhne" with no CSP font errors in the console, and check italic and bold.
- macOS rendering (it must still be SF) cannot be verified on this Windows host. Report it as unverified.
- A fixture or unit test does not prove platform rendering.

## Acceptance Criteria

- 10 Söhne woff2 files live in `apps/desktop/src/assets/fonts/soehne/` with their original lowercase names, byte-identical to the source.
- `design/fonts.css` declares all 10 weight/style faces with `font-display: swap`, a fallback face with metric overrides, and the `data-platform="other"` sans/display override. The mono stack is untouched.
- `tokens.css` is unchanged by F1 (`git diff --stat apps/desktop/src/design/tokens.css` is empty for F1's changes). Apple, or a missing attribute, keeps the existing SF stack.
- `main.tsx` sets `data-platform` to `apple` or `other` before the first render, using the tested pure helper.
- The CSP contains `font-src 'self'`, and the rest of the string is byte-identical.
- Vite never inlines woff2, and `dist` holds 10 woff2 files with no `data:` font URIs.
- `THIRD-PARTY-NOTICES.md` states that Söhne is commercial (Klim), bundled at the sole user's direction, not MIT-covered, and must be removed or licensed before distribution.
- No `font-feature-settings` is enabled globally. The verified GSUB feature list is documented in the `fonts.css` header.
- All validation commands pass, and the report includes the inspection output, the glyph-coverage gaps and the manual Windows-check status.

## Validation Commands

The commands come from `apps/desktop/package.json`, the root `package.json` and the run notes. No TAC section exists.

- `npm run typecheck --workspace @luuna/desktop`
- `npm run test --workspace @luuna/desktop`, which includes `src/design/platform.test.ts`, `src/design/fonts.test.ts`, `design-system.test.ts` and `components.test.ts`.
- `cd apps/desktop && npx vitest run src/design`, the focused design suite.
- `npm run build`, which runs `tsc --noEmit && vite build` for `@luuna/desktop`.
- `ls apps/desktop/dist/assets/*.woff2 | wc -l`, which must print `10`.
- `grep -lE "data:(font|application/(x-)?font)" apps/desktop/dist/assets/*.css; test $? -eq 1`, which must find nothing.
- `grep -c "font-src 'self'" apps/desktop/src-tauri/tauri.conf.json`, which must print `1`.
- `git diff -- apps/desktop/src-tauri/tauri.conf.json`, to confirm the only change is the inserted `font-src 'self'; `.
- `node "C:\Users\localhost\AppData\Local\Temp\claude\C--Users-localhost-github-luuna\ac24d40e-d067-4b01-9273-8272f2901b53\scratchpad\fontcheck\inspect.mjs" apps/desktop/src/assets/fonts/soehne`
- `node scripts/check-hygiene.mjs`
- `git diff --check`

## Notes

- **Licensing:** This is a deliberate, user-approved exception. The repository is MIT and the font is not. The notice and ADR 0032 (F2) are the record. Anyone packaging or publishing the desktop app must remove the fonts or obtain a Klim licence first. Never describe the fonts as MIT-licensed.
- **Parallel work with F2:** The `styles.css` and `design-system.test.ts` edits are one line each and may conflict textually with F2's sheet split. The integrator keeps both. `fonts.css` stays the last `tokens`-layer import. Its override relies on same-layer specificity, so it must never move to a later layer that F2 might add above `tokens`.
- **Linux:** On Linux, `local("Segoe UI")` usually fails, so the fallback face falls through to Arial or Liberation Sans. If none exist, the face is skipped harmlessly.
- **During the swap:** The fallback face has no weight descriptor, so bold text may be briefly synthesized. Because the fonts are local bundle assets, the swap window is negligible.
- **Unverified:** Real Windows rendering needs a manual look. macOS SF retention is unverified on this host.
