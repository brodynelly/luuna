TextArea is a multi-line input with an optional live character counter.

Consumer provides `label`, optional `hint`, `rows`, `placeholder`, `maxLength` and `defaultValue` / `value` + `onChange`.

- With `maxLength` the counter shows `n / max` and, past the limit, switches to danger with an error that says nothing was cut off. Never truncate silently.
- The counter counts UTF-16 units (JavaScript `length`), matching the desktop app's 6,000 and 16,000 limits; emoji count as two.
