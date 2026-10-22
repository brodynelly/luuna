Badge labels the state of a payment, invoice or payout.

Consumer provides `tone` and a one or two word `children` in sentence case ("Succeeded", "Failed", "Overdue"). Optional `icon`.

- Each tone pairs a `*-soft` ground with its ink token: success / success-soft, danger / danger-soft, and so on.
- Status is never colour alone. The word carries the meaning; add `icon` (check, alert) where a table is scanned quickly.
- `neutral` for drafts and incomplete states, `accent` for "New" or feature labels, `info` for pending.
