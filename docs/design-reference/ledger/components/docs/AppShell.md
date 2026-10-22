AppShell is the app frame: environment Banner, sidebar, sticky top bar and a scrolling content column, laid out content-first.

Consumer provides `banner` (a Banner or nothing), `brand` (`{name, subtitle, logo}`), `nav` (NavItem.Group elements), `sidebarFooter` (usually a StatusIndicator), `search` (SearchField), `actions` (IconButtons, Avatar), optional `rail` (a right-hand column for secondary content), `wide` (drop the 1200px content cap), and the page as `children` (start with a PageHeader).

- Fixed chrome is the Banner (40px) plus the top bar (56px): 96px, 12.5% of a 768px window. Don't add more fixed bars; put notices inside the content as Alert or Callout.
- The first screen belongs to the page's own content. Promotions, recommendations, onboarding and tips go below the primary content or in `rail`, never between the PageHeader and the content.
- Under 768px the sidebar becomes an off-canvas panel opened from the top-bar menu button; padding drops to space-4.
- No dialogs, drawers or toasts open on page load.
