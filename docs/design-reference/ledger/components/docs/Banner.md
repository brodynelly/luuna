Banner is the full-width environment strip pinned above the whole app.

Consumer provides `label` (default "Sandbox"), the message as `children`, and an optional `action` + `onAction`.

- Only for app-wide state that changes what every action means (test data, impersonation, maintenance). One at a time.
- Sits on `banner` with `ink-on-banner`; the action is a primary Button.
