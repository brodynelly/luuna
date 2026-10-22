# Navigation and shell components

Source: `packages/ui/src/navigation/` (barrel `index.ts`, styles `navigation.css`). Native elements first, zero third-party imports, no motion. All components forward `className`, `data-*` and aria props. Tests are static-markup (`renderToStaticMarkup`) plus DOM-free helper tests; keyboard behaviour listed below is the platform's and has not been exercised in a real WebView.

| Component | Props | Markup | Keyboard | A11y | Tone |
|---|---|---|---|---|---|
| `PageHeader` | `id`, `title`, `description?`, `actions?`, `breadcrumbs?`, `meta?` + div props (on the heading row) | Fragment: breadcrumbs, `div.panel-heading.page-header > h2#<id>-heading`, `p.scope#<id>-description`, `div.page-meta`. Same hooks as `Page`, so it can replace it inside `.panel.page`. | none | the one `h2`; `aria-describedby` points at the sentence | none |
| `SidebarFooter` | div props | `div.sidebar-footer` | none | adds no landmark; stays inside the sidebar | none |
| `NavGroup` | `label`, `defaultOpen?`, details props, `NavItem` children | `details.nav-group > summary + ul[aria-label]` | Tab to summary; Enter/Space toggle (native) | native disclosure; list named by label; summary carries `.sidebar-label` so the collapsed rail hides it visually only | none |
| `RailLayout` | `main`, `rail?`, `railLabel?` (default "Details") | `div.rail-layout[data-rail] > div.rail-main + aside.rail-aside[aria-label]` | none | rail is a labelled `aside`; DOM order main then rail; stacks under 920px | none |
| `SegmentedControl` | `aria-label` (required), `options[{value,label,disabled?}]`, `value`, `onChange`, `name?` | `div[role=radiogroup] > label.segmented-option > input[type=radio] + span` | Tab enters the group; arrows move and select (native) | controlled; selected is the checked radio; shown by fill + weight + hairline | none |
| `Stepper` | `aria-label` (required), `steps[{id,label,state?,detail?}]`, `current?` | `ol.stepper > li.stepper-step[data-state][data-tone][aria-current=step]` with `i.tone-mark`, `span.stepper-text` (label, optional `span.stepper-detail`), state text | none (not interactive) | `aria-current="step"` on the current item only; state by mark and text | states map to tones: complete=success, current=active, upcoming=neutral, attention=attention, blocked=danger. Only an explicit `state` completes a step. |
| `TableOfContents` | `aria-label` (required), `items[{id,label,level?}]`, `current?` | `nav.toc > ol.toc-list > li.toc-item[data-level] > a[href=#id]` | links, Tab order | `aria-current="location"` on the current entry; no scroll tracking | none |

Helpers (DOM-free, tested): `stepper-state.ts` (`resolveSteps`, `STEP_STATES`), `toc.ts` (`tocHref`, `tocItems`), `cx.ts` (internal).

States: NavGroup open/closed; SegmentedControl checked, hover, focus-visible (global ring), disabled (colour only); Stepper per state above; TableOfContents current, hover, focus-visible.

Tokens used: `--space-*`, `--row-height`, `--control-md`, `--radius-sm/md`, `--border-width`, `--border`, `--border-strong`, `--surface-muted`, `--surface-raised`, `--fill`, `--ink`, `--ink-body`, `--ink-muted`, `--ink-disabled`, `--accent-text`, `--text-*`, `--weight-bold`, `--mark-stroke`, `--focus-*` (via the global focus rule), `--rail-width`. Tone marks reuse the global `.tone-mark`.

Deferred: `NavItem` extensions (tone dot, `current?` as optional, `icon` optional, Tooltip in the rail), `Tabs` roving tabindex/Home/End/orientation, `RailToggle`, `TopBarSearch`/`TopBarActions` slots, `FooterBar`.
