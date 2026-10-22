Drawer is a side sheet for a focused task beside the current page, such as Ask AI.

Consumer provides `title`, optional `icon`, `headerActions`, `children`, `footer`, `onClose`; `inline` for previews; `open={false}` hides.

- 440px (`drawer-width`) from the right on `surface-overlay`, over a `scrim`.
- Body scrolls; header and footer stay put. Put the composer or the primary action in the footer.
