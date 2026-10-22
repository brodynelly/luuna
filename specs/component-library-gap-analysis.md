# @luuna/ui component library: gap analysis and family plan

Basis: ADR 0034 (owned, dependency-free `@luuna/ui` in `packages/ui`), ADR 0033 and `docs/design-reference/ledger/` (visual source of truth, including `components/docs/*.md` and the "Need -> Use" table in `LEDGER-RULES.md`), ADR 0032 (motion budget), `.claude/experts/design-system/expertise.yaml`. At writing time `packages/ui/` did not yet exist; the library was still in `apps/desktop/src/ui/` (content, controls, layout, selection, shell, stats, tabs, table, feedback, menus, palette, settings-row, status-indicator, docs) and `apps/desktop/src/design/` (tokens, base/components/controls/overlays/motion CSS, tone.ts, StatusBadge, Icon, lint.ts). Paths below are relative to the future `packages/ui/src/`. Mantine UI (https://ui.mantine.dev) is used as a catalog of names and behaviour only; no source or styles are copied.

## (a) Catalog categories vs Luuna

Mantine UI categories (from the live catalog): Application UI (Navbars 9, Headers 6, Footers 4, Grids 3, User info and controls 8, Inputs 14, Buttons 6, Sliders 6, Dropzones 1, Application cards 7, Stats 9, Tables 4, Drag'n'Drop 3, Carousels 2); Page sections (Hero headers 6, Features 5, Authentication 4, FAQ 4, Contact 3, Error pages 5, Banners 3); Blog UI (Article cards 7, Table of contents 2, Comments 2).

| Catalog category | Luuna today | Verdict | Notes |
|---|---|---|---|
| Navbars | `Sidebar`, `NavSection`, `NavItem`, off-canvas below 768px, icon rail at <=920px | extend | Add `NavGroup` (collapsible), `NavCount` slot, `RailToggle`. Keep `aria-current="page"` styling. |
| Headers | `TopBar`, `Page` (title, sentence, actions), `Breadcrumbs`, `HeadingRow` | extend | Add `PageHeader` (Ledger doc) as the extracted `.panel-heading` + `.scope` markup; `TopBar` gets `TopBarSearch`/`TopBarActions` slots. |
| Footers | none (sidebar footer holds `ConnectionStatus`) | new (small) | `FooterBar` for status/legal strip; low priority, only `SidebarFooter`. |
| Grids | `StatGrid`, `Split`, hand-rolled CSS grids in every screen sheet | new | `Grid`, `SimpleGrid`, `Stack`, `Group`, `Container` (family 5). |
| User info and controls | none (no accounts) | excluded-by-scope | Luuna has no user accounts in v1; `Avatar` only if a provider identity appears. Not built. |
| Inputs | `TextField`, `TextArea`, `SelectField`, `Checkbox`, `Switch`, `Form`, `FieldRow` | extend + new | `RadioGroup`, `SegmentedControl`, `SearchField`, `NumberField`, `Combobox`/`Autocomplete`, `FieldHint`/`FieldError` wiring, `PasswordField` (Connection page uses `input[type=password]`), `FileField` (native). |
| Buttons | `Button` (variants incl. danger) | extend | `IconButton`, `ButtonGroup`, `CopyButton` (screens call `copyText` 5x), `CloseButton`. |
| Sliders | none | new (low) | Native `<input type=range>` `RangeField` only if a setting needs it (retention days). |
| Dropzones | none | excluded-by-scope | No upload surface in v1; native `FileField` suffices. |
| Application cards | `Card`, `SelectableCard`, `OpenCard`, `Tray` | extend | `Card` sections (`CardHeader/Body/Footer`), `MediaRow`. No cover images or gradient cards. |
| Stats | `StatGrid`, `StatTile` | extend | `MetricCard` (Ledger) adds label, value, delta text, "No data" state. Ring/progress stats excluded (decorative). |
| Tables | `Table` | extend | Sort, pagination, selection, sticky header, empty state: `DataTable` + `Pagination`. |
| Drag'n'Drop | none | excluded-by-scope | Pointer-only reorder would violate runtime authority (ordering is a runtime concept) and a11y cost is high. Reorder stays buttons. |
| Carousels | none | excluded-by-Ledger | Motion budget (translate-driven autoplay) and no content need. |
| Hero headers | none | excluded-by-scope | Marketing; no marketing pages. |
| Features section | none | excluded-by-scope | Same. |
| Authentication | `Connection.tsx` (connect page) | extend | Compose from `Form`, `PasswordField`, `Alert`; no social-login blocks. Add `AuthCard` shell only if web client needs it. |
| FAQ | `Disclosure`, Help sections | extend | `Accordion` (Ledger doc) built on native `<details name>` for Help; single-open group optional. |
| Contact us | none | excluded-by-scope | |
| Error pages | `EmptyState`, `ErrorBanner`, `.outage` | extend | `ErrorState` variant of `EmptyState` (title, reason, next step, retry). Keep `.outage` smoke class. |
| Banners | `Banner` (40px environment banner), `Callout`, `ErrorBanner` | extend | `Alert` (info/success/warning/danger) unifies `Callout`/`ErrorBanner`; keep `Banner` as app-wide only. Gradient or illustrated banners excluded-by-Ledger. |
| Article cards, TOC, Comments | none | `TableOfContents` new (low), others excluded | `TableOfContents` for Help scroll-spy only if sections exceed ~6. |
| (not in catalog, in Ledger) | `StatusBadge`, `StatusIndicator`, `CommandPalette`, `ContextMenuArea`, `Kbd`, `Facts`, `SettingsRow` | exists | Ledger additions still missing: `Dialog`, `Drawer`, `Tooltip`, `Toast`, `Menu`, `Popover`, `Skeleton`, `Spinner`, `Stepper`, `PropertyList`, `LegendList`, `Chip`, `Avatar`. |

Visual patterns excluded-by-Ledger across all families: gradient fills, coloured left-border cards (including alert/timeline accents), glow and coloured shadows, shimmer skeletons, count-up stats, autoplay, backdrop blur, decorative illustrations.

## Cross-cutting rules for every new component

- Zero imports except `react`; native elements first (`<dialog>`, `<details>`, `<button>`, `<input>`, `<select>`, `<table>`, `<fieldset>`, `<progress>` where styling allows, `popover` attribute only if the WebView supports it, with a keyboard fallback otherwise).
- State and keyboard logic in DOM-free helper modules (like `motion-math.ts`) with unit tests; components stay thin.
- Six tones only (`success, active, danger, attention, neutral, interrupted`), always three channels: colour token + shape mark + text. Tone comes in as a prop typed from `tone/tone.ts`; the library never maps runtime unions.
- `data-tone`, `data-surface`, `data-capability` pass through via rest props (`...rest` typed `HTMLAttributes`); the library never invents capability ids.
- No `style={{}}`, no positive `tabIndex`, no raw colours or lengths in Tailwind arbitrary values, no `opacity-*`/`shadow-*`/`transition`/`animate-*` utilities. Overlay motion: entrance only, once, transform/opacity keyframe with `backwards` fill, durations from tokens; no exit animation for approval/evidence overlays (so `Dialog` closes instantly), reduced motion zeroes durations.
- Disabled uses colour tokens; focus ring 2px, 2px offset; touch rows `--row-height`; tabular numerals for counts.
- Every file <= 300 lines (TS, TSX, CSS). One CSS file per component group under `src/<family>/*.css`, imported through the package style manifest in the existing layer order.
- Each family ships: component files, a `*.test.tsx` per file (jsdom + keyboard), a catalog section in `docs/COMPONENT-LIBRARY.md` (written by the family owner into its own fragment file `docs/component-library/<family>.md`, merged by an index to avoid edit collisions), and exports through `src/<family>/index.ts` only. The package root `src/index.ts` re-exports the five family barrels and is owned by the coordinator (one-line additions after merge) so no family touches it.

## (b) New components by family

Priority tags: P1 needed by an existing screen now; P2 next; P3 optional.

### Family 1: Shell and navigation (`src/shell/`)

Existing to keep: `AppShell`, `Mark`, `Banner`, `TopBar`, `Breadcrumbs`, `Sidebar`, `NavSection`, `NavItem`, `ConnectionStatus`, `ViewSlot`.

| Component | Pri | Props sketch | A11y / keyboard | Tokens, tone |
|---|---|---|---|---|
| `PageHeader` | P1 | `{title, description?, actions?, breadcrumbs?, meta?, id}` renders the one `h2`, one sentence, actions | Single `h2`; description linked via `aria-describedby` | `--text-*`, `--measure`, `--space-5`; no tone |
| `SidebarFooter` | P1 | `{children}` pins `ConnectionStatus` | landmark stays in `nav` | `--space-3` |
| `NavGroup` | P2 | `{label, defaultOpen?, children}` | native `<details>`; summary is button; arrow keys not required, Tab order | `--ink-muted`, chevron icon |
| `NavItem` additions | P1 | `{current?, count?, icon, tone?}`; count uses tabular numerals; optional tone dot (mark + `aria-label`) for blocked work | `aria-current="page"`; icon-only rail keeps accessible name and a `Tooltip` | `--accent-text` for current, `--fill` hover |
| `RailLayout` | P1 | `{main, rail?}` replaces `.app[data-rail]` grid and `.shell-rail` | rail is `aside` with label | `--rail-width` |
| `Tabs` extension | P2 | `{value, onChange, orientation?, items}` roving tabindex, Home/End, Left/Right, manual or automatic activation | WAI-ARIA tabs; `TabPanel` `aria-labelledby` | underline uses `--accent`, not coloured left border |
| `SegmentedControl` | P2 | `{value, options, onChange, name, 'aria-label'}` built on native radio inputs | arrow keys native, visible focus | `--fill`, `--fill-strong` |
| `Stepper` | P3 | `{steps:[{label,state}], current}` ordered list with `aria-current="step"` | list semantics; states by mark and text | tone marks; completes only on authoritative state |
| `TableOfContents` | P3 | `{items}` anchor list | plain links, no scroll-spy requirement | `--ink-muted` |
| `Drawer` shell hook | P2 | see family 4 | | |

Files (<=300 lines each): `shell/AppShell.tsx` (moved), `shell/Sidebar.tsx`, `shell/NavGroup.tsx`, `shell/NavItem.tsx`, `shell/TopBar.tsx`, `shell/PageHeader.tsx`, `shell/RailLayout.tsx`, `shell/Tabs.tsx`, `shell/SegmentedControl.tsx`, `shell/Stepper.tsx`, `shell/shell.css`, `shell/nav.css`, `shell/index.ts`, plus tests. The `offCanvas.ts`/`viewTransition.ts` helpers stay in `apps/desktop/src/shell` (platform glue) and are passed in as props (`onOpenChange`), keeping the library DOM-light.

### Family 2: Forms and inputs (`src/forms/`)

Existing: `Button`, `TextField`, `TextArea`, `SelectField`, `Checkbox`, `Switch`, `Form`, `FormFooter`, `FieldRow`, `Actions`, `SettingsRow`.

| Component | Pri | Props sketch | A11y / keyboard | Tokens, tone |
|---|---|---|---|---|
| `Field` (wrapper) | P1 | `{label, hint?, error?, required?, id, children(controlProps)}` generates `htmlFor`, `aria-describedby`, `aria-invalid` | label always visible; errors linked, announced via `role="alert"` with Dismiss only where the lint demands; otherwise inline text | `--color-field`, danger tone mark plus text |
| `RadioGroup` | P1 | `{legend, name, value, onChange, options:[{value,label,hint?}]}` native radios in `<fieldset>` | arrow keys native; `legend` required | `--border-control` |
| `SearchField` | P1 | `{label, value, onChange, onSubmit?, clearLabel}` native `type=search`, clear button | Esc clears, Enter submits (used by Atlas search) | field tokens |
| `PasswordField` | P1 | `{label, revealable?}` default masked, reveal is a toggle button with `aria-pressed` | value never rendered into attributes or logs | field tokens |
| `NumberField` | P2 | `{min,max,step,value,onChange}` native `type=number`, no custom spinners | native up/down keys | |
| `Combobox` | P2 | `{label, options, value, onChange, filter?, allowCustom?}` | ARIA 1.2 combobox: Down opens, Up/Down moves `aria-activedescendant`, Enter selects, Esc closes, Home/End; reuse palette's listbox logic extracted into `forms/listbox.ts` | `--surface-overlay`, hairline |
| `Autocomplete` | P3 | thin wrapper of `Combobox` with `allowCustom` | same | |
| `MultiSelect`/`TagInput` | P3 | chips with remove buttons | Backspace removes last; each chip button labelled | `Chip` neutral |
| `Chip` / `ChipGroup` | P2 | `{selected?, onToggle?, tone?}` toggle button `aria-pressed` | Space/Enter | `--fill`; selected uses `--accent-text` + check mark, not colour alone |
| `IconButton` | P1 | `{icon, label, tone?, variant}` `label` required -> `aria-label` | 24px min target | |
| `ButtonGroup` | P2 | `{children, attached?}` `role="group"` with label | | |
| `CopyButton` | P1 | `{value, label}` calls injected `copy(value)` prop, shows "Copied" as `role="status"` text (untimed, resets on blur) | | |
| `RangeField` | P3 | native range | native keys | |
| `FileField` | P3 | native `type=file` | native | |
| `FormSection` | P1 | `{title, description, children}` fieldset+legend | | `--space-4` |
| `Fieldset`/`InlineFields` | P1 | `{columns?}` responsive row replacing `.plan-controls`, `.component-search` | | |
| `Slider`, `Dropzone`, `DatePicker` | - | excluded | |

Files: `forms/Field.tsx`, `forms/TextField.tsx`, `forms/TextArea.tsx`, `forms/SelectField.tsx`, `forms/Choice.tsx` (Checkbox, Switch, RadioGroup), `forms/SearchField.tsx`, `forms/PasswordField.tsx`, `forms/NumberField.tsx`, `forms/Combobox.tsx`, `forms/listbox.ts` (DOM-free active-index logic), `forms/Chip.tsx`, `forms/Button.tsx`, `forms/IconButton.tsx`, `forms/CopyButton.tsx`, `forms/Form.tsx` (Form, FormFooter, FormSection, InlineFields), `forms/SettingsRow.tsx`, `forms/forms.css`, `forms/controls.css`, `forms/index.ts`.

### Family 3: Data display (`src/data/`)

Existing: `Table`, `List`/`Item`, `RecordList`/`RecordItem`, `ScrollList`, `Facts`, `Meta`, `Tag`, `StatGrid`, `StatTile`, `StatusBadge`, `StatusIndicator`, `Id`, `CodeBlock`, `Output`, `LiveOutput`, `Card`, `SelectableCard`, `OpenCard`.

| Component | Pri | Props sketch | A11y / keyboard | Tokens, tone |
|---|---|---|---|---|
| `DataTable` | P2 | `{columns:[{key,header,render,sort?,align?,numeric?}], rows, rowKey, caption, sort?, onSortChange?, selection?, onSelectionChange?, stickyHeader?, empty}` controlled only | native `<table>`, `<caption>`; sortable headers are buttons inside `th` with `aria-sort`; row checkbox column with labelled select-all (`indeterminate`); selection announced in `role="status"`; row click never the only path | `--row-height`, separators, tabular numerals; tone via `StatusBadge` cell |
| `Pagination` | P2 | `{page, pageCount, onPageChange, pageSize?, label}` | `nav` with `aria-label`, buttons with `aria-current="page"`, Prev/Next disabled at ends | `--fill`, `--accent-text` |
| `PropertyList` | P1 | `{items:[{term,value,mono?}], layout:'stacked'|'inline'}` over `<dl>`; supersedes `Facts` markup but keeps `.facts` class | must render `dl` (smokes read `.facts`) | `--facts-term` |
| `LegendList` | P3 | `{items:[{label,tone,value}]}` mark + text per row | | tone marks |
| `ListRow` | P1 | `{leading?, title, meta?, trailing?, onOpen?, selected?}` generic row replacing `.home-project`, `.recipe-record`, `.component-records li`, `.help-documents li` | `li`; when interactive a single `<button>` fills the row, `aria-pressed` for selection (keep `.run-card[aria-pressed=true]`) | `--row-height`, hover `--fill` |
| `ListGroup` | P1 | `{label, count?, children}` `ul[aria-label]` with separators | label required (smokes select by `ul[aria-label]`) | |
| `SelectableList` | P2 | listbox-or-button-list, arrow keys optional | follows Sessions/Projects list behaviour | |
| `MetricCard` | P1 | `{label, value, hint?, empty?}` replaces `StatTile`; static, never animated, never toned unless runtime says | `dl`-based; value text | `--surface-muted`, `--space-4` |
| `Timeline` | P2 | `{items:[{id,time,title,tone?,body?}]}` `ol` with a marker column (tone mark shape, not a coloured left border or rail line colour per tone) | `ol`; `time` elements; supports `ol.events` smoke classes via passthrough; expandable body uses native `details` | marks + text |
| `EventLog` | P1 | `{events, renderEvent, live?}` the `ol.events` pattern, `LiveOutput` rules (no transform/opacity inside) | live region off by default; `aria-live="off"` for streams, a separate polite summary | `--row-height` |
| `Kanban column` (`BoardColumn`) | P2 | `{title, count, scope?, children}` structure only; moving cards stays unsupported | `section` with heading; count text | `--surface-muted` |
| `Avatar`, `Badge count` | P3 | `Avatar` initials only; `CountBadge` numeric | | |
| `Accordion` | P2 | `{items, multiple?}` native `details` with shared `name` for single | native | |
| `Tag`/`Chip` list | exists | | |

Files: `data/DataTable.tsx` (<=300 lines; split `data/tableSort.ts`, `data/tableSelection.ts`, `data/TableHead.tsx`), `data/Pagination.tsx`, `data/PropertyList.tsx`, `data/ListRow.tsx`, `data/ListGroup.tsx`, `data/MetricCard.tsx`, `data/Timeline.tsx`, `data/EventLog.tsx`, `data/BoardColumn.tsx`, `data/Accordion.tsx`, `data/CodeBlock.tsx`, `data/data.css`, `data/table.css`, `data/timeline.css`, `data/index.ts`.

### Family 4: Feedback and overlays (`src/overlay/`)

Existing: `Callout`, `CalloutBlock`, `ErrorBanner`, `EmptyState`, `Loading`, `Placeholder`, `ProgressBar`, `StreamingDots`, `CheckDraw`, `NoticeProvider/NoticeRegion/useNotify`, `ContextMenuArea`, `CommandPalette`.

| Component | Pri | Props sketch | A11y / keyboard | Tokens, tone |
|---|---|---|---|---|
| `Dialog` | P1 | `{open, onClose, title, description?, tone?:'neutral'|'danger', actions, initialFocus?}` native `<dialog>` `showModal()` | focus trap by platform, Esc closes (cancel event wired to `onClose`), focus returns to opener, `aria-labelledby/describedby`; destructive uses danger button plus text; never opens on load; no exit animation | `--surface-overlay`, hairline, `--z-modal`, no backdrop blur |
| `ConfirmDialog` | P1 | `{title, consequence, confirmLabel, onConfirm}` wraps `Dialog` | default focus on the safe action; text states exact consequence | danger tone |
| `Drawer` | P2 | `{open, onClose, title, side:'right'}` `<dialog>` positioned | same as Dialog; off-canvas sidebar can reuse via `Sidebar` prop | `--surface-overlay` |
| `Popover` | P2 | `{trigger, children, placement}` non-modal; Esc closes, outside click closes, focus returns | `aria-expanded`, `aria-controls`; placement math in `overlay/placement.ts` (DOM-free, flips at viewport edge) | `--surface-overlay` |
| `Menu` | P1 | `{trigger, items:[{id,label,onSelect,tone?,disabled?}]}` | `role="menu"`, roving focus, Up/Down/Home/End, type-ahead, Esc, Tab closes; only commands that exist elsewhere (keeps `ContextMenuArea` rule) | `--fill` hover |
| `Tooltip` | P2 | `{label, children, placement}` shows on focus and hover (pointer: fine), describes (`aria-describedby`), never holds essential info | Esc dismisses; no delay animation beyond opacity keyframe | `--surface-overlay` |
| `Toast`/`NoticeRegion` | P1 | existing untimed notices extended: `{tone, message, onDismiss}` | `role="status"` (`alert` + Dismiss for danger); never auto-dismiss (Ledger "transient confirmation" is overridden by approval/evidence rule; keep dismissible) | `toast` surface |
| `Alert` | P1 | `{tone, title?, children, onDismiss?}` replaces `Callout`, `ErrorBanner` for inline messages; warning and danger carry a shape mark | `role="alert"` plus Dismiss when dangerous (lint); `status` otherwise | tone tokens, no left border |
| `Banner` | exists | app-wide only | | |
| `Skeleton` | P2 | `{lines?, height?}` static blocks, no shimmer; reduced-motion identical | `aria-hidden`, parent `aria-busy` | `--fill` |
| `Spinner` | P2 | `{label}` rotating ring, transform only; reduced motion shows static text | `role="status"` | accent |
| `ProgressBar` | exists | add determinate/indeterminate and `label`, `valueText` | native `<progress>` styled or `role="progressbar"` with `aria-valuenow` | accent |
| `Loading overlay` | excluded | blocks interaction opaquely; use `Skeleton` | | |

Files: `overlay/Dialog.tsx`, `overlay/ConfirmDialog.tsx`, `overlay/Drawer.tsx`, `overlay/Popover.tsx`, `overlay/placement.ts`, `overlay/Menu.tsx`, `overlay/menuNav.ts`, `overlay/Tooltip.tsx`, `overlay/Notice.tsx`, `overlay/Alert.tsx`, `overlay/Skeleton.tsx`, `overlay/Spinner.tsx`, `overlay/Progress.tsx`, `overlay/EmptyState.tsx`, `overlay/palette.tsx` (moved), `overlay/overlay.css`, `overlay/feedback.css`, `overlay/index.ts`.

### Family 5: Typography and layout primitives (`src/layout/`)

Existing: `Box`, `Text`, `Hint`, `Heading`, `HeadingRow`, `Section`, `Group`, `Toolbar`, `Tray`, `Split`, `Page`, `Kbd`, `VisuallyHidden`, `Id`, `ExternalLink`.

| Component | Pri | Props sketch | A11y | Tokens |
|---|---|---|---|---|
| `Stack` | P1 | `{gap: 0|1|2|3|4|5|6, align?, as?:'div'|'ul'|'ol'|'section'}` token scale only, no free values | `as="ul"` forces `role` fixes (`list-style` kept semantic) | `--space-*` |
| `Group` | P1 | `{gap, wrap?, justify?, align?, as?}` | | |
| `Grid` / `SimpleGrid` | P1 | `{cols:number|{base,md,lg}, minItem?: token}` auto-fill with `--field-min`; breakpoints 680/920 only | | |
| `Container` | P1 | `{size:'content'|'measure'|'narrow'}` | | `--content-max`, `--measure` |
| `Divider` | P1 | `{orientation, label?}` `<hr>` / `role="separator"` | | `--separator` |
| `Title` | P1 | `{order: 2|3|4, size?}` the only heading emitter (lint: headings only in the library); document order validated in dev | exactly one `h2` per page via `PageHeader` | `--text-*` |
| `Text` | P1 | `{tone?: 'body'|'muted'|'subdued', size, weight, mono?, truncate?:never for ids}` | | `--ink-*` |
| `Code` / `Mono` | P1 | wraps `Id` semantics | whole identities never truncated | `--font-mono` |
| `Surface` (`Panel`) | P1 | `{level:'muted'|'raised', padded?}` the shared border+radius+surface used by 8 screen rules | `section` when labelled | `--surface-*`, `--radius-card`; dark cards no shadow |
| `ScrollArea` | P2 | `{maxHeight: token, label}` focusable only when scrollable | keyboard scroll via `tabIndex={0}` on overflow | `--plan-max` |
| `Center`, `Spacer` | P2 | | | |
| `Anchor` | P2 | `Link` with external marker | | `--accent-text` |
| `Blockquote`, `Highlight` | excluded | |

Files: `layout/Stack.tsx` (Stack, Group, Center, Spacer), `layout/Grid.tsx`, `layout/Container.tsx`, `layout/Divider.tsx`, `layout/Typography.tsx` (Title, Text, Code, Anchor), `layout/Surface.tsx`, `layout/ScrollArea.tsx`, `layout/tokens.ts` (gap maps to class names), `layout/layout.css`, `layout/index.ts`.

Dependency order between families (all can start together because of pre-agreed prop contracts): family 5 is used by all others for markup but each family should write against the contract above and use plain classes internally, then swap to `Stack`/`Group` once family 5 lands; no family edits another family's files.

## (c) Per-view migration notes

Constraints that persist everywhere: all 95 `data-capability` literals stay as literals in view source; `data-surface` on `Page`; no raw elements in views (RAW lint); no `style=`; smokes in `scripts/mvp-ui-smoke.mjs`, `m1-smoke.mjs`, `m3-smoke.mjs`, `m6-ui-smoke.mjs`, `performance-ui-smoke.mjs`, `windows-*-smoke.mjs` select by the literals below. Library components must forward `className` and aria attributes so these survive.

Smoke selectors to keep (from a grep of `scripts/*-smoke.mjs`): `.facts`; `ul[aria-label="Tickets"] > li`; `ul[aria-label="Ticket list"] button`; `ul[aria-label="Recorded baselines"] li`; `ul[aria-label="Registered projects"] li|button`; `ul[aria-label="Beacon prompts"]`; `ul[aria-label="Atlas memory records"] > li`; `pre[aria-label="Check log"|"Candidate diff"|"Baseline log"]`; `.connection[data-tone="success"]`; `[role="alert"]` with a `Dismiss` button; `[role="status"]`; `.outage`; `.run-detail`, `.run-detail code`; `ol.events`, `ol.events > li`, `ol.events summary`, `ol.events pre`, `ol.events .event-number`; `.ticket-actions .state`; `.ticket-head strong`; `.history-list .run-card`; `.run-card[aria-pressed=true]`; `.component-context`; `.project-components`, `.project-components .error`; `.candidate-checks`, `.candidate-review p.recovery-note`, `.candidate-review .failure-note`; `small.failure-note`; `.plan-review`, `.plan-supersede input[type=checkbox]`; `.prompt-preview`; `.writer-status`; `details.add-project`; `summary`; `input[type=password]`; `label[for=id]`; `.state` (StatusBadge root class). Rule: new components that replace these must keep the same class names as additional classes (`className` passthrough) until the smokes are rewritten against `data-` hooks in a separate slice.

| View (files) | Hand-rolled layout today | Library replacement | CSS to drop |
|---|---|---|---|
| App shell (`App.tsx`, `src/shell/*`, `screens/shell.css` 277 lines, `app.css` 101) | grid areas, banner, sidebar, topbar, breadcrumbs, nav-item states, `.view > .page` overrides | `AppShell`, `RailLayout`, `Sidebar`, `NavGroup`, `NavItem`, `TopBar`, `PageHeader`, `Breadcrumbs` | most of shell.css moves into `shell/shell.css` in the library; leaves only desktop-specific `viewTransition` hooks. Keep `.connection` class. |
| Home (`Home.tsx`, `home.css` 31) | `.home-metrics` 4-col grid, `.home-project-card`, `.home-blockers`, `.home-count` | `MetricCard` in `Grid`, `ListRow` with `Group`/`Stack`, `ListGroup` with count, `Alert` for blockers | whole of home.css except the 920px stat collapse (use `Grid` responsive prop) |
| Board (`Board.tsx`, `board.css` 23) | `.board-columns` grid, `.board-column` surface, `.board-count`, card button hover | `Grid minItem`, `BoardColumn`, `ListRow` interactive, `CountBadge` | all of board.css |
| Projects (`projects/*`, `projects.css` 71) | `.projects-layout` rail+detail, sticky rail, `.project-list`, `.project-header`, `.recipe-record`, `.project-events` | `RailLayout`-style `SplitLayout` (add `stickyRail` to `Split`), `ListGroup`/`ListRow`, `PageHeader`-like `DetailHeader` (`Group`+`Title`+`Id`), `PropertyList`, `Timeline`, `Field`, `ConfirmDialog` for destructive project removal (only if the runtime flow already confirms) | layout, list, header, record rules; keep only banner-offset logic if not in `Split` |
| Sessions (`sessions/*`, `sessions.css` 28) | `.history-list` rows, `.run-detail`, `.assistant-output` surface, `ol.events` rows | `ListGroup`+`ListRow`, `Surface`, `EventLog` | row hover/radius, surface, `ol.events` row styling (move to `EventLog` and keep `.events` class). Preserve `Output` live-region rules. |
| Settings (`Settings.tsx`, `settings.css` 20) | `.settings-groups`, group panel, rows | `Surface` + `SettingsRow` + `FormSection`, `PropertyList` | all of settings.css |
| Help (`Help.tsx`, `help.css` 29) | numbered steps with CSS counters, state glossary, shortcut and document rows | `Accordion`/`Stack`, `Stepper`-like `OrderedSteps` (add to family 3 as `Steps`), `PropertyList`, `ListRow` with `Kbd` | all of help.css |
| Candidate review (`candidate/*`, `candidate-review.css` 64) | verdict card, handoff cards, check rows, findings, facts flex | `Surface level=raised`, `Alert`, `ListRow`, `PropertyList inline`, `Accordion` for raw evidence, `CodeBlock`, `StatusBadge` | verdict/handoff surfaces, record rows, facts overrides. Keep `.candidate-checks`, `.recovery-note`, `.failure-note` hooks via className. Publication and approval controls stay in `apps/desktop` (policy). |
| Workflows (`workflows/*`, `workflows.css` 60) | `.ticket-card`, `.ticket-head`, `.plan-review`, `.plan-controls`, `.task-graph`, `.advisory-result` | `Card` (`CardHeader`), `Group`, `InlineFields`, `Field`, `ListRow`, `Timeline` for task graph (read-only), `Alert` for advisory results, `DataTable` for task graph if columns are uniform | head/actions/layout rules; `.ticket-actions .state` auto-margin becomes `Group justify`. Smoke hooks above stay. |
| Project components (`project-components/*`, `project-components.css` 31) | `.component-columns` 2-col, search row, `select` restyle, `.component-records`, `.prompt-preview` | `Grid cols=2`, `Surface`, `SearchField`+`InlineFields`, `SelectField`, `ListRow`/`ListGroup`, `PropertyList`, `CodeBlock` | all column/search/record rules and the raw `select` rule (SelectField absorbs it) |
| Connection page (`shell/Connection.tsx`) | bespoke | `Container`, `Field`, `PasswordField`, `Alert`, `Button` | any local rules |

Net expectation: screens/*.css (735 lines now) shrinks to near zero; remaining rules are desktop-only (view transitions, banner offset coupling, window platform quirks).

Migration order (ADR 0034 step c): Settings, Help, Board, Home (smallest, no smokes on structure), then Sessions, Project components, Projects, Candidate review, Workflows, shell last. `components.test.ts` page list and `capabilities.test.ts` AREAS map must be updated in the same change as each view.

## (d) Risks and open decisions

Risks
1. **Test roots.** Lints/tests move with the library but must still scan `apps/desktop/src` for raw elements; if the moved `components.test.ts` only scans `packages/ui`, views escape the RAW lint. Decide the single owner (recommend: tests live in `packages/ui`, with an explicit `VIEW_ROOTS` pointing at desktop).
2. **Barrel collisions.** Parallel families edit `src/index.ts`, the CSS manifest, `tone` maps and `docs/COMPONENT-LIBRARY.md`. Mitigation above (coordinator-owned root barrel, per-family barrels, per-family docs fragments, per-family CSS files appended to a manifest by the coordinator).
3. **Native `<dialog>`/`popover` in the target WebViews** (WebView2, WKWebView, WebKitGTK) are unproven here; unit tests under jsdom do not run `showModal` faithfully. Needs real-WebView check (ADR 0034 consequence).
4. **Toast vs approval rule.** Ledger's Toast is transient; Luuna's invariant forbids auto-dismiss for approval/evidence. Spec keeps notices untimed; confirm with owner that no timed variant is wanted.
5. **Overlay motion budget.** Dialog/Popover/Tooltip entrances must be one-time transform/opacity keyframes with `backwards` fill; exit animation is banned, so overlays disappear instantly. Opacity is allowed only in keyframes (lint).
6. **Table selection** invites bulk actions; the runtime owns which actions are valid, so `DataTable` stays controlled and presentational, and bulk-action policy remains in `apps/desktop`.
7. **Class-name smokes.** Replacing markup can silently break Playwright smokes that are not part of `npm test`. Mitigation: the passthrough rule and running `mvp-ui-smoke` after each view (needs a built app and runtime, so evidence is separate from unit tests).
8. **Disabled-by-colour, tone marks, tooltip content** must not hide required information (hover-only is banned).
9. **300-line cap** forces splitting `DataTable` and `Combobox` early; plan the helper modules (`tableSort.ts`, `listbox.ts`) first.
10. **Soehne font and `data-type` switch** moves with `fonts.css`; the package must not re-bundle TTFs twice (vite inline limit, CSP `font-src 'self'`).

Open decisions
- Is `Container`/`Stack`/`Group` spacing restricted to the token scale (recommended yes, props are tokens not numbers)?
- Do we keep `Facts` as an alias of `PropertyList` for one release, or rename in the same slice (affects `.facts` smokes and 6 test selectors)?
- Is a responsive prop API (`{base, md, lg}`) acceptable, or only the two fixed breakpoints 680/920 via named props? Recommend named breakpoints (`compact`, `narrow`).
- `Combobox` scope: single-select only in v1 (recommended), multi-select deferred.
- Should Ledger components not needed by any screen (Avatar, Stepper, PairingCode, LegendList, PromptComposer, AIResponse, SettingsLink) be built now or deferred until a screen needs them? Recommend defer P3; ADR 0034 asks for breadth, so confirm.
- Catalog preview route (`docs/COMPONENT-LIBRARY.md` only vs an in-app route): in-app route needs CSP and token compliance and counts as a view for the lints.
- `Drawer` and the existing off-canvas sidebar: unify on `Drawer` (more consistent) or keep `useOffCanvas` (less churn)?
- Who updates `docs/DESIGN-SYSTEM.md` rows and `.claude/experts/design-system/expertise.yaml` inventory after each family (recommend the coordinator, once).
- Evidence boundary: none of this is proven in real WebViews, both colour schemes, reduced motion, or Windows 125% scaling until run in the real app.
