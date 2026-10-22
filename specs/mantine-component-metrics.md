# Mantine component metrics (reference for restyling Luuna CSS)

Source: `@mantine/core` 9.7.3 `styles.css` (MIT; design-token facts only, no source vendored), read 2026-10-22. Theme tokens (palettes, radius, spacing, shadows, fonts) are in `specs/mantine-theme-values.md`; this file adds per-component metrics. `rem(n)` = n/16 rem; px shown at root 16px. Scale 1. "not found" = value is not in the stylesheet (set by JS inline custom properties or the theme object).

Conventions: L = light scheme, D = dark scheme. `radius` = `--mantine-radius-default` = 0.5rem (8px). Semantic names: `default` = L white / D dark-6; `default-hover` = gray-0 / dark-5; `default-border` = gray-4 / dark-4; `disabled` = gray-2 / dark-6; `disabled-color` = gray-5 / dark-3; `disabled-border` = gray-3 / dark-4; `dimmed` = gray-6 / dark-2; `placeholder` = gray-5 / dark-3; `error` = red-6 / red-8; `primary-filled` = blue-6 / blue-8; `primary-filled-hover` = blue-7 / blue-9; `primary-light` = blue-1 / rgba(12,50,86); `primary-light-hover` = blue-2 / rgba(17,70,120); `primary-light-color` = blue-9 / blue-0.

Important: Button, Input, Select and most controls default to size **sm**, not md. ActionIcon, Avatar-ladder default is md. The size ladders below are listed xs/sm/md/lg/xl.

## Button (`--button-*`)

| Property | Default (sm) | Ladder xs/sm/md/lg/xl | Source |
|---|---|---|---|
| height | 2.25rem / 36px | 30/36/42/50/60px | `--button-height-*` |
| padding-inline | 1.125rem / 18px | 14/18/22/26/32px | `--button-padding-x-*` |
| compact height | sm 1.625rem / 26px | 22/26/30/34/40px | `--button-height-compact-*` |
| compact padding-x | sm 0.5rem / 8px | 7/8/10/12/14px | `--button-padding-x-compact-*` |
| font-size | 0.875rem / 14px | per-size value not found (`--button-fz` inline) | `font-size: var(--button-fz, font-size-sm)` |
| font-weight / line-height | 600 / 1 | - | `--mantine-font-weight-medium` |
| radius | 8px | - | `--button-radius` |
| border | 1px solid transparent | - | `--button-bd` |
| with left/right section | padding on that side = padding-x / 1.5; section gap 0.625rem / 10px | - | `[data-with-left-section]`, `.m_a74036a` |
| filled bg / hover / text | primary-filled / primary-filled-hover / white | - | default `--button-bg`, `--button-hover` |
| light | `{c}-light` / `{c}-light-hover` / `{c}-light-color` | - | colour vars exist; variant mapping is JS (not in CSS) |
| outline | border `{c}-outline`, bg transparent, hover `{c}-outline-hover` (L rgba(34,139,230,.05) for blue), text `{c}-outline` | - | vars exist; mapping is JS |
| default variant | `default` bg / `default-hover` / `default-color` text (L black, D white) / border `default-border` | - | vars exist; mapping is JS |
| subtle / transparent / white | not found (JS inline) | - | - |
| hover gate | `@media (hover: hover)` for hover; `@media (hover: none)` applies the same bg on `:active` | - | m_77c9d27d |
| hover transition | none on the button itself (instant) | - | not found |
| active press | `.mantine-active:active { transform: translateY(0.0625rem) }` = 1px down; `fieldset:disabled` => none | - | `.mantine-active` |
| disabled | bg `disabled`, text `disabled-color`, border 1px transparent, `cursor: not-allowed`, `transform: none` | - | m_77c9d27d |
| loading | `::before` overlay rgba(255,255,255,.15) L / rgba(0,0,0,.15) D, `filter: blur(12px)`, slides from translateY(-100%); inner label `transform: translateY(100%); opacity 0`; transitions `transform 150ms ease, opacity 100ms ease` | - | m_77c9d27d::before, .m_80f1301b |
| focus ring | `outline: 2px solid primary-filled; outline-offset: 0.125rem (2px)` on `:focus-visible` | - | `.mantine-focus-auto` |
| group | inner borders halved (0.5px), inner radius 0 | - | `.m_80d6d844` |

## ActionIcon

| Property | Default (md) | Ladder | Source |
|---|---|---|---|
| size (w=h) | 1.75rem / 28px | 18/22/28/34/44px | `--ai-size-*` |
| size when matched to inputs | 2.625rem / 42px | 30/36/42/50/60px | `--ai-size-input-*` |
| radius / border | 8px / 1px solid transparent | - | `--ai-radius`, `--ai-bd` |
| bg / text | primary-filled / white (filled); hover primary-filled-hover | - | `--ai-bg`, `--ai-hover` |
| disabled | bg `disabled`, text `disabled-color`, border 1px transparent, `cursor: not-allowed` | - | m_8d3f4000 |
| CloseButton | default 1.75rem / 28px, ladder 18/22/28/34/44; colour gray-7 L / dark-1 D; hover bg gray-0 L / dark-6 D; disabled opacity .6 | - | `.m_86a44da5`, `.m_220c80f2` |
| icon size inside close | 70% | - | `--cb-icon-size` |

## Inputs: TextInput, Textarea, NativeSelect, Select, NumberInput, PasswordInput

| Property | Default (sm) | Ladder xs/sm/md/lg/xl | Source |
|---|---|---|---|
| height | 2.25rem / 36px | 30/36/42/50/60px | `--input-height-*` |
| padding-inline | height/3 = 12px at sm (14px md) | = height/3 | `--input-padding` |
| padding-block (auto-height) | 0.375rem / 6px | 5/6/8/10/13px | `--input-padding-y-*` |
| padding-block (textarea) | 0.34375rem / 5.5px | 4.5/5.5/7/9.5/13px | `[data-multiline]` |
| line-height | height minus 2px (input), 1.55 (textarea) | - | `--input-line-height` |
| font-size | `--input-fz` inline, fallback 1rem / 16px (per-size values not found) | - | `.m_8fb7ebe7` |
| border / radius | 1px solid / 8px | - | `--input-bd`, `--input-radius` |
| default variant L | border gray-4, bg white | - | `[data-variant='default']` |
| default variant D | border dark-4, bg dark-6 | - | same |
| filled variant | border transparent, bg gray-1 L / dark-5 D | - | same |
| focus | `outline: none; border-color: primary-filled` (no ring, no offset). Error keeps error colour on focus | - | `:focus, :focus-within` |
| transition | `border-color 100ms ease` | - | `.m_8fb7ebe7` |
| error | border `error`, text `error`, placeholder colour `error` | - | `[data-error]` |
| success | border/section colour teal-8 | - | `[data-success]` |
| placeholder | colour `placeholder` (gray-5 L / dark-3 D), `opacity: 1` | - | `::placeholder` |
| disabled | `opacity: .6`, bg `disabled`, text `disabled-color`, `cursor: not-allowed` | - | `.m_8fb7ebe7:disabled` |
| sections (left/right) | width = height minus 2px, colour `dimmed` | - | `--input-left-section-size` |
| Label | 0.875rem / 14px, weight 600, `inline-block`, `cursor: default`; per-size `--input-label-size` not found | - | `.m_8fdc1311` |
| required asterisk | colour `error` | - | `.m_78a94662` |
| Description | 0.75rem / 12px (sm minus 2px), colour `dimmed`, line-height 1.2 | - | `.m_fe47ce59` |
| Error text | 0.75rem / 12px, colour `error`, line-height 1.2 | - | `.m_8f816625` |
| gaps label/description/input/error | not found (inline margins) | - | - |
| NativeSelect / Select chevron | 1.125rem / 18px (sm), ladder 14/18/20/24/28px; colour gray-6 L / dark-3 D; `error` when invalid | - | `--combobox-chevron-size-*` |
| Select dropdown (Combobox) | padding 0.25rem / 4px; option padding 0.375rem 0.625rem (6/10px) at sm (ladder xs 4/8, sm 6/10, md 8/12, lg 10/16, xl 14/20px); option font 14px, radius 8px; option hover bg gray-0 L / dark-7 D; selected option bg primary-filled, text white; disabled option opacity .35; group label 0.85 x option font, weight 600, `dimmed`; empty state centered `dimmed` | - | `.m_88b62a41`, `.m_92253aa5` |

## Checkbox / Radio / Switch

| Property | Default (sm) | Ladder xs/sm/md/lg/xl | Source |
|---|---|---|---|
| Checkbox size | 1.25rem / 20px | 16/20/24/30/36px | `--checkbox-size-*` |
| Checkbox radius | 8px (theme default, `--checkbox-radius` if set) | - | m_5e5256ee, m_26063560 |
| border / bg unchecked | 1px solid gray-4 L / dark-4 D; bg white L / dark-6 D | - | same |
| checked | bg and border primary-filled; icon white, 60% of box | - | `--checkbox-color` |
| outline variant checked | bg transparent, border and icon primary-filled | - | `.m_76e20374` |
| disabled | bg `disabled`, border `disabled-border`, icon `disabled-color` | - | same |
| error | border `error` (when `data-with-error-styles`) | - | `.m_26063560` |
| transitions | box `border-color 100ms ease, background-color 100ms ease`; icon `transform 100ms ease, opacity 100ms ease` (starts translateY(5px) scale(.5)) | - | same |
| Radio size | 1.25rem / 20px | 16/20/24/30/36px | `--radio-size-*` |
| Radio dot | 0.5rem / 8px | 6/8/10/14/16px | `--radio-icon-size-*` |
| Radio radius | 10000px (circle) | - | `--radio-radius` |
| Radio transitions | border/bg 100ms ease; dot `opacity 100ms ease, transform 200ms ease` | - | `.m_f3ed6b2b` |
| Label (both) | 0.875rem / 14px, line-height 1.25rem / 20px (ladder 16/20/24/30/36px), colour inherits; disabled `disabled-color` | - | `.m_d3ea56bb`, `--label-lh-*` |
| label gap | 0.75rem / 12px between box and label (`--mantine-spacing-sm`); description margin-top 5px | - | `--label-offset-*`, `.m_328f68c0` |
| Switch track h x w | 1.25rem x 2.375rem / 20 x 38px | h 16/20/24/30/36, w 32/38/46/56/72px | `--switch-height-*`, `--switch-width-*` |
| Switch thumb | 0.875rem / 14px, bg white, inset 0.15625rem / 2.5px | 12/14/18/22/28px | `--switch-thumb-size-*` |
| Switch colours | track off gray-3 L / dark-5 D; on primary-filled; disabled track `disabled`; thumb disabled gray-0 L / dark-3 D | - | `.m_9307d992` |
| Switch radius | 62.5rem (pill) | - | `--switch-radius` |
| Switch transitions | track `background-color 150ms ease, border-color 150ms ease`; thumb `inset-inline-start 150ms ease`; label `margin 150ms ease` | - | `.m_93039a1d` |
| focus ring (all three) | `outline: 2px solid primary-filled; outline-offset: 2px` via `:focus-visible` | - | `.m_926b4011:focus-visible + ...` |

## SegmentedControl

| Property | Value | Source |
|---|---|---|
| root padding / radius | 0.25rem / 4px; 8px; `display: inline-flex` | `.m_cf365364` |
| root bg | gray-1 L / dark-8 D | same |
| indicator bg | white L / dark-5 D; `--sc-shadow` (inline, not found; none in D) | `.m_9e182ccd` |
| indicator radius | `max(radius - 4px, radius / 4)` = 4px | same |
| label font | 0.875rem / 14px, weight 600, centered, nowrap | `.m_1738fcb2`, `--sc-font-size` |
| label padding | xs 2/6, **sm 3/10**, md 4/14, lg 7/16, xl 10/20 px (block/inline) | `--sc-padding-*` |
| label colour | gray-7 L / dark-1 D; hover and active black L / white D | same |
| disabled | `disabled-color`, `cursor: not-allowed` | same |
| dividers | 1px, gray-3 L / dark-4 D, hidden beside active item | `.m_69686b9b` |
| indicator transition | `transform, width, height 150ms ease` | `.m_96b553a6` |
| label transition | `color 200ms ease` (`--sc-transition-duration`) | `.m_1738fcb2` |
| focus | `outline: 2px solid primary-filled` (no offset) on the active label | `.m_1714d588` |

## Chip

| Property | Default (sm) | Ladder | Source |
|---|---|---|---|
| height | 1.75rem / 28px | 23/28/32/36/40px | `--chip-size-*` |
| padding-inline | 1.25rem / 20px; checked 0.625rem / 10px | 16/20/24/28/32 | `--chip-padding-*`, `--chip-checked-padding-*` |
| check icon | 0.75rem / 12px | 9/12/14/16/18 | `--chip-icon-size-*` |
| font / radius | 14px, line-height height minus 2px; radius 1000rem (pill) | - | `.m_be049a53` |
| outline (default) | bg white L / dark-6 D; border 1px gray-3 L / dark-4 D; hover gray-0 / dark-5 | - | `.m_3904c1af` |
| filled | bg gray-1 L / dark-5 D; hover gray-2 / dark-4 | - | `.m_fa109255` |
| checked (filled) | bg primary-filled, text white, hover primary-filled-hover | - | `--chip-bg`, `--chip-hover` |
| disabled | bg `disabled`, text `disabled-color` | - | same |
| focus | `outline: 2px solid primary-filled; offset 2px` | - | `.m_bde07329:focus-visible` |

## Badge

| Property | Default (md) | Ladder xs/sm/md/lg/xl | Source |
|---|---|---|---|
| height | 1.25rem / 20px | 16/18/20/26/32px | `--badge-height-*` |
| font-size | 0.6875rem / 11px | 9/10/11/13/16px | `--badge-fz-*` |
| padding-inline | 0.625rem / 10px | 6/8/10/12/16px | `--badge-padding-x-*` |
| radius | 62.5rem (pill) | - | `--badge-radius` |
| weight / transform / tracking | 700 / uppercase / 0.015625rem (0.25px) | - | `.m_347db0ec` |
| line-height | height minus 2px | - | `--badge-lh` |
| border | 1px solid transparent | - | `--badge-bd` |
| filled | bg primary-filled, text white | - | `--badge-bg`, `--badge-color` |
| light / outline / default | colour vars as Button; mapping JS (not in CSS) | - | - |
| dot variant | bg white L / dark-5 D, border gray-4 L / dark-5 D, text black L / white D; dot = height / 3.4; dot gap = dot size | - | `.m_fbd81e3d` |
| hover | none (`cursor: default`) | - | - |

## Alert

| Property | Value | Source |
|---|---|---|
| padding | 1rem 1rem / 16px 16px | `.m_66836ed3` |
| radius / border | 8px / 1px solid transparent (**no side accent in 9.7.3**) | `--alert-radius`, `--alert-bd` |
| light (default) bg / text | primary-light / primary-light-color | `--alert-bg`, `--alert-color` |
| title | 0.875rem / 14px, weight 700 | `.m_6a03f287` |
| message | 0.875rem / 14px, colour black L / white D (inherits `--alert-color` in filled) | `.m_7fa78076` |
| icon | 1.25rem / 20px, margin-inline-end 16px, margin-top 1px | `.m_667f2a6a` |
| gap title/message | 0.625rem / 10px | `.m_667c2793` |
| close button | padding-inline-end 16px on title row | `[data-with-close-button]` |

## Paper / Card

| Property | Paper | Card | Source |
|---|---|---|---|
| bg | body (white L / dark-7 D) | white L / dark-6 D | `.m_1b7284a3`, `.m_e615b15f` |
| padding | none | 1rem / 16px (`--card-padding`) | same |
| radius | 8px | 8px | `--paper-radius`, `--card-radius` |
| border (`withBorder`) | 1px solid gray-3 L / dark-4 D | same (section borders 1px) | `--paper-border-color` |
| shadow | `--paper-shadow` inline (not found); scale in theme-values | same | - |
| Card.Section | negative margin = card padding; borders 1px | - | `.m_599a2148` |

## Table

| Property | Value | Source |
|---|---|---|
| font-size / line-height | 0.875rem / 14px / 1.55 | `.m_b23fa0ef` |
| border-collapse | collapse | same |
| cell padding | vertical `--table-vertical-spacing` (inline, not found); horizontal `--table-horizontal-spacing` fallback 0.625rem / 10px | `.m_4e7aa4ef` |
| row border (`withRowBorders`) | 1px solid gray-3 L / dark-4 D; last row none | `.m_4e7aa4fd` |
| table border (`withTableBorder`) | 1px solid same | `[data-with-table-border]` |
| striped | odd/even row bg gray-0 L / dark-6 D | `--table-striped-color` |
| hover row | bg gray-1 L / dark-5 D | `--table-hover-color` |
| head weight | th default (UA bold) in horizontal; vertical variant 600 + bg gray-0 L / dark-6 D | `.m_4e7aa4f3` |
| sticky header | `position: sticky`, bg body, z-index 3 | `.m_b242d975` |
| caption | colour `dimmed`, margin 10px | `.m_9e5a3ac7` |
| tabular nums | `font-variant-numeric: tabular-nums` | `[data-tabular-nums]` |

## Tabs

| Property | default | outline | pills | Source |
|---|---|---|---|---|
| list line | `::before` 1px solid, gray-3 L / dark-4 D | 1px frame | none | `.m_576c9d4`, `.m_6772fbd5` |
| tab border width | 2px (0.125rem) bottom; active colour `--tabs-color` (JS), inactive transparent | 1px top/side/bottom; active sides gray-3/dark-4, bottom body colour | 0 | `--tabs-list-border-width` |
| tab padding | 0.625rem 1rem / 10px 16px | same | same | `.m_4ec4dce6` |
| font / line-height | 14px / 1 | same | same | same |
| radius | `--tabs-radius` top corners (JS) | same | `--tabs-radius` all | - |
| hover | bg gray-0 L / dark-6 D; inactive border-color gray-3 / dark-4 | not found | bg gray-0 / dark-6 | `--tab-hover-color` |
| active | border-bottom colour only | border visible | bg `--tabs-color`, text white | - |
| list gap | none | none | 0.375rem / 6px | `--tabs-list-gap` |
| disabled | opacity .5 | - | - | - |
| transition | none found | - | - | - |
| panel padding | not found | - | - | - |

## NavLink

| Property | Value | Source |
|---|---|---|
| padding | 8px 0.75rem / 8px 12px | `.m_f0824112` |
| hover | bg gray-0 L / dark-6 D | same |
| active | bg primary-light, text primary-light-color; active hover primary-light-hover | `--nl-*` |
| label | 0.875rem / 14px | `.m_1f6ac4c4` |
| description | 0.75rem / 12px, `dimmed` (opacity .9 and active colour when active) | `.m_57492dcc` |
| section margin | 0.75rem / 12px | `.m_690090b5` |
| chevron | rotates 90deg, `transform 150ms ease` | same |
| nested offset | 1.25rem / 20px | `.m_e17b862f` |
| disabled | opacity .4, no pointer events | same |
| radius | not found (inline) | - |

## AppShell

| Property | Value | Source |
|---|---|---|
| header height, navbar width, aside width, footer height, padding | inline vars (`--app-shell-*`), not found | - |
| section bg | body | `.m_45252eee` etc. |
| border (`withBorder`) | 1px solid gray-3 L / dark-4 D, on the inner edge only (header bottom, navbar end, aside start, footer top) | `--app-shell-border-color` |
| z-index | `--app-shell-*-z-index` inline; app layer var 100 | - |
| transition | `transform, top, height` (navbar/aside), `transform, margin-inline-*` (header/footer), `padding` (main); duration/easing inline (not found) | `.m_45252eee`, `.m_8983817` |
| resize handle | 0.375rem / 6px hit area, 2px line appears primary-filled on hover/active/focus-visible, `background-color 100ms ease` | `.m_3b25945a` |
| Burger | md 1.5rem / 24px (12/18/24/34/42px), line = size/12 (2px at md), padding 5px; bars `background-color, transform 300ms ease` | `.m_fea6bf1a`, `.m_d4fb9cad` |

## Modal / Drawer / Dialog

| Property | Value | Source |
|---|---|---|
| overlay | `background: var(--overlay-bg, rgba(0,0,0,.6))`; actual Modal opacity/colour passed inline (not found) | `.m_9814e45f` |
| modal width | md 27.5rem / 440px; xs 320, sm 380, lg 620, xl 780px | `--modal-size-*` |
| modal offsets | top/bottom 5dvh, inline 5vw | `--modal-y-offset`, `--modal-x-offset` |
| radius | `--modal-radius` fallback 8px | `.m_d0e2b9cd` |
| shadow | `--mb-shadow` fallback `--mantine-shadow-xl` | `.m_fd1ab0aa` |
| header | sticky, flex, padding 1rem / 16px, min-height 3.75rem / 60px, bg body, z-index 1000 | `.m_b5489c3c` |
| title | 1rem / 16px, weight 400, line-height 1, margin 0 | `.m_615af6c9` |
| body | padding 16px, padding-top 0 when a header exists | `.m_5df29311` |
| drawer width | md 27.5rem / 440px; same ladder 320/380/440/620/780px | `--drawer-size-*` |
| Dialog | width md 21.25rem / 340px (xs 160, sm 200, lg 400, xl 500px), padding 16px, min-height 50px, close button offset 8px | `.m_e2125a27` |
| z-index | modal 200, popover 300, overlay 400, max 9999 | root vars |
| open/close transition | JS Transition component, not in CSS (not found) | - |

## Menu / Popover / Tooltip

| Property | Value | Source |
|---|---|---|
| Popover dropdown | border 1px solid gray-2 L / dark-4 D, bg white L / dark-6 D, padding 0.75rem 1rem / 12px 16px, radius 8px, shadow `--popover-shadow` (none if unset) | `.m_38a85659` |
| Menu dropdown padding | `--popover-padding` fallback 4px | `.m_ef8769b6` |
| Menu item | 0.875rem / 14px, padding 0.4167rem 0.75rem / 6.67px 12px, radius 8px, colour text | `.m_99ac2aa1` |
| Menu item hover/focus | bg gray-1 L / dark-4 D (also on `:focus`, `[data-menu-active]`) | same |
| Menu item disabled | `disabled-color`, opacity .6 | same |
| Menu label | 0.75rem / 12px, weight 600, `dimmed`, padding 5px 12px | `.m_9bfac126` |
| Menu divider | 1px solid gray-2 L / dark-4 D, margin 4px 0 | `.m_efdf90cb` |
| Tooltip bg / text | gray-9 L / gray-2 D; white L / black D | `.m_1b3c8819` |
| Tooltip font / padding / radius | 14px; 5px 10px; 8px; no border, no shadow | same |

## Notification

| Property | Value | Source |
|---|---|---|
| radius / shadow | 8px / `--mantine-shadow-lg` | `.m_a513464` |
| bg | white L / dark-6 D; optional 1px border gray-3 / dark-4 | same |
| padding | start 1.375rem / 22px, end 10px, block 10px | same |
| accent bar (no icon) | `::before` 0.375rem / 6px wide, inset-inline-start 4px, top/bottom = radius, rounded, colour `--notification-color` (primary-filled) | `.m_a513464::before` |
| icon | 1.75rem / 28px circle, bg notification colour, white, margin-end 16px | `.m_a4ceffb` |
| title | 14px, weight 600, line-height 1.45, gray-9 L / white D | `.m_3feedf16` |
| description | 14px, black L / dark-0 D; with title gray-6 L / dark-2 D | `.m_3d733a3a` |

## Progress / Loader / Skeleton / Divider / ScrollArea

| Component | Property | Value | Source |
|---|---|---|---|
| Progress | height | md 0.5rem / 8px (xs 3, sm 5, md 8, lg 12, xl 16px) | `--progress-size-*` |
| Progress | track / radius | gray-2 L / dark-4 D; 8px | `.m_db6d6462` |
| Progress | section transition | `width 100ms ease` | `.m_2242eb65` |
| Progress | striped | 45deg gradient rgba(255,255,255,.15), 1.25rem size; animated `background-position` 1s linear infinite | same |
| Loader | size md | 2.25rem / 36px (xs 18, sm 22, md 36, lg 44, xl 58px) | `--loader-size-*` |
| Loader | oval | border width size/8, 3/4 ring, `rotate 1.2s linear infinite`; bars 1.2s `cubic-bezier(0,.5,.5,1)`; dots 0.8s linear | `.m_b34414df` |
| Skeleton | colour / radius | gray-3 L / dark-4 D; 8px | `.m_18320242` |
| Skeleton | animation | opacity .4 to 1 to .4, 1500ms linear infinite | `m_299c329c` |
| Divider | thickness / colour | xs 1px (sm 2, md 3, lg 4, xl 5px); gray-3 L / dark-4 D | `.m_3eebeb36` |
| Divider | label | 0.75rem / 12px, `dimmed`, gap 10px | `.m_9e365f20` |
| ScrollArea | bar size / padding | 0.75rem / 12px; padding size/5 | `--scrollarea-scrollbar-size` |
| ScrollArea | thumb | rgba(0,0,0,.4) L / rgba(255,255,255,.4) D, hover .5; bar hover bg gray-0 L / dark-8 D; `background-color 150ms ease, opacity 150ms ease`; hit target min 2.75rem / 44px | `.m_c44ba933`, `.m_d8b5e363` |

## Typography: Anchor, Title, Text, Code, Kbd

| Component | Property | Value | Source |
|---|---|---|---|
| Text | size | md 16px, line-height 1.55, weight 400 (ladder fz 12/14/16/18/20px, lh 1.4/1.45/1.55/1.6/1.65) | `.m_b6d8b162`, root vars |
| Anchor | colour | `anchor` (blue-6 L / blue-4 D) | `.m_849cf0da` |
| Anchor | underline | hover mode: none, underline on hover (and on `:active` for touch); `always`, `not-hover` also defined; default prop not found | `data-underline` |
| Title h1..h6 | size / line-height | 34/26/22/18/16/14px; 1.3/1.35/1.4/1.45/1.5/1.5; weight 700; headings family | `--mantine-h*-*` |
| Code | font / padding / radius / bg | mono 12px; 2px 5px; 4px; gray-0 L / dark-6 D; block padding 10px | `.m_b183c0a2` |
| Kbd | font | mono 12px (ladder 10/12/14/16/20px), weight 700, padding .12em .45em | `.m_dc6f14e2` |
| Kbd | border / colours | 1px solid gray-3 L / dark-4 D, bottom 3px; text gray-7 L / dark-0 D; bg gray-0 L / dark-6 D; radius 4px | same |

## Accordion / Pagination / Stepper / Timeline / Breadcrumbs / Avatar

| Component | Property | Value | Source |
|---|---|---|---|
| Accordion | control | padding-inline 16px, label padding-block 12px, weight 400, colour `bright`; hover bg gray-0 L / dark-6 D | `.m_4ba585b8` |
| Accordion | content | padding 16px, padding-top 5px | `.m_4ba554d4` |
| Accordion | item border (default variant) | bottom 1px gray-3 L / dark-4 D; contained/separated 1px all sides, radius 8px, separated gap 16px | `.m_9bd7b098` |
| Accordion | active bg | gray-0 L / dark-6 D (contained) | `--item-filled-color` |
| Accordion | transitions | chevron `transform 200ms ease` (rotate 180deg), item `background-color 150ms ease` | `.m_3f35ae96` |
| Pagination | control | md 2rem / 32px (22/26/32/38/44px), font 16px, radius 8px, border 1px gray-4 L / dark-4 D, bg white / dark-6, hover gray-0 / dark-5 | `.m_326d024a` |
| Pagination | active / disabled / gap | bg+border primary-filled, text white; disabled opacity .4; gap 8px | same |
| Stepper | icon md | 2.625rem / 42px (34/36/42/48/52px), circle, 2px ring | `--stepper-icon-size-*` |
| Stepper | colours | line and idle ring gray-2 L / dark-5 D; completed/active primary-filled, check white; idle text gray-7 / dark-1 | `.m_1959ad01` |
| Stepper | label / description | 16px weight 600 lh 1; 14px `dimmed`; connector height 2px, margin-inline 16px | `.m_12051f6c`, `.m_164eea74` |
| Stepper | transitions | connector `background-color 150ms ease`; icon `background-color, border-color 150ms ease` | same |
| Timeline | bullet / line | 1.25rem / 20px; 0.25rem / 4px | `--tl-bullet-size`, `--tl-line-width` |
| Timeline | colours | idle gray-3 L / dark-4 D; active primary-filled; item spacing 32px; title weight 600 | `.m_436178ff` |
| Breadcrumbs | separator | margin-inline 10px, gray-7 L / dark-2 D; item line-height 1 | `.m_3b8f2208` |
| Avatar | size md | 2.375rem / 38px (16/26/38/56/84px), radius 62.5rem (circle), weight 700, font = size/2.5 | `--avatar-size-*` |
| Avatar | placeholder | bg gray-1 L (rgba(17,19,21) D), text gray-9 L / gray-0 D | `--avatar-bg`, `--avatar-color` |

## Cross-cutting

- Base: `*, ::before, ::after { box-sizing: border-box }`; `input, button, textarea, select { font: inherit }`; `button, select { text-transform: none }`; body margin 0, family theme, 16px, line-height 1.55, bg `body`, colour `text`, antialiased smoothing; `color-scheme` set from `--mantine-color-scheme`.
- Focus ring: `.mantine-focus-auto:focus-visible` (and `-always` on `:focus`) `outline: 2px solid primary-filled; outline-offset: 0.125rem (2px)`; `-never` => `outline: none`. Text inputs instead change border colour to primary-filled and drop the outline.
- Press: `.mantine-active:active { transform: translateY(0.0625rem) }` (1px); disabled and `fieldset:disabled` reset it.
- State layers: colour swaps, never opacity overlays. Hover bg on neutral surfaces is gray-0 (L) / dark-6 or dark-5 (D); on selected is `{c}-light-hover` / `{c}-filled-hover`. Every hover is inside `@media (hover: hover)`, with an identical `:active` rule inside `@media (hover: none)`.
- Durations / easing: all transitions use `ease`. 100ms: input border-color, checkbox/radio, switch-adjacent, appshell handle, ring colour. 150ms: button inner (transform) with 100ms opacity, switch, scrollbar, accordion item, stepper, nav chevron, segmented indicator. 200ms: accordion chevron, segmented label colour, spoiler. 300ms: Burger. Animations: `linear` or loader curves.
- Reduced motion: only `@media (prefers-reduced-motion: reduce) { [data-respect-reduced-motion] [data-reduce-motion] { transition: none; animation: none } }`, an opt-in; there is no global rule. Loaders and skeleton always animate.
- Light vs dark: dark primary is blue-8 (not blue-6), so filled white-on-blue passes in dark; `light` variants become opaque rgba backgrounds; card is dark-6 on a dark-7 body (L: white on white).
- Z-index: app 100, modal 200, popover 300, overlay 400, max 9999.

## Conflicts with Luuna rules

Contrast (computed from hex in `specs/mantine-theme-values.md`; text 4.5:1, non-text 3:1)

| Pair | Ratio | Verdict |
|---|---|---|
| L white on blue-6 (filled Button/Badge/Chip/Pagination/option) | 3.56 | FAIL; blue-8 (5.02) passes. Hover blue-7 4.20 also fails |
| L anchor blue-6 on white | 3.56 | FAIL; blue-8 5.02 |
| L dimmed gray-6 on white / gray-0 / gray-1 | 3.32 / 3.15 / 2.99 | FAIL; gray-7 passes (8.18 on white) |
| L placeholder gray-5 on white / gray-1 | 2.07 / 1.87 | FAIL |
| L disabled text gray-5 on gray-2 | 1.75 | FAIL (disabled text; WCAG exempts inactive controls, record as owner decision) |
| L error red-6 on white | 3.28 | FAIL; red-9 would pass |
| L success teal-8 on white | 3.95 | FAIL |
| L switch label gray-6 on gray-3 | 2.55 | FAIL |
| L light variants: blue-9 on blue-1 4.93, red-9 on red-1 4.51 | pass | teal-9/teal-1 4.33, green-9/green-1 3.81, orange-9/orange-1 3.62, yellow-9/yellow-1 2.69 FAIL; blue-9 on hover blue-2 4.02 FAIL |
| L white on red-6 / teal-6 / green-6 / gray-6 filled | 3.28 / 2.55 / 2.36 / 3.32 | FAIL |
| D dimmed dark-2 on dark-7 / dark-6 | 4.04 / 3.53 | FAIL |
| D placeholder / disabled dark-3 on dark-6 | 2.47 | FAIL |
| D error red-8 on dark-7 / dark-6 | 3.44 / 3.01 | FAIL; red-4 6.70 passes |
| D success teal-8 on dark-7 | 3.93 | FAIL |
| D switch label dark-2 on dark-5 | 2.91 | FAIL |
| D text dark-0 on dark-7 9.37; anchor blue-4 6.27; white on blue-8 5.02; tooltip pairs; light-variant text 11.7+ | pass | - |
| Non-text L: input/checkbox border gray-4 on white | 1.49 | FAIL (3:1); card/table/divider gray-3 1.30, popover gray-2 1.19, switch-off track gray-3 1.30, progress track 1.19 | FAIL |
| Non-text D: input border dark-4 on dark-6/dark-7 | 1.35 / 1.54 | FAIL; switch-off track dark-5 on dark-7 1.39; progress fill blue-8 on dark-4 2.00 | FAIL |
| Focus outline L blue-6 on white | 3.56 | PASS (blue-8 5.02). D blue-8 on dark-7 3.09 PASS, on dark-6 2.70 FAIL |

Decorative borders (card/table/divider) are exempt from the 3:1 rule only if not the sole indicator of a control boundary; input, checkbox, radio and switch boundaries are not exempt.

Gradients (needs owner decision; Luuna forbids gradients)
- Progress `striped`/`animated`: 45deg `linear-gradient` with rgba(255,255,255,.15) and animated `background-position`.
- Tabs/Scroller overflow fade controls: `linear-gradient(to right, body 40%, transparent)` (`.m_53e526ea`).
- Marquee edge fades, ColorPicker checkerboard, Text and Anchor `variant="gradient"` (and Button gradient, set via JS).

Coloured left (inline-start) borders / accent bars
- Notification: 6px coloured pill `::before` at inline-start (hidden when an icon is used).
- Blockquote: `border-inline-start: 3px solid var(--bq-bd)`.
- Timeline: inline-start connector line 4px; Stepper vertical connector 2px; Tree guide lines 1px (connectors, not accents, but same geometry).
- Alert in 9.7.3 has no side accent (1px transparent border) and is compliant; use that form.

Transitions outside {transform, opacity, background-position, clip-path, stroke-dashoffset}: all marked **needs owner decision**
- `background-color`: ScrollArea bar 150ms, Accordion item 150ms, Checkbox 100ms, Radio 100ms, Switch track 150ms, Stepper connector/icon 150ms, AppShell resize handle 100ms, Burger bars (with transform) 300ms.
- `border-color`: Input 100ms, Checkbox 100ms, Radio 100ms, Switch 150ms, Stepper icon 150ms, SegmentedControl separator 200ms.
- `color`: SegmentedControl label 200ms, Splitter handle 100ms, Scroller control 150ms.
- Layout properties: `width` / `height` (Progress 100ms, SegmentedControl indicator 150ms, AppShell `top`/`height`), `max-height` (Spoiler 200ms), `margin` (Switch label 150ms), `inset-inline-start` (Switch thumb 150ms), `margin-inline-*` and `padding` (AppShell/Modal header 100ms), `box-shadow` (Slider thumb 100ms), `stroke` and `stroke-dasharray` (RingProgress/SemiCircleProgress; `stroke-dashoffset` itself is allowed).
- Compliant already: Button/ActionIcon hover (no transition), Button loading `transform`/`opacity`, Accordion chevron and NavLink chevron `transform`, Skeleton/Indicator/Loader keyframes (opacity/transform), Progress animated `background-position`.
- Mantine never uses `transition: all`.

Hover-only affordances (needs owner decision)
- Anchor `underline="hover"` and Typography `a`: underline appears only on hover/active; links are then distinguished by colour alone (L blue-6 3.56:1 versus body text 21:1).
- Tabs default variant: inactive hover border colour; Menu, Combobox, NavLink, Table row, Accordion, ScrollArea bar highlight (state layers mostly mirrored on `:focus` only for Menu items and Tree). AppShell resize handle is visible only on hover/active/focus-visible. ScrollArea thumb visibility depends on hover for the track highlight.

Other repo-invariant notes
- Disabled and idle styling relies on colour only (disabled bg gray-2, `disabled-color` 1.75:1) plus `cursor: not-allowed`; add a non-colour cue if Luuna requires it.
- Button radius 8px, Badge/Chip/Switch pill and Avatar circle may clash with any Luuna radius scale; map from `--mantine-radius-*` tokens.
- Not found in the stylesheet (needs docs or theme object): per-size Button/Input font sizes, Table vertical spacing, Tabs panel padding, AppShell sizes, Modal overlay opacity, Popover/Paper/Card shadows, Input wrapper gaps, Anchor default underline, Button subtle/transparent/white variant maps.
