# Desktop client: Apple HIG review, page by page

Date: 2026-10-22. Scope: `apps/desktop` (Tauri 2, React 19) after [ADR 0030](decisions/0030-desktop-shell-and-tailwind.md).
Method: the apple-design review skill. The references are the Human Interface Guidelines pages pulled from developer.apple.com: `accessibility`, `layout`, `typography`, `color`, `designing-for-macos`, `sidebars`, `split-views`, `toolbars`, `buttons`, `lists-and-tables`, `loading`, `feedback`, `writing`, `settings` and `the-menu-bar`. The cross-platform guide translates them for Tauri. The Tauri client runs on Windows and macOS, so Apple's macOS conventions apply as design principles. Windows conventions win where they differ: sentence-case labels and Ctrl shortcuts.

The client's thesis: one place to see what waits on the developer and to act on it, with evidence shown whole. What it is remembered by: green is earned. The six-tone status system is the one bold element, and everything around it stays quiet.

## Summary

Rating before this pass: **Needs work.** There were two High findings, which the skill's rating table maps to Needs work (Good allows at most a couple of High findings, and "several" means Needs work). The two:
- **No menu bar.** Commands were reachable only inside the page.
- **No confirmation after actions.** Completed actions were not confirmed anywhere except in the state that followed.

There were also several Medium findings: text-only loading states, empty states without a next step, a sidebar that could not be hidden, no Increase Contrast answer, and a page structure each view hand-built differently.

After this pass: **Good.** Nothing is Critical or High. The remaining Medium items are listed at the end.

## Shell (sidebar, window, menu bar)

| Finding | Severity | Guideline | Change |
| --- | --- | --- | --- |
| Commands reachable only inside the page | High | `the-menu-bar.md`; `toolbars.md › Platform considerations`: "Make every toolbar item available as a command in the menu bar." | Native menu bar (`src-tauri/src/menu.rs`). Luuna menu: About, Settings… (Ctrl+,), Quit. Edit menu: the standard commands, so copy and paste work in the web view on macOS. View menu: the six views (Ctrl+1–6) and Toggle Sidebar (Ctrl+\\). Help menu: Luuna Help. Menu commands reach the page as a DOM event, with no new Tauri permission. |
| The sidebar could not be hidden | Medium | `sidebars.md › Best practices`: "Consider letting people hide the sidebar." | A toggle beside the wordmark collapses the sidebar to an icon rail (`data-sidebar="collapsed"`; Ctrl+\\). Names stay as accessible names and tooltips. The rail is automatic at 920 px. |
| Settings had no standard shortcut | Medium | `settings.md`: "people often use the standard Command-Comma (,) keyboard shortcut to open an app's settings" | Ctrl+, (Command-, on a Mac) opens Settings, in the page and in the menu. |
| Critical controls at the bottom of the sidebar | — | `sidebars.md`: "Avoid putting critical information or actions at the bottom of a sidebar." | Already correct. The connection status sits under the wordmark, and Disconnect and Stop runtime live in Settings. |
| One color means one thing | — | `color.md › Best practices` | Already correct: the six tones, with green only for passed evidence (ADR 0013). |

## Page template (every view)

| Finding | Severity | Guideline | Change |
| --- | --- | --- | --- |
| Each view hand-built its own heading, description and actions | Medium | `layout.md`: "Align elements to make them easier to scan" and "Group related items"; `writing.md`: "Build language patterns" | One `Page` template (`src/ui/layout.tsx`): a large title, one sentence from `src/content/views.ts`, then trailing toolbar actions and the content. Sections come from one `Section` component, so the outline is h2 per view, h3 per section and h4 inside a section, everywhere. |
| "Reading the runtime's …" text while loading | Medium | `loading.md`: "Show something as soon as possible." | `Loading` shows placeholder rows in the content's shape, announced once to assistive technology, with no motion. |
| Completed actions were not confirmed | High | `feedback.md`: "When it makes sense, confirm that a significant action or task has completed." | One notice at the top of the content in past tense ("Plan approved", "Ticket created", "Baseline started"), from `COMPLETED` in `src/ui/selection.tsx`. It is a polite live region and is never timed (`accessibility.md`: "Minimize use of time-boxed interface elements"). It stays until dismissed or replaced. Refusals keep the dismissible alert banner. |
| No Increase Contrast answer | Medium | `color.md`: "Make sure all your app's colors work well in light, dark, and increased contrast contexts." | `prefers-contrast: more` raises dividers to the control edge and meta text to the label colour (`design/tokens.css`). |
| Identical "Refresh" names on several views | Low | `accessibility.md`: describe the interface for VoiceOver | Each Refresh button carries its view in its accessible name ("Refresh Home", "Refresh Board"); the visible label is unchanged. |

## Home

| Finding | Severity | Guideline | Change |
| --- | --- | --- | --- |
| A blank screen without a next step | Medium | `writing.md`: "Provide clear next steps on any blank screens." | With no projects, Home says "No projects yet" and offers **Add a project…**, which opens Projects. The ellipsis follows `buttons.md`: "Append a trailing ellipsis to the title when a push button opens another window, view, or app." |
| What waits on the developer came after the projects | Medium | `layout.md`: "Order content by relative importance." | Kept from ADR 0030: "Waiting on you" comes first. |

## Board

Kept: eight read-only columns with a count each; selecting a card opens its ticket (`lists-and-tables.md`: "Provide appropriate feedback when people select a list item"). Each column heading now renders through the library's heading row, and the loading state is the placeholder rows.

## Projects

Kept from ADR 0030: the project list first, with "Add a project", "Import from another machine" and "Create from a stack profile" as progressive disclosure (`layout.md`: "Use progressive disclosure to make layouts cleaner"). The selected project is a card headed by its name.

The page is now 15 focused files under `src/projects/`, each under 300 lines. Completed actions are confirmed by the notice.

## Tickets, plans and candidates

Kept: the immutable plan with its full hash and the explicit acknowledgment before **Approve** (`feedback.md`: warn before what cannot be undone), and the destructive cancel as a small danger button never styled primary (`buttons.md`: "Don't assign the primary role to a button that performs a destructive action"). The "changed outside Luuna" note is now an attention-toned status callout.

The screen is now `src/workflows/` and `src/candidate/`, each file under 300 lines.

## Sessions

Kept: history beside the start form and the event record, and provider and model folded away as progressive disclosure. The event record is the library's `ScrollList`: labelled, focusable and bounded.

## Settings

Kept: one task per section (`settings.md`: "Minimize the number of settings you offer"). The runtime card's Disconnect and Stop now sit on the trailing side of its heading, like every other section's actions. The environment report is a grouped list.

## Help

Kept: static sections. External documents open in the browser through `ExternalLink`.

## Capitalization and writing

Apple uses title-style capitalization for buttons. Windows, the client's first platform, uses sentence case. `writing.md` says to "Adopt capitalization rules that align with your app's style, then apply them consistently". The client keeps sentence case everywhere, except the native menu bar, which follows each platform's menu style ("Toggle Sidebar"). Labels say what happens ("Create ticket", "Approve r2", "Validate and review"), and an action keeps its name through the flow (`writing.md`: "Be action oriented").

## What is enforced

- `src/design/components.test.ts` fails when any front-end file (TypeScript, TSX or CSS) is over 300 lines.
- It fails when a view renders a raw control, heading, form, disclosure, container, block, paragraph, hint, list, link or alert instead of a library component. Views keep only inline text: span, strong and time.
- It fails when a heading is rendered outside `src/ui`, or when a view page does not render through `Page`.
- `src/design/design-system.test.ts` still enforces tokens only, both schemes, WCAG AA pairs (now including the sidebar surface) and the tone taxonomy.

## Follow-ups implemented (2026-10-22)

| Item | Guideline | Implementation |
| --- | --- | --- |
| Command palette | Judgment (a find-anything field; `searching.md` gives search a primary position) | Ctrl+K, View › Go to… in the menu bar, or **Go to…** at the top of the sidebar opens a modal `<dialog>` (focus stays in it, Escape closes it, focus returns where it was). A combobox filters a listbox of every view, window command, project ("Open …", "New ticket in …") and ticket, read from the runtime each time it opens. Every command also exists elsewhere (`ui/palette.tsx`, `shell/usePalette.ts`). |
| Ticket detail | `split-views.md`: "persistently highlight the current selection"; `layout.md`: "Use progressive disclosure" | The Tickets section lists every ticket as one selectable row (title, the latest plan's run state, revisions), then shows one ticket's detail: plan, candidate and evidence. Selection follows a new ticket, a Home or Board request and the palette (`workflows/TicketList.tsx`). Existing tickets come before the new-ticket form. |
| Context menus | `cross-platform.md › Desktop`: "right-click context menus" | A secondary click, Shift+F10 or the Menu key opens the item's commands. Covered items: project cards ("Open project", "Copy project ID"), Home project records (plus "New ticket"), ticket rows, Board cards and session history. Arrow keys move through the commands and Escape returns focus to the item. Each command also exists elsewhere (`ui/menus.tsx`). |

## Open (Medium or lower)

- **Native verification.** The menu bar compiles (`cargo check`, `cargo clippy`), but it has not yet been exercised in the Tauri window on Windows or macOS.
- **Native verification.** The menu bar compiles (`cargo check`, `cargo clippy`), but it has not yet been exercised in the Tauri window on Windows or macOS.
