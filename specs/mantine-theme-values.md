# Mantine default theme values (reference for ADR 0035)

Source: `@mantine/core` 9.7.3 as served by jsDelivr (`esm/core/MantineProvider/default-theme.mjs`, `default-colors.mjs`, `styles.css`), read 2026-10-22, plus mantine.dev/theming/typography and the mantine.dev site CSS. Mantine is MIT licensed. These are design-token values (facts); no Mantine source or stylesheet is vendored. `rem(n)` = n/16 rem. Scale 1.

## Fonts

- Body (`fontFamily`, also `headings.fontFamily`): `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji`
- Mono: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace`
- mantine.dev (the docs site) body text uses the stack above. Its titles, headings, nav titles and the home title use **Outfit** (`--docs-font-primary: "Outfit", sans-serif`, loaded from Google Fonts as a variable font, weights 100 to 900): weight 600 for page and section titles and nav headings, 450 for the home title, 700 for index numbers. Docs base size is `.9375rem` (15px).
- Outfit is SIL OFL 1.1. Bundled: `packages/ui/src/assets/fonts/outfit/Outfit-latin.woff2`, `Outfit-latin-ext.woff2` (variable, `font-weight: 100 900`) and `OFL.txt`. Latin unicode-range: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`. Latin-ext: `U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF`.

## Type scale

| Token | Value |
|---|---|
| fontSizes xs / sm / md / lg / xl | 0.75 / 0.875 / 1 / 1.125 / 1.25 rem (12 / 14 / 16 / 18 / 20 px) |
| lineHeights xs / sm / md / lg / xl | 1.4 / 1.45 / 1.55 / 1.6 / 1.65 (body `--mantine-line-height` 1.55) |
| fontWeights regular / medium / bold | 400 / 600 / 700 |
| h1 | 2.125rem (34px), lh 1.3 |
| h2 | 1.625rem (26px), lh 1.35 |
| h3 | 1.375rem (22px), lh 1.4 |
| h4 | 1.125rem (18px), lh 1.45 |
| h5 | 1rem (16px), lh 1.5 |
| h6 | 0.875rem (14px), lh 1.5 |
| headings fontWeight / textWrap | 700 / wrap |
| body | font-size md (16px), line-height 1.55, antialiased (`-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`) |

## Radius, spacing, breakpoints

| Token | xs | sm | md | lg | xl |
|---|---|---|---|---|---|
| radius | 2px (0.125rem) | 4px | 8px | 16px | 32px |
| spacing | 10px (0.625rem) | 12px | 16px | 20px | 32px |
| breakpoints | 36em | 48em | 62em | 75em | 88em |

`defaultRadius` = md (8px). `primaryColor` = blue. `primaryShade` = light 6, dark 8. `cursorType` default. `focusRing` auto. `autoContrast` false. `luminanceThreshold` .3. `white` #fff, `black` #000.

## Shadows (scale 1; rem value in parentheses)

- xs: `0 1px 3px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.1)`
- sm: `0 1px 3px rgba(0,0,0,.05), rgba(0,0,0,.05) 0 10px 15px -5px, rgba(0,0,0,.04) 0 7px 7px -5px`
- md: `0 1px 3px rgba(0,0,0,.05), rgba(0,0,0,.05) 0 20px 25px -5px, rgba(0,0,0,.04) 0 10px 10px -5px`
- lg: `0 1px 3px rgba(0,0,0,.05), rgba(0,0,0,.05) 0 28px 23px -7px, rgba(0,0,0,.04) 0 12px 12px -7px`
- xl: `0 1px 3px rgba(0,0,0,.05), rgba(0,0,0,.05) 0 36px 28px -7px, rgba(0,0,0,.04) 0 17px 17px -7px`

## Colour palettes (shades 0 to 9)

| Palette | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| dark | #C9C9C9 | #b8b8b8 | #828282 | #696969 | #424242 | #3b3b3b | #2e2e2e | #242424 | #1f1f1f | #141414 |
| gray | #f8f9fa | #f1f3f5 | #e9ecef | #dee2e6 | #ced4da | #adb5bd | #868e96 | #495057 | #343a40 | #212529 |
| red | #fff5f5 | #ffe3e3 | #ffc9c9 | #ffa8a8 | #ff8787 | #ff6b6b | #fa5252 | #f03e3e | #e03131 | #c92a2a |
| pink | #fff0f6 | #ffdeeb | #fcc2d7 | #faa2c1 | #f783ac | #f06595 | #e64980 | #d6336c | #c2255c | #a61e4d |
| grape | #f8f0fc | #f3d9fa | #eebefa | #e599f7 | #da77f2 | #cc5de8 | #be4bdb | #ae3ec9 | #9c36b5 | #862e9c |
| violet | #f3f0ff | #e5dbff | #d0bfff | #b197fc | #9775fa | #845ef7 | #7950f2 | #7048e8 | #6741d9 | #5f3dc4 |
| indigo | #edf2ff | #dbe4ff | #bac8ff | #91a7ff | #748ffc | #5c7cfa | #4c6ef5 | #4263eb | #3b5bdb | #364fc7 |
| blue | #e7f5ff | #d0ebff | #a5d8ff | #74c0fc | #4dabf7 | #339af0 | #228be6 | #1c7ed6 | #1971c2 | #1864ab |
| cyan | #e3fafc | #c5f6fa | #99e9f2 | #66d9e8 | #3bc9db | #22b8cf | #15aabf | #1098ad | #0c8599 | #0b7285 |
| teal | #e6fcf5 | #c3fae8 | #96f2d7 | #63e6be | #38d9a9 | #20c997 | #12b886 | #0ca678 | #099268 | #087f5b |
| green | #ebfbee | #d3f9d8 | #b2f2bb | #8ce99a | #69db7c | #51cf66 | #40c057 | #37b24d | #2f9e44 | #2b8a3e |
| lime | #f4fce3 | #e9fac8 | #d8f5a2 | #c0eb75 | #a9e34b | #94d82d | #82c91e | #74b816 | #66a80f | #5c940d |
| yellow | #fff9db | #fff3bf | #ffec99 | #ffe066 | #ffd43b | #fcc419 | #fab005 | #f59f00 | #f08c00 | #e67700 |
| orange | #fff4e6 | #ffe8cc | #ffd8a8 | #ffc078 | #ffa94d | #ff922b | #fd7e14 | #f76707 | #e8590c | #d9480f |

## Semantic colour roles

| Role | Light | Dark |
|---|---|---|
| bright | black | white |
| text | #000 | dark-0 (#C9C9C9) |
| body (page ground) | #fff | dark-7 (#242424) |
| dimmed | gray-6 | dark-2 |
| default (control ground) | white | dark-6 |
| default-hover | gray-0 | dark-5 |
| default-border | gray-4 | dark-4 |
| default-color | black | white |
| error | red-6 | red-8 |
| placeholder | gray-5 | dark-3 |
| anchor | blue-6 | blue-4 |
| disabled / -color / -border | gray-2 / gray-5 / gray-3 | dark-6 / dark-3 / dark-4 |
| success | teal-8 | teal-8 |

Filled primary variant: background blue (shade 6 light, 8 dark), hover darkened ~10%, text white, border transparent.

## Known conflict with the repo contrast gate

Contrast is computed from the values above (WCAG relative luminance). White text on blue-6 (#228be6) and blue-6 link text on white are about 3.6:1, under the repo's 4.5:1 text rule; gray-6 dimmed text on white is about 3.5:1; gray-5 placeholder on white is about 2.1:1. Where Mantine's exact value fails the gate, use the nearest passing shade of the same palette and record each deviation in ADR 0035 (for example blue-8 #1971c2 for filled primary and anchor in light mode; gray-7 #495057 for dimmed). Do not weaken the gate.
