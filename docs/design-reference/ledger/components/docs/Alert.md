Alert is an inline message about the state of a page or form, in four tones.

Consumer provides `tone` (`info`, `success`, `warning`, `danger`), optional `title`, the message as `children`, optional `actions` (Buttons) and `onDismiss`.

- Lives in the content, near what it describes. Use a Toast for transient confirmations and the Banner for app-wide environment state.
- Title states the outcome; the body says what to do next. Copy the desktop app's pattern: "The NAS is unreachable. Check Tailscale and the server address."
- `danger` alerts are announced (`role="alert"`); others are polite status.
