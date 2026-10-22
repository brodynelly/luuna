LegendList is a stacked bar with a matching amount table, for a balance or status breakdown.

Consumer provides `rows` (`[{label, value, amount, color}]` where `color` is a chart token name), and optional `labelHeader`, `valueHeader`, `label`.

- Assign chart-1 to the most important segment, chart-muted to pending or incoming.
- When every amount is zero the bar shows chart-muted only; keep the table.
