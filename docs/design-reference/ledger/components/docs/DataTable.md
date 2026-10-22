DataTable lists records with sortable columns, row selection and an empty row.

Consumer provides `columns` (`[{key, label, align, width, sortable, mono, muted, render}]`), `rows` (each with a unique `id`), optional `sort` (`{key, dir}`), `selectable`, `onRowClick`, `empty`.

- Text columns left, numbers and sizes right with tabular numerals. Dates muted.
- Header row sticks while scrolling. Selected rows tint `accent-soft`.
- Pair with Pagination below and Chips / SearchField above.
