Icon draws one of the system's 1.75px-stroke, 24-grid line icons.

Consumer provides `name` (see `Ledger.Icon.names`), optional `size` (16 default; 18 in the sidebar, 14 inside buttons, 12 inside badges) and `label` when the icon stands alone.

- Icons inherit `currentColor`: set the colour on the parent (ink-muted at rest, accent-text when active).
- Outline only, rounded caps and joins. Never fill, never mix with emoji.
