Select is a labelled native dropdown for choosing one option from a short list.

Consumer provides `label`, `options` (strings or `{value, label, disabled}`), and `defaultValue` or `value` + `onChange`; optional `hint`, `error`, `disabled`.

- Use for 4–15 options. Fewer than 4: SegmentedControl or RadioGroup. More: a searchable list.
- Native `select` underneath, so keyboard and screen-reader behaviour come from the OS.
