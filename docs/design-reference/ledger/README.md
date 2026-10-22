# Ledger design system

Ledger is the UI system for NAS Workspace: white / true-black surfaces, an indigo accent in light and Apple blue in dark, a dark theme taken from the Apple Developer website, content-first page layout, and 50 React components.

## What's here

| Path | Use |
| --- | --- |
| `tokens/tokens.json` | Source of truth for every color (light + dark), type style, space, radius, shadow, z-index and size. |
| `tokens/tokens.css` | CSS custom properties generated from tokens.json. Light by default; dark with `data-theme="dark"` on `<html>`, or automatically from the OS unless `data-theme="light"` is set. Also defines the type classes (`.page-title`, `.body`, …). |
| `tokens/tailwind.preset.js` | Optional Tailwind preset mapping utilities (`bg-surface-raised`, `text-ink-muted`, `rounded-lg`, `p-4`) to those variables. |
| `components/ledger.css` | Component styles (`lg-` class prefix). Load after tokens.css. |
| `components/ledger.mjs` | ES module build: `import { Button, DataTable } from './ledger.mjs'` (React 18 peer). |
| `components/ledger.js` | Classic-script build that sets `window.Ledger` (needs `window.React` / `ReactDOM`). |
| `components/index.d.ts` | Props for every component. |
| `components/docs/*.md` | When to use each component and what the consumer provides. |
| `examples/*.html` | Pairing, Library, Ask AI and Settings screens; open in a browser and use the theme toggle. |
| `CLAUDE.md` | Rules for Claude (or any coding agent) building with this system. Copy into your repo root or merge into an existing CLAUDE.md. |

## Quick start (React / Vite / Tauri)

```js
import './ledger/tokens/tokens.css';
import './ledger/components/ledger.css';
import { Button, Alert, PairingCode } from './ledger/components/ledger.mjs';
```

Set the theme on the root element: `document.documentElement.dataset.theme = 'dark' | 'light'` (remove the attribute to follow the OS).

---

# Brand book

Ledger is a calm, data-first dashboard language: white or true-black surfaces, one accent, and numbers that do the talking. Light mode is airy and cool-gray with an indigo accent; dark mode uses the Apple Developer website palette (black, #161617 / #1D1D1F / #333336 steps, #F5F5F7 text, Apple blue). Every page is laid out content-first.

## Content fundamentals

- Sentence case everywhere: page titles, buttons, tabs, nav, badges. Never all caps, including the `overline` style.
- Address the user as "you"; the product never says "I" or "we". "You're testing in a sandbox. Changes you make here don't affect real customers or payments."
- Buttons are verb phrases ("Pay out funds", "Add settlement currency"); links say where they go ("Go to API keys", "More details").
- Empty states are plain facts: "No data", "No top-ups were found". No jokes, no illustrations, no emoji.
- Money always carries its currency symbol and two decimals ("$0.00"); timestamps are relative under a minute ("Updated 44 seconds ago"), absolute after.
- Errors are two short sentences: what happened, then what to do. "The NAS is unreachable. Check Tailscale and the server address." "This selection expired or was replaced. Capture it again, or copy the response." Never blame the user, never show codes or stack traces, never say "Oops".
- When an action partly succeeded, say exactly which part: "The local session was removed. The NAS was unreachable; revoke this device from the web app to end its server session."
- Limits are stated as numbers with the unit and a promise about data: "Select at most 6,000 characters, then try again. The selection was not truncated."
- Confirmations are past tense and specific: "Response inserted into Notepad", "Copied", "This device is paired."
- Shortcuts are written with platform key names joined by + in prose (Ctrl+Alt+Space) and shown as Kbd in UI.

## Visual foundations

### Colour

- Pages sit on `surface`. Cards use `surface-raised`; in light they are white on a `surface-muted` tray, in dark they are #1D1D1F on black. Controls and wells use `fill`, one step up again.
- Text: `ink` for titles and values, `ink-body` for copy, `ink-muted` for descriptions, `ink-subdued` only for timestamps and axis labels on surfaces (not on `fill`).
- `accent` is the only brand hue in the UI: primary button, active tab bar, active nav (indigo in light, Apple blue in dark). Links and settings titles use `accent-text` (#2997FF in dark, 5.6:1 on cards).
- Status uses `success`, `danger`, `warning`, `info`, each on its `*-soft` ground in Badge; always paired with a word.
- Charts: `chart-1` for the primary series, then `chart-2` … `chart-5` in order; `chart-muted` for incoming, pending and the dashed future part of an intraday line; `chart-grid` for baselines.
- `banner` is reserved for the environment strip.

### Dark mode

Dark mode uses the Apple Developer website's dark palette (developer.apple.com), not an inverted light theme. Light mode keeps the indigo accent; dark mode switches to Apple's blue.

- Surfaces: `surface` #000000 (page) → `surface-muted` #161617 (callouts, code) → `surface-raised` #1D1D1F (cards, and the global-nav fill used for `banner`) → `fill` #333336 (wells, search, hover) → `fill-strong` #424245. Overlays (`surface-overlay`) are #1D1D1F with a 10% white hairline in `shadow-popover`; fields inside them drop to `field` #161617.
- Text: `ink` and `ink-body` #F5F5F7, `ink-muted` #A1A1A6, `ink-subdued` #86868B (surfaces only), `ink-disabled` #6E6E73.
- Blue: `accent` #0071E3 for buttons and active indicators (hover #0076DF), `accent-text` #2997FF for links, `accent-soft` #162B5B, `focus-ring` #0071E3.
- Lines: `separator` #333336, `border` #424245, `border-strong` #6E6E73.
- Status: green #03A10E on #002B03, red #FF3037 on #330000 (danger buttons take black labels), orange #F56300 on #290D00, blue #2997FF on #002A51. Charts: #2997FF, #A95ED2, #00C2BB, #F56300, #F14BF1. `ai` is the purple #A95ED2.
- No shadows on cards in dark; depth comes from the surface steps.
- Contrast holds at 4.5:1 for text on every ground its note names. The two tight spots: links on `fill` are 4.2:1 (don't put links on fill), and `ink-subdued` is surfaces-only.

### Type

- System UI stack (`sans`): SF Pro on Apple platforms, Segoe UI on Windows. No webfont to load. `mono` for keys and IDs.
- `page-title` once per page. `section-title` for in-page sections, `body-strong` for card titles, `body` for everything else, `caption` for timestamps and axes.
- All numbers that line up (values, tables, axes) use tabular numerals (`.lg-num` or the built-in component styles).

### Spacing, radius, elevation

- 4px base: `space-1` … `space-12`. Cards pad `space-5`; grids gutter `space-4`; sections separate by `space-8`.
- `radius-md` for controls, `radius-lg` for cards and callouts, `radius-xl` for large panels, `radius-full` for the search field ends and rings.
- Borders are hairlines (`separator`) or quiet outlines (`border`); `border` is deliberately below 3:1, so controls rely on their label and on `focus-ring`.
- Focus: 2px solid `focus-ring`, 2px offset, on every interactive element. Fields swap their border to `focus-ring` plus a 1px ring instead.
- Form controls use `border-strong` (3:1+) for checkbox, radio and switch-off outlines, and on field hover. Error fields switch to `danger`.
- Stacking: `z-sticky` < `z-menu` < `z-drawer` < `z-dialog` < `z-toast`. Fixed sizes live in the size tokens (`control-sm/md/lg`, `sidebar-width`, `drawer-width`, `dialog-width`).

### Page layout: content first

Based on Google's page layout algorithm guidance: "Rather than scrolling down the page past a slew of ads, users want to see content right away." A page whose first screen has little content, or gives a large fraction of it to ads or promotions, is a worse page. Ledger applies that to every screen, ad-free or not.

- **The fold:** design against a 1366×768 window (`fold-reference`), and check 1280×720 and a 390×844 phone. In every one, the page title AND the start of the page's primary content (the table, the form, the code, the first cards) must be visible without scrolling.
- **Chrome budget:** fixed chrome is the Banner (`banner-height` 40px) plus the top bar (`topbar-height` 56px): 96px, 12.5% of the fold. Never add another fixed bar, cookie strip, sticky promo or hero. Notices go inside the content as an Alert or Callout.
- **Header in one row:** PageHeader puts breadcrumbs, title and actions together so primary content starts within about 120px of the top of the content column.
- **What can sit above the fold:** at most one Callout or Alert that is about this page's task. Recommendations, onboarding, upsells, "what's new" and tips go below the primary content or in AppShell's `rail` (a right column, as with a dashboard's Recommendations and API keys panel).
- **Nothing in the way:** no dialog, drawer, toast or interstitial opens on page load; empty pages show an EmptyState with the next action, not a marketing panel.
- **Width:** content caps at `content-max-width` (1200px) inside AppShell; tables can opt into `wide`.
- **Shells:** AppShell (Banner → 240px sidebar → sticky top bar → scrolling content). Under 768px the sidebar becomes an off-canvas panel from the top-bar menu button and side padding drops to `space-4`.
- **Overview pages:** PageHeader, then the primary metric or list, then MetricCards two-up; secondary panels in the rail.
- **Settings pages:** PageHeader with the page's main actions, then `section-title` groups of SettingsRows.

### Motion

- 120ms ease-out on hover backgrounds and field borders; 150ms for switch knobs and accordion chevrons. Charts don't animate on load.
- Spinner, Skeleton pulse, indeterminate ProgressBar and the streaming caret all stop under `prefers-reduced-motion`.

## Forms

- Labels above fields, always visible. Hints under the field, replaced by the error while one exists. Mark the rare optional field "Optional"; don't star required ones.
- Validate on blur and on submit. Keep the user's input on error.
- Settings that apply at once use Switch inside a SettingsRow; choices applied with a Save button use Checkbox, RadioGroup or Select.
- Counters (TextArea, PromptComposer) count UTF-16 units to match the desktop limits: 6,000 for a captured selection or prompt, 16,000 for an inserted response, 32,000 for a copy.
- Server addresses, keys and codes use `mono` fields with spellcheck off.

## States

- Loading: Skeleton for content that has a shape, Spinner with a label for short waits, ProgressBar for anything with known progress or longer than five seconds.
- Empty: EmptyState in lists and pages, the MetricCard "No data" pill in charts.
- Errors: Alert next to what failed; a Toast only for background failures that offer Retry.
- Unsupported platform: disable the control and say why in its description ("Available in the Windows desktop app only."); never hide it.
- Connection: StatusIndicator in the sidebar footer and on the Settings page (connected, connecting, offline, error, idle).

## AI content

- AI output sits in AIResponse: neutral text, marked only by the `ai` sparkle and hairline. Never tint the body or call the assistant by a name.
- Captured text sits in SelectionCard with its source app and the time left to insert (ten minutes).
- Insert is the primary action only while the original selection can still be replaced; otherwise it's disabled with a Tooltip, and Copy is the way out.
- Streaming shows a caret and Stop; actions appear when the response ends.

## Screens

- Sign in / pairing: Stepper, TextField (server address), PairingCode, Alert. See the PairingPage card.
- Every app screen: AppShell + PageHeader, laid out content-first (see Page layout).
- Library: app shell, Breadcrumbs, Chips, SegmentedControl, Menu, DataTable, Pagination, EmptyState. See LibraryPage.
- Ask AI: Drawer with SelectionCard, AIResponse, PromptComposer (dictation), SegmentedControl (zoom), Toast. See AskAIPage.
- Settings: PropertyList (connection), SettingsRow with Switch and Kbd, SegmentedControl (theme), Alert and ProgressBar (updates), Dialog (disconnect). See SettingsPage.
- Downloads: DataTable of releases with ProgressBar per row, CodeBlock for checksums, Link (external) to the private downloads page.

## Iconography

- `Icon` provides a generic 24-grid line set (65 icons, listed in `Ledger.Icon.names`), 1.75px stroke, rounded caps, drawn in `currentColor`. Sizes: 18 in the sidebar and IconButton, 16 default, 14 in buttons, 12 in badges.
- File rows use `folder`, `file`, `image`, `video`, `music`, `archive`. AI actions use `sparkle`; insert uses `insert`; dictation uses `mic`.
- Icons are outline only and always paired with a label, except top-bar buttons, which take `label` for screen readers.
- There is no logo in this system; set the product name in `body-strong`.
