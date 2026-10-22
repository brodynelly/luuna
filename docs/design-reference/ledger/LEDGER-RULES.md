# UI rules: Ledger design system

All UI in this project uses the Ledger design system in `ledger/` (or wherever this folder lives). Follow these rules exactly; read `ledger/README.md` for the full brand book and `ledger/components/docs/<Component>.md` before using a component for the first time.

## Always

- Import `tokens/tokens.css` once, then `components/ledger.css`. Use the components from `components/ledger.mjs` before writing new markup.
- Colors, spacing, radii, shadows, z-index and sizes come only from the CSS variables in tokens.css (`var(--surface-raised)`, `var(--space-4)`, `var(--radius-lg)`). Never hard-code hex values or px values that a token covers. If a value is missing, add it to `tokens.json` and regenerate tokens.css rather than inlining it.
- Every screen must work in light and dark. Test both by toggling `data-theme` on `<html>`.
- Text pairs: `ink` for titles and values, `ink-body` for copy, `ink-muted` for descriptions, `ink-subdued` only for timestamps/axes on surfaces (never on `fill` or overlays). Links use `accent-text`.
- Dark mode is the Apple Developer website palette (developer.apple.com). Never invent dark values; use the tokens: page #000000 (`surface`), #161617 (`surface-muted`), #1D1D1F (`surface-raised`, `surface-overlay`, `banner`), #333336 (`fill`, `separator`), #424245 (`fill-strong`, `border`), #6E6E73 (`border-strong`); text #F5F5F7 / #A1A1A6 / #86868B / #6E6E73; buttons #0071E3 (hover #0076DF), links #2997FF, focus #0071E3; status green #03A10E, red #FF3037, orange #F56300 on their dark tinted grounds. Light mode keeps the indigo accent.
- Elevation: `surface` page → `surface-muted` → `surface-raised` cards → `surface-overlay` dialogs, menus, drawers (with the popover hairline) → `toast`. Fields inside overlays use `field`.
- `accent` is the only brand hue: primary button, active nav, selected tab, switch on. One primary button per view.
- Status colors (`success`, `danger`, `warning`, `info`) always come with a word or icon, and sit on their `*-soft` ground in badges and alerts.
- `ai` (purple) marks AI output only: the sparkle icon and the AIResponse hairline. Never as text or a fill.
- Focus: 2px solid `focus-ring`, 2px offset, on every interactive element. Icon-only buttons need `label`.
- Type: system font stack (`--font-sans`), `--font-mono` for addresses, keys and codes. Use the type classes (`page-title`, `section-title`, `body-strong`, `body`, `label`, `caption`, `overline`, `mono`). Numbers that line up use tabular numerals.

## Page layout: content first

Based on Google's page layout guidance (users "want to see content right away", not scroll past ads or filler):

- Build every app screen with `AppShell` + `PageHeader`. Check at 1366×768, 1280×720 and 390×844: the page title AND the start of the primary content must be visible without scrolling.
- Fixed chrome is only the Banner (40px) and top bar (56px). No extra sticky bars, heroes, cookie strips or promos.
- Breadcrumbs, title and actions share the PageHeader so content starts within ~120px of the content top.
- At most one task-related Alert/Callout above the content. Recommendations, onboarding, tips and upsells go below the content or in AppShell's `rail`.
- Nothing opens on load (no dialog, drawer, toast or interstitial). Empty pages use EmptyState.
- Content caps at 1200px (`content-max-width`); under 768px the sidebar becomes an off-canvas panel.

## Copy

- Sentence case everywhere; no all caps, no emoji, no exclamation marks.
- Buttons are verbs that say what happens ("Disconnect", "Insert into Notepad"), never "OK" / "Yes".
- Errors: what happened, then what to do. "The NAS is unreachable. Check Tailscale and the server address." No error codes, no "Oops".
- Confirmations are past tense: "Copied", "Response inserted into Notepad".
- Limits state the number and that nothing was lost: "Select at most 6,000 characters, then try again. The selection was not truncated."

## Which component

| Need | Use |
| --- | --- |
| App frame / page top | AppShell / PageHeader |
| Single-line input | TextField (`mono` for URLs/keys) |
| Long text with a limit | TextArea `maxLength`, or PromptComposer for AI prompts |
| Setting that applies immediately | SettingsRow + Switch |
| Choice applied on Save | Checkbox, RadioGroup, Select |
| 2–5 modes / zoom / theme | SegmentedControl |
| Inline message | Alert (info, success, warning, danger) |
| Transient confirmation | Toast |
| App-wide environment state | Banner |
| Destructive confirm | Dialog `tone="danger"` with a `danger` Button |
| Object actions | Menu |
| Side task (Ask AI) | Drawer |
| Records | DataTable + Pagination + Chip filters + SearchField |
| Key–value details | PropertyList |
| Nothing to show | EmptyState (charts: MetricCard's No data) |
| Loading | Skeleton (content), Spinner (short), ProgressBar (known progress or > 5 s) |
| Connection state | StatusIndicator |
| Device sign-in | Stepper + PairingCode |
| Captured selection / AI answer | SelectionCard + AIResponse |
| Shortcuts | Kbd / ShortcutHint |

## Don't

- Don't add new colors, fonts, shadows, gradients, emoji, or colored left-border cards.
- Don't hide unsupported features; disable them and say why in the description ("Available in the Windows desktop app only.").
- Don't truncate user text silently or auto-dismiss errors that need action.

Reference screens: `examples/pairing.html`, `examples/library.html`, `examples/askai.html`, `examples/settings.html`.
