MetricCard shows one metric: title, value, comparison and a trend line or an empty state.

Consumer provides `title`, `value` (pre-formatted string), `comparison` ("$0.00 previous period"), optional `delta` ("+12.4%", "-3.1%"), `data` (numbers) with `start` / `end` axis labels, `until` (index where the actual data stops; the rest is dashed), `updated` and `href`.

- No `data` (or an empty array) renders the dashed "No data" state; never draw a flat zero line for a metric that has no events.
- Lay cards in a 2-column grid with a space-4 gutter on a surface-muted tray in light, directly on black in dark.
- Values and deltas use tabular numerals; positive deltas success, negative danger, always with the sign.
