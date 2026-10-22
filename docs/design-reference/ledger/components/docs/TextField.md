TextField is a labelled single-line input with hint, error, prefix and suffix.

Consumer provides `label`, and optionally `hint`, `error`, `placeholder`, `icon`, `prefix` / `suffix` (static text such as `https://`), `mono` (addresses, keys, codes), `type`, `optional`, `disabled`, and either `value` + `onChange` or `defaultValue`.

- Label above the field in `body-strong`-weight 13px; never placeholder-only labels.
- The hint is replaced by the error while one exists; the error sentence says what to do ("Enter a valid HTTPS NAS server address.").
- Validate on blur or submit, not per keystroke.
- Use `mono` for server addresses, tokens and IDs so characters are unambiguous.
