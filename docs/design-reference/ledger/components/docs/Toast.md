Toast is a short-lived confirmation that floats at the bottom centre.

Consumer provides the message as `children`, optional `tone` (`neutral`, `success`, `danger`, `warning`, `info`), `action` + `onAction` (Undo, Retry) and `onDismiss`. Pass `inline` to place it in flow (previews, docs).

- One line, past tense: "Copied", "Response inserted into Notepad", "Session removed".
- Auto-dismiss after 4 s, or 8 s with an action; never auto-dismiss errors that need action — use an Alert.
- Inverted ground (`toast`) in light, an elevation step in dark.
