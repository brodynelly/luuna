# Typography and layout primitives

Source: `packages/ui/src/primitives/`. Sheet: `primitives.css` (layer components). Barrel: `primitives/index.ts`. Part of [ADR 0034](../decisions/0034-owned-component-library.md), family 5. All props are names on the token scale; a value outside the unions is a type error. Every component forwards `className`, `data-*` and aria props. None takes a tone: they carry no runtime state.

The existing `Group`, `Text`, `Box`, `Heading`, `HeadingRow`, `Section`, `Split`, `Toolbar`, `Tray`, `Page`, `Card`, `Id`, `Kbd`, `VisuallyHidden` and `ExternalLink` are unchanged except `Split`, which gained `stickyRail?: boolean`: the rail is wrapped in `div.split-rail[data-sticky]`, sticky (static once stacked, 920 px and below) at `--topbar-height + --spacing-lg`, and at `--banner-height + --topbar-height + --spacing-lg` under `.app[data-banner]` (rules in `styles/components.css`; the app needs no markup change and the layout class must still be the grid with `align-items: start`). `Title` is the new heading emitter alongside `Heading`; both live in the library, so the heading lint holds.

## Scales

**Gap contract.** `Gap` is a union of literals, not a number: the whole steps are numbers (`0`, `1`, `2`, `3`, `4`, `5`, `6`, `8`, `12`) and the fractional steps are strings (`"0.5"`, `"1.5"`, `"2.5"`). `gap={1.5}` is a type error; write `gap="1.5"`. Anything off the scale (`7`, `"10px"`, `"2"`) is a type error too. `GapNumber` and `GapString` name the two halves; `GAPS` lists all steps in order.

| Name | Values | Maps to |
|---|---|---|
| `Gap` | `0`, `"0.5"`, `1`, `"1.5"`, `2`, `"2.5"`, `3`, `4`, `5`, `6`, `8`, `12` | `--space-0-5` ... `--space-12` (`0` is no space) |
| `Columns` | `1` to `6` | `--prim-cols`, set by `[data-cols]` rules |
| Breakpoints | `compact`, `narrow` | `(max-width: 920px)`, `(max-width: 680px)`, the only two media queries |
| `ContainerSize` | `content`, `measure`, `narrow` | `--content-max-width`, `--measure`, `--connect-width` |
| `MinItem` | `field`, `hint` | `--field-min`, `--hint-min` |
| `ScrollHeight` | `plan`, `scroll`, `list` | `--plan-max`, `--scroll-max`, `--palette-list-max` |
| `TitleSize` | `page`, `section`, `subsection`, `label` | Ledger type styles `--text-page-title`, `-section-title`, `-body-strong`, `-label` |

`tokens.ts` holds the maps (DOM-free); `tokens.test.ts` proves each name has its CSS rule and each token is defined.

## Components

| Component | Props | Renders / states | Keyboard and a11y | Tokens |
|---|---|---|---|---|
| `Inline` | `gap?`, `align?` (start, center, end, stretch, baseline), `justify?` (start, center, end, between), `wrap?`, `as?` (div, span, ul, ol, section) | Flex row (`.prim-inline`, `data-wrap`). | `ul`/`ol` get `role="list"`. | `--space-*` |
| `Stack` | `gap?`, `align?` (start, center, end, stretch), `justify?` (start, center, end), `as?` (div, ul, ol, section) | Flex column. | `ul`/`ol` get `role="list"` (list-style none drops the role in WebKit). `section` is a landmark only with an aria-label. | `--space-*` |
| `Center` | `inline?`, `fill?`, `as?` (div, section) | Centres children on both axes; `fill` reserves the empty-state height. | None. | `--empty-min` |
| `Spacer` | `size?: Gap` | Flexible without `size`, fixed with it. | `aria-hidden`. | `--space-*` |
| `Grid` | `cols: Columns or { base, compact?, narrow? }`, `gap?` | Equal columns; a number holds at every width, the object drops columns at the two breakpoints. | None. | `--space-*` |
| `SimpleGrid` | `minItem?` (default field), `gap?` | `repeat(auto-fill, minmax(min(100%, item), 1fr))`; needs no breakpoint. | None. | `--field-min`, `--hint-min` |
| `Container` | `size?` (default content), `gutter?`, `as?` (div, section, article) | Centred column with a max width; `gutter` adds `--gutter` on both sides. | None. | `--content-max-width`, `--measure`, `--connect-width`, `--gutter` |
| `Divider` | `orientation?` (horizontal, vertical), `label?` (horizontal only), `decorative?` | Plain: `hr` (vertical adds `aria-orientation`). Labelled: `div role="separator"`, name is the string label, text set in the rule. `decorative` is `role="presentation"`. | Not focusable. | `--separator`, `--ink-muted`, `--text-caption` |
| `Title` | `order: 2, 3 or 4`, `size?` | `h2`/`h3`/`h4`. Without `size` the level's own style applies. No h1: the shell owns it. | One h2 per view; `outlineProblems()` (outline.ts) checks an order list for a second h2, a skipped level or h1/h5+. | `--text-*`, `--leading-*`, `--weight-*` |
| `Code` | `size?` (mono, inherit) | Inline `code`, wraps anywhere, never truncated. | Whole identities are shown whole. | `--font-mono`, `--text-mono`, `--fill-strong`, `--radius-sm` |
| `Surface` | `level?` (raised, muted), `padded?`, `pad?: Gap`, `as?` (div, section, aside, article, li), `shadow?: boolean` | The shared border, radius and ground. Raised casts `--shadow-card` (none in dark); muted is flat. `shadow` overrides the level: `true` adds `--shadow-card` to a muted ground, `false` removes it from a raised one; unset keeps the level default. `as="li"` makes the ground a list item (parent must be a `ul`/`ol`). | Landmark elements need `aria-label` or `aria-labelledby`. | `--surface-raised`, `--surface-muted`, `--radius-lg`, `--panel-pad`, `--border-width` |
| `ScrollArea` | `label` (required), `maxHeight?` (plan, scroll, list), `axis?` (y, x, both) | Bounded height. While the content overflows it becomes `role="region"` with `aria-label` and `tabIndex=0`; otherwise a plain div with no tab stop. Re-measured by `ResizeObserver` (`useOverflow.ts`, rule in `scroll.ts`). | Keyboard scrolling via the focus stop; global 2px focus ring. | `--plan-max`, `--scroll-max`, `--palette-list-max` |
| `Anchor` | `href` (required), `external?`, `variant?` (accent, subtle), `underline?` (hover, always) | `external` adds `target="_blank"`, `rel="noopener noreferrer"`, an `aria-hidden` arrow and visually-hidden "(opens in a new window)". | Link semantics; global focus ring. | `--accent-text`, `--ink-body`, `--border-strong` |

## Notes

- No inline styles anywhere: gap, padding and size are `data-*` attributes with one CSS rule each; the classes `prim-*` are the only hooks.
- Motion: none. No gradient, no coloured edge, no opacity or transition.
- Wished-for tokens: a `--narrow-max` for `Container size="narrow"` (it borrows `--connect-width`).
- Design lint: `ScrollArea`'s `overflow` rules live under `[data-scroll-area]`. `design-system.test.ts` allows scrolling only for `ol.events`, `pre[aria-label` and `[role="listbox"]`; add `\[data-scroll-area\]` to that allowlist when registering the sheet.
