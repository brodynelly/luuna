Button triggers an action; one primary per view.

Consumer provides `children` (a short verb phrase in sentence case: "Pay out funds", "Add settlement currency"), `variant`, optional `icon` / `iconRight` (an `Icon` name) and `onClick`.

- `primary` (accent fill, ink-on-accent): the single most important action on the page, e.g. the banner's "Switch to live account".
- `secondary` (surface-raised + border + shadow-button): page actions in a row ("Add funds", "Manage payouts").
- `ghost`: toolbar and icon-adjacent actions.
- `link`: inline actions in cards ("View", "Create payment link").
- `size="md"` (32px) for page header rows; default 28px elsewhere.
- Disabled buttons keep their outline and switch the label to ink-disabled. Don't hide an action the user can't take yet; disable it.
