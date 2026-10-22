# Component library (`@luuna/ui`)

Catalog of the owned component library in `packages/ui` ([ADR 0034](decisions/0034-owned-component-library.md), decision 7). The code is the source of truth; this page indexes it and links the family fragments under [component-library/](component-library/). Visual rules are in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) and [ADR 0035](decisions/0035-mantine-theme-and-outfit.md). Checked on 2026-10-22 against `packages/ui/src/index.ts`; every name below is exported from that barrel.

## 1. What the library is

`@luuna/ui` is a private, source-only workspace package (`packages/ui`, MIT). Its exports point at `src/`. Its only dependencies are `react` (peer, 19.2.0) and `@luuna/api-client`, which the tone maps read. It imports no UI kit, headless library, icon set or CSS-in-JS helper. Focus, dialogs, listboxes, menus and tabs are written on native elements and tested.

Rules the library keeps:

- **Zero third-party imports.** Mantine is a pattern catalog and a source of token values only (ADR 0035). Its values are pinned in `packages/ui/src/design/mantine-values.ts`; no Mantine code or stylesheet is vendored.
- **Runtime authority.** The library renders what it is given. Which rows exist, what a selection permits, and what a state means come from the caller and the runtime. `tone/tone.ts` maps `@luuna/api-client` unions to tones; it does not decide policy.
- **Six tones, three channels.** `success`, `active`, `danger`, `attention`, `neutral`, `interrupted`. Each tone has a colour family, a shape mark (`.tone-mark`) and the caller's text. Colour is never the only signal. `interrupted` shares the neutral family and is never danger. Only passed durable evidence is green.
- **`data-capability` and `data-surface` markers.** Accepted as props on the components that carry them and kept literal, because smokes select on them.
- **Motion budget.** Only transform, opacity, background-position, clip-path and stroke-dashoffset animate. Entrances play once. Reduced motion zeroes durations. No `transition: all`, no `will-change`. Enforced by `design/motion-css.test.ts` and `design/lint.ts`.
- **Contrast.** Text 4.5:1; marks, control edges and focus 3:1; both colour schemes. Recomputed from hex in `design/mantine-tokens.test.ts`.
- **No gradients, no coloured side accents, no blur or glow.** Enforced by `gradientProblems` and `leftRuleProblems` in `design/lint.ts`.
- **Tokens only.** Literal colours, lengths and durations live in `styles/tokens*.css`. Every other sheet is checked as token-only by `design/design-system.test.ts`.
- **300-line cap** for every front-end `.ts`, `.tsx` and `.css` file (`design/components.test.ts`).
- **Views compose the library.** Desktop views may not render raw controls, headings, forms or containers (`design/components.test.ts`).

## 2. Import and styles

Components come from the root barrel. The desktop does this throughout (for example `apps/desktop/src/App.tsx` imports `AppShell`, `Alert`, `CommandPalette` from `"@luuna/ui"`).

```ts
import { Button, DataTable, Dialog } from "@luuna/ui";
```

`packages/ui/package.json` `exports` maps `"."` to `src/index.ts`, `"./styles/*"`, `"./assets/*"`, and the family folders `"./navigation/*"`, `"./forms/*"`, `"./data/*"`, `"./overlay/*"`, `"./primitives/*"`.

Styles load through one ordered manifest, `apps/desktop/src/styles.css`:

```text
@layer tokens, base, components, screens, utilities;
tokens      tokens.css, tokens-depth.css, tokens-scale.css, tokens-motion.css, tokens-legacy.css, fonts.css
base        styles/base.css
components  styles/components.css, overlays.css, controls.css, motion.css,
            navigation/navigation.css, forms/forms.css, forms/pickers.css,
            data/data.css, data/table.css, overlay/overlay.css, overlay/feedback.css,
            primitives/primitives.css
screens     apps/desktop/src/screens/*.css (desktop-only)
utilities   styles/tailwind.css (last)
```

Library sheets are imported by package path (`@luuna/ui/navigation/navigation.css`). Layer order decides the cascade, not specificity. `design/design-system.test.ts` (`EXPECTED_SHEETS`) fails if a sheet is missing from the manifest, if an unlisted sheet exists, or if a sheet is empty.

## 3. Component index

Each family fragment has the full props, states, keyboard and accessibility notes. Flat components are listed in section 3.6.

### 3.1 Navigation (`navigation/`, [fragment](component-library/navigation.md))

| Component | Purpose | Key props |
|---|---|---|
| `PageHeader` | Heading row for a view: breadcrumbs, title, sentence, actions | `id`, `title`, `description`, `actions`, `breadcrumbs`, `meta` |
| `SidebarFooter` | Footer slot inside the sidebar; adds no landmark | div props |
| `NavGroup` | Collapsible sidebar group (native `details`) | `label`, `defaultOpen`, `NavItem` children |
| `RailLayout` | Main column plus a labelled side rail; stacks under 920 px | `main`, `rail`, `railLabel` |
| `SegmentedControl` | Single-choice segments built on native radios | `aria-label`, `options`, `value`, `onChange`, `name` |
| `Stepper` | Ordered steps with state; not interactive | `aria-label`, `steps[{id,label,state,detail}]`, `current` |
| `TableOfContents` | In-page links, current entry marked | `aria-label`, `items[{id,label,level}]`, `current` |

Helpers: `resolveSteps`, `STEP_STATES`, `tocHref`, `tocItems`.

### 3.2 Forms and inputs (`forms/`, [fragment](component-library/forms.md))

| Component | Purpose | Key props |
|---|---|---|
| `Field` | Label, hint and error wrapper for any control; wires ids and `aria-*` | `label`, `hint`, `error`, `required`, `children(control)` |
| `RadioGroup` | Fieldset of native radios | `legend`, `name`, `value`, `onChange`, `options`, `hint`, `error` |
| `SearchField` | Search input with a clear button | `label`, `value`, `onChange`, `onSubmit`, `clearable` |
| `PasswordField` | Password input with a reveal toggle (`aria-pressed`) | `label`, `value`, `onChange`, `revealable` |
| `NumberField` | Number input; keeps half-typed text | `label`, `value` (string), `onChange(value, parsed)`, `min`, `max`, `step` |
| `Combobox` | Single-select with filtering (ARIA 1.2 listbox) | `label`, `options`, `value`, `onChange`, `filter`, `emptyLabel` |
| `Chip`, `ChipGroup` | Toggle chip with optional tone mark; labelled group | `selected`, `onToggle`, `tone`; `label` |
| `IconButton` | Icon-only button; label becomes `aria-label` | `icon`, `label` (required), `variant`, `size`, `tone` |
| `ButtonGroup` | Group of buttons, optionally attached | `label` (required), `attached` |
| `CopyButton` | Copies a value and announces the result | `value`, `label`, `copy` (injected), `copiedText`, `failedText` |
| `FormSection` | Fieldset section with title and description | `title`, `description`, `disabled` |
| `InlineFields` | Row of fields, 2 to 4 columns, one at narrow widths | `columns`, `label`, `stack` |

### 3.3 Data display (`data/`, [fragment](component-library/data.md))

| Component | Purpose | Key props |
|---|---|---|
| `DataTable<T>` | Sortable, selectable table with sticky header option | `columns`, `rows`, `rowKey`, `caption` (required), `sort`, `onSortChange`, `selection`, `onSelectionChange`, `empty` |
| `sortRows` | Stable in-memory sorter, empty values last (helper) | rows, sort state |
| `Pagination` | Page navigation with range summary | `page`, `pageCount`, `onPageChange`, `label` (required), `totalItems` |
| `PropertyList` | Key/value list as `dl` | `items[{term,value,mono,key}]`, `layout` (`stacked` or `inline`) |
| `ListGroup` | Labelled `ul` (or `ol`) of rows | `aria-label` (required), `as` |
| `ListRow` | Row with title, meta, trailing slot; optional open button and context menu | `title`, `meta`, `trailing`, `detail`, `onOpen`, `selected`, `disabled`, `commands`, `menuLabel` |
| `MetricCard` | One labelled value as `dl`; never animated | `label`, `value`, `hint`, `empty` |
| `Timeline` | Ordered events, marker by tone shape | `aria-label` (required), `items[{id,time,title,tone,status,body}]` |
| `EventLog<T>` | Scrollable log with optional live announcements and follow-to-newest | `aria-label` (required), `events`, `renderEvent`, `eventKey`, `live`, `follow`, `followKey` |
| `BoardColumn` | Named column section for a board; structure only | `title`, `count`, `headingLevel` (3 or 4), `as` |
| `Accordion` | Group of native `details`; single-open with a shared `name` | `items[{id,title,content,defaultOpen}]`, `multiple`, `name` |

### 3.4 Feedback and overlays (`overlay/`, [fragment](component-library/overlay.md))

| Component | Purpose | Key props |
|---|---|---|
| `Dialog` | Modal native `dialog` (`showModal`); no exit animation | `open`, `onClose`, `title`, `description`, `tone` (`neutral` or `danger`), `actions`, `initialFocus` |
| `ConfirmDialog` | Confirmation with a consequence; focus starts on Cancel | `consequence`, `confirmLabel`, `cancelLabel`, `onConfirm`, `tone` |
| `Drawer` | Modal side panel | `open`, `onClose`, `title`, `side` (`right` or `left`) |
| `Popover` | Non-modal floating panel from a trigger button | `trigger`, `label`, `placement`, `onOpenChange` |
| `Menu` | Button menu with roving focus and type-ahead | `label`, `trigger`, `items[{id,label,onSelect,tone,disabled}]`, `placement` |
| `Tooltip` | Hint on focus or fine-pointer hover; never essential information | `label`, `placement` |
| `Alert` | Toned message; `alert` for danger, `status` otherwise | `tone`, `title`, `announce`, `onDismiss` |
| `Skeleton` | Placeholder lines; the region sets `aria-busy` | `lines`, `height` |
| `Spinner` | Loading indicator; static text under reduced motion | `label` |
| `placeFloating` | Placement helper (`OverlayPlacement` type) | placement arguments |

### 3.5 Primitives (`primitives/`, [fragment](component-library/primitives.md))

Props are names on the token scale (`Gap` is a union of literals, so `gap={1.5}` is a type error and `gap="1.5"` is correct). None takes a tone.

| Component | Purpose | Key props |
|---|---|---|
| `Stack`, `Inline`, `Center`, `Spacer` | Flex column, flex row, centring, spacer | `gap`, `align`, `justify`, `wrap`, `as` |
| `Grid`, `SimpleGrid` | Fixed or responsive column grid; auto-fill grid | `cols`, `gap`; `minItem` |
| `Container` | Centred column with a max width | `size` (`content`, `measure`, `narrow`), `gutter`, `as` |
| `Divider` | Rule, or labelled separator | `orientation`, `label`, `decorative` |
| `Title` | Heading emitter, levels 2 to 4 only | `order`, `size` |
| `Code` | Inline identity, wraps and is never truncated | `size` |
| `Surface` | Shared border, radius and ground | `level` (`raised`, `muted`), `padded`, `pad`, `shadow`, `as` |
| `ScrollArea` | Bounded region; becomes a labelled tab stop only while it overflows | `label` (required), `maxHeight`, `axis` |
| `Anchor` | Link; `external` adds the new-window cue | `href` (required), `external`, `variant`, `underline` |

Helpers: `GAPS`, `spaceToken`, `overflows`, `outlineProblems`.

### 3.6 Flat components (`*.tsx` at the library root)

These predate the families. They are still exported and in use. "Superseded by" marks a family component the fragments name as the replacement for new work. Nothing here has been removed, and the fragments say existing screens migrate per view.

| Component | File | Purpose | Key props | Superseded by |
|---|---|---|---|---|
| `Callout`, `ErrorBanner` | `content.tsx` | Inline message and dismissible error | `tone`, `status`, `label`; `message`, `onDismiss` | `Alert` |
| `CalloutBlock`, `ReasonNote`, `NextStep`, `CalloutList`, `StatusLine` | `content.tsx` | Reason and next-step text, toned lists | `tone`, `reason`, `next`, `label` | none listed |
| `Facts`, `Meta`, `Id`, `Tag`, `Item`, `List` | `content.tsx` | Key/value pairs, metadata, identities, lists | `items`, `label`, `ordered` | `Facts` to `PropertyList`; `List`/`Item` to `ListGroup`/`ListRow` |
| `Box`, `Text`, `Hint`, `ExternalLink`, `VisuallyHidden` | `content.tsx` | Basic content elements | HTML props, `href` | none |
| `RecordList`, `RecordItem`, `ScrollList`, `DownloadLink`, `EmptyState` | `content.tsx` | Record lists, scroll lists, empty state | `variant`, `tone`, `follow`, `title`, `action` | none listed |
| `Button`, `TextField`, `TextArea`, `SelectField`, `Checkbox`, `Switch` | `controls.tsx` | Core controls; `options()` builds `Option[]` | `variant` (`primary`, `secondary`, `quiet`, `danger`, `text`), `label`, `options` | none; the fragment says these are unchanged |
| `Form`, `FormFooter`, `FieldRow`, `Actions`, `submitted` | `controls.tsx` | Form shell and button rows | `onSubmit`, `hint`, `label` | none |
| `Heading`, `HeadingRow`, `Title` (primitives) | `layout.tsx` | Heading levels 2 to 4 | `level`, `title`, `accessory` | `Title` is the new emitter; both live |
| `Page` | `layout.tsx` | View frame with title and actions | `title`, `description`, `actions`, `breadcrumbs` | `PageHeader` (same hooks) |
| `Section`, `Card`, `Group`, `Tray`, `Toolbar` | `layout.tsx` | Section and grouping containers | `title`, `level`, `variant`, `label` | none listed |
| `Split` | `layout.tsx` | Two-column layout with optional sticky rail | `rail`, `stickyRail` | none |
| `Disclosure`, `CodeBlock`, `Output`, `LiveOutput` | `layout.tsx` | Disclosure; code and live output | `summary`, `open`, `label`, `live`, `followKey` | none listed |
| `Table` | `table.tsx` | Simple sortable table | `label`, `columns`, `rows`, `rowKey` | `DataTable` |
| `StatTile`, `StatGrid` | `stats.tsx` | Statistic tile in a grid | `term`, `value`, `comparison`, `label` | `MetricCard` |
| `SelectableCard`, `OpenCard` | `selection.tsx` | Selectable and openable cards | `selected`, `onSelect`, `onOpen`, `title`, `label` | none |
| `NoticeProvider`, `NoticeRegion`, `useNotify`, `COMPLETED` | `selection.tsx` | Untimed notices; completion copy | `scope`, text | none (no timed toast) |
| `AppShell`, `Sidebar`, `TopBar`, `Banner`, `Breadcrumbs`, `crumbTrail` | `shell.tsx` | App frame and chrome | `sidebar`, `topbar`, `banner`, `collapsed`, `navOpen`, `motion` | none |
| `NavSection`, `NavItem`, `ConnectionStatus`, `ViewSlot`, `Mark` | `shell.tsx` | Sidebar items, connection state, view slot, brand mark | `id`, `label`, `icon`, `current`, `count`, `tone`, `hidden`, `entering` | none |
| `ContextMenuArea`, `useContextMenu`, `copyText` | `menus.tsx` | Right-click menu; clipboard copy | `label`, `commands` | none (`ListRow` `commands` uses it) |
| `CommandPalette`, `filterCommands` | `palette.tsx` | Command palette | `open`, `commands`, `loading`, `onClose` | none |
| `SettingsRow` | `settings-row.tsx` | Title, description, control row | `title`, `description`, `badge`, `control`, `stacked` | none |
| `StatusIndicator` | `status-indicator.tsx` | Tone-marked status with optional live text | `tone`, `label`, `detail`, `live` | none; use `StatusBadge` for chips |
| `Tabs`, `TabPanel` | `tabs.tsx` | Tab list and panels | `label`, `tabs`, `selected`, `onSelect`, `idPrefix` | none |
| `Loading`, `Placeholder`, `ProgressBar`, `StreamingDots`, `CheckDraw` | `feedback.tsx` | Loading and placeholder feedback | `label`, `rows`, `title`, `size` | `Spinner`, `Skeleton` for new work |
| `Kbd` | `docs.tsx` | Keyboard shortcut text | children | none |
| `StatusBadge` | `StatusBadge.tsx` | Tone-marked status chip | `tone`, children | none; the required way to show a state |
| `Icon`, `IconName` | `Icon.tsx` | Inline icon set | `name`, `className` | none |

Tone and motion helpers exported from the same barrel: `Tone`, `TONES`, `runTone`, `candidateTone`, `checkTone`, `baselineTone`, `verdictTone`, `severityTone`, `leaseTone`, `confidenceTone`, `manifestTone`, `connectionTone`, `ConnectionState` (`tone/tone.ts`); `clamp`, `lerp`, `cubicBezier`, `EASE_OUT`, `EASE_OUT_POINTS`, `STAGGER_CAP`, `staggerIndex`, `tweenValue`, `indicatorGeometry`, `prefersReducedMotion` (`motion-math.ts`); `ViewMotion` (`view-motion.ts`).

## 4. Which component for which need

| Need | Use |
|---|---|
| Show a runtime state as a word and shape | `StatusBadge` (tone from `tone.ts`); `StatusIndicator` for a live line |
| Inline notice, error or blocker | `Alert` (`announce="status"` for an informational blocker) |
| Confirm a destructive action | `ConfirmDialog` (focus starts on Cancel) |
| Any other modal | `Dialog`; side panel: `Drawer` |
| Floating panel or a button menu | `Popover`; `Menu` |
| Right-click or keyboard context menu on a row | `ListRow` `commands`, or `ContextMenuArea` |
| Sortable, selectable table, paged | `DataTable` with `Pagination` |
| Key/value details | `PropertyList` |
| One headline number | `MetricCard`; a grid of them: `StatGrid` with `StatTile` (legacy) |
| List of items that open | `ListGroup` with `ListRow` `onOpen` |
| One choice, shown inline as segments | `SegmentedControl` (navigation) |
| One choice from a labelled set in a form | `RadioGroup` |
| Filter by toggling tags | `Chip` in `ChipGroup` |
| Searchable choice list | `Combobox` |
| Labelled text, password or number | `TextField`, `PasswordField`, `NumberField` (or `Field` around a custom control) |
| Copy an identity | `CopyButton` with `Code` |
| Multi-step progress | `Stepper` |
| Event history | `Timeline`; a live or followed log: `EventLog` |
| Expandable sections | `Accordion` (a group), `Disclosure` (one) |
| Loading | `Spinner` inline, `Skeleton` as a placeholder |
| Page header with actions | `PageHeader` (or legacy `Page`) |
| Heading levels | `Title` (2 to 4); no h1, the shell owns it |
| Spacing and layout | `Stack`, `Inline`, `Grid`, `SimpleGrid`, `Container`, `Surface` |
| Long content that scrolls | `ScrollArea` with a `label` |

## 5. How to add a component

1. Choose the family directory (`navigation/`, `forms/`, `data/`, `overlay/`, `primitives/`) or, for a new family, record it in ADR 0034's catalog first. The root barrel re-exports families and flat files.
2. Create `Name.tsx` with typed props. Forward `className`, `data-*` and aria props. Use native elements. Import only `react` and other `@luuna/ui` modules. Keep the file under 300 lines.
3. Export it from the family `index.ts`. A new flat file needs an `export` line in `packages/ui/src/index.ts`.
4. Style it with the family sheet, or add a new sheet in the `components` layer. A new sheet is added to the manifest in `apps/desktop/src/styles.css` and to `EXPECTED_SHEETS` in `packages/ui/src/design/design-system.test.ts`. Use tokens only, no gradients, no side accents, and animate only the motion-budget properties.
5. Add tests. Render markup with `renderToStaticMarkup` (the repo has no DOM environment); put DOM-free logic in a helper with a `*.test.ts`.
6. Show state through `StatusBadge` and `tone.ts`. Do not add a colour for a state.
7. Add a row to the family fragment in `docs/component-library/` (props, states, keyboard, accessibility, tokens, tone).
8. Add a row to this index.
9. Run the verification commands in section 6. Views must compose the component; `design/components.test.ts` rejects raw elements in views.

## 6. Verification

Run from the repository root:

```text
npm test --workspace @luuna/ui        # vitest run: components, tokens, lints, design-system, mantine exactness, contrast
npm test --workspace @luuna/desktop   # vitest run: desktop views composed from the library
npm run typecheck                     # tsc --noEmit in each workspace that has a typecheck script
npm run build --workspace @luuna/desktop   # tsc --noEmit && vite build
```

The root `npm test` runs the workspace tests plus contract, guard, component-pin and smoke-harness checks.

**Not verified.** Nothing in this library has been checked in the real WebView, in both colour schemes, under reduced motion, or at Windows 125% scaling. Unit tests render static markup and compute contrast from hex values; they are not rendering evidence. Real focus, `showModal()` focus trapping, Esc routing, `aria-activedescendant` announcements, popup placement and forced colours need the real app. The Playwright smokes (`scripts/mvp-ui-smoke.mjs`, `scripts/m6-ui-smoke.mjs`, `scripts/performance-ui-smoke.mjs`, `scripts/windows-native-startup-smoke.mjs`) are not part of `npm test`; they must be run separately and their results recorded as their own evidence.
