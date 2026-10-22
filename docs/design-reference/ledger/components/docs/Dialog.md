Dialog is a modal that asks for a decision or a short form before continuing.

Consumer provides `title`, optional `description`, `children` (form fields), `actions` (Buttons, primary last), `onClose`, `tone="danger"` for destructive confirms, `wide` (640px). `open={false}` hides it; `inline` places it in flow (previews).

- Title is the question or the action ("Disconnect this device?"). The confirm button repeats the verb ("Disconnect"), never "OK" or "Yes".
- Destructive confirms use `variant="danger"`; the cancel button is secondary and gets initial focus.
- Escape and the scrim close it unless a task is in progress. In dark the dialog sits on `surface-overlay` (#1D1D1F) with a hairline edge, over a 60% black scrim.
