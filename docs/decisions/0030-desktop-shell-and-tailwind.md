# ADR 0030: a sidebar shell of separate views, and Tailwind CSS bound to the tokens

Date: 2026-10-22. Status: accepted; amended by [ADR 0034](0034-owned-component-library.md) (shared components move to `packages/ui`). (First merged as ADR 0028; renumbered because 0028 and 0029 were already taken by the project-component-layout and Rust terminal workbench decisions on other branches.) Amends [ADR 0013](0013-desktop-design-system.md) points 3 and "Alternatives"; amended by [ADR 0032](0032-stripe-inspired-desktop-visual-language.md) (fonts, opacity, transform, motion); amended by [ADR 0033](0033-ledger-design-system.md) (visual language).

## Context

The desktop client rendered every surface on one page: the connection form, Home, Board, Projects (with every ticket, plan and candidate), the session workspace, Settings and Help, one after another. On a real project the page printed to sixteen letter pages. Each panel opened with a paragraph explaining the runtime's rules, and several headings carried meta chips (`Import · baseline · candidate workflow`). Finding a control meant scrolling past every other surface, and the copy asked the developer to read instructions before acting. The owner asked for a client that is clean, simple and usable without instructions, that follows the practice of mature desktop and developer products, and that uses a framework.

ADR 0013 rejected a CSS framework because it would add dependencies, fetch nothing useful under the CSP and hide the tone semantics in class soup.

## Decision

1. **One view at a time.** `App.tsx` is a desktop window: a sidebar on the leading edge (the wordmark as the page's `h1`, the connection status, then the views Home, Board, Projects, Sessions, Settings and Help) and one content column. `Ctrl+1` to `Ctrl+6` select the views and the location hash remembers the current one. Every view stays mounted and the others are `hidden`, so a form, a selection or an opened plan survives navigation and every panel keeps polling exactly as before. Home and Board controls open the Projects view. At 920 px and below the sidebar is an icon rail whose names stay as accessible names and tooltips.
2. **Connect first.** Until a runtime answers, every view except Help is replaced by a centred connect page holding the existing connection form. Once connected, the address, the Pi version, Disconnect and Stop runtime move to Settings › Runtime, beside the doctor report.
3. **A view is a page.** A view's own panel loses its card: it shows a large title and one short sentence, and its sections are cards inside it. Explanatory paragraphs were cut to one sentence that says what the view is for; meta chips in view headings were removed. Home lists what waits on the developer before the projects. Projects lists the registered projects first and folds "Add a project", "Import from another machine" and "Create from a stack profile" into disclosures (open while no project exists); the selected project is a card headed by its name. Sessions puts history beside the start form and the event record, with provider and model folded away. No control, enabled state, runtime text or capability marker changed.
4. **Tailwind CSS v4 as the utility framework, bound to the tokens.** `@tailwindcss/vite` compiles `src/design/tailwind.css` at build time into the same bundled stylesheet; nothing is fetched and the CSP is unchanged. Only the utilities layer is imported (no preflight; `base.css` keeps element defaults), it is the last layer of the manifest, and its theme is `@theme inline reference` over the tokens: `p-4` is four steps of the 4 px rhythm, `text-sm` is `--text-sm`, `bg-surface` is `--color-surface`, and Tailwind's own palette is never loaded. Utilities are for layout in markup (flex, gap); tones, components and screen presentation stay in the layered stylesheets, so the tone semantics stay readable and enforced.
5. **Palette refresh.** Neutral surfaces closer to the platform (light page `#f5f5f7`, text `#1d1d1f`; dark page `#111114`), a sidebar surface (`--color-sidebar`) and an indigo accent (`#4c4bd6` light, `#a9adff` dark). The six tones and their meanings are unchanged. Every pair still meets WCAG AA in both schemes; the sidebar surface is added to the contrast test.

## Consequences

The design-system test now expects `design/tailwind.css` in the `utilities` layer, contrast pairs on `--color-sidebar`, and the new heading levels (the Sessions and Settings sections are `h3` under the view's `h2`; Home and Projects gain `h3` sections). Browser smokes select a view through the sidebar before using its controls (`show("Projects")`, `show("Settings")` in `mvp-ui-smoke.mjs`, `m6-ui-smoke.mjs`, `performance-ui-smoke.mjs` and `windows-native-startup-smoke.mjs`), and open "Add a project" before registering a second project. The DOM structure the smokes read (`.facts`, ticket items, candidate classes, `.connection`, `.outage`) is unchanged.

Two development dependencies are added and pinned: `tailwindcss` 4.3.3 and `@tailwindcss/vite` 4.3.3. A component library (Radix, React Aria, shadcn/ui) was considered and not adopted: the client's controls are native elements with the behaviour the smokes and the accessibility audit already verify, and a library would replace them without changing what the runtime shows. A router library was not needed for six fixed views.

## Amendment (2026-10-22): one component library, one page template, small files

The owner asked that every page follow Apple's design guidance, that every layout come from one template, that everything rendered come from reusable components, and that no front-end file exceed 300 lines. The page-by-page review is [HIG-REVIEW-2026-10-22.md](../HIG-REVIEW-2026-10-22.md).

1. **A component library, `src/ui`.**
   - `controls.tsx`: Button, TextField, TextArea, SelectField, Checkbox, Form, FormFooter, FieldRow, Actions.
   - `layout.tsx`: Page, Section, HeadingRow, Toolbar, Card, Tray, Group, Disclosure, CodeBlock, Output.
   - `content.tsx`: Box, Text, Hint, Id, ExternalLink, DownloadLink, RecordList, RecordItem, List, Item, ScrollList, Facts, Meta, Tag, ReasonNote, NextStep, Callout, CalloutBlock, CalloutList, StatusLine, ErrorBanner, EmptyState, Loading, Placeholder, VisuallyHidden.
   - `selection.tsx`: SelectableCard, OpenCard, NoticeProvider, NoticeRegion, useNotify.
   - `shell.tsx`: AppShell, Sidebar, NavItem, ConnectionStatus, ViewSlot, Mark.

   Each renders the plain element and the classes the stylesheets, the smokes and the accessibility audit already read. Capability and surface markers stay literal `data-capability` and `data-surface` attributes where a view uses a component, because the parity contracts read them from source.
2. **One template.** Every view renders through `Page` (title, one sentence, trailing actions). Its words come from `src/content/views.ts`, which also drives the sidebar and the shortcuts. Headings exist only in the library, so the outline is the same on every view.
3. **Small files.** `App.tsx` is a composition of `src/shell` (`useRuntime`, the connect page, the sidebar) and `src/sessions`. Projects, project components, workflows and the candidate review moved into `src/projects`, `src/project-components`, `src/workflows` and `src/candidate`. Their old file names are barrels, so existing imports keep working.
4. **Enforced.** `src/design/components.test.ts` fails on:
   - a front-end file over 300 lines;
   - a raw control, heading, form, disclosure, container, block, paragraph, hint, list, link or alert in a view;
   - a heading outside the library;
   - a view page that does not use `Page`.

   `capabilities.test.ts` reads each panel's folder.
5. **Interface conventions from the review:**
   - a native menu bar (`src-tauri/src/menu.rs`) with every view, the sidebar toggle, Settings… and the standard Edit commands;
   - a collapsible sidebar (Ctrl+\) and Ctrl+, for Settings;
   - a past-tense notice confirming completed actions, never timed;
   - placeholder rows while loading;
   - empty states with a next step;
   - an Increase Contrast answer (`prefers-contrast: more`).

## Second amendment (2026-10-22): command palette, ticket detail, context menus

- **Command palette.** `ui/palette.tsx` is a modal `<dialog>` holding a combobox over a listbox. It opens with Ctrl+K, View › Go to… in the native menu, or the sidebar's **Go to…**. `shell/usePalette.ts` offers every view and window command, and every project and ticket read from the runtime when it opens. Opening a project or ticket uses the same request as Home and the Board.
- **Ticket detail.** The Tickets section lists each ticket as one selectable row and shows a single ticket's detail. The detail keeps `ul[aria-label="Tickets"] > li`, so the selectors the smokes read are unchanged; the smokes select a ticket in `ul[aria-label="Ticket list"]` first.
- **Context menus.** `ui/menus.tsx` adds context menus to project cards, Home project records, ticket rows, Board cards and session history. They open on a secondary click, Shift+F10 or the Menu key. They offer only commands that also exist elsewhere: open, new ticket, copy an id.
- **Overlay styles.** `design/overlays.css` holds them, in the components layer. A scroll region may now also be a labelled listbox.

`mvp-ui-smoke.mjs` gained four checks. Ctrl+K opens the palette, typing finds the project, and Enter opens it. Escape closes it. A secondary click opens a project card's menu with focus on its first command, and Escape returns focus. Shift+F10 opens the same menu.
