/** DOM-free sort logic for DataTable. The table is controlled: it reports the next sort, the caller sorts rows. */
export type SortDirection = "ascending" | "descending";
export interface SortState { key: string; direction: SortDirection }
export type AriaSort = "ascending" | "descending" | "none";

/** Next state after activating a column header: ascending, then descending, then unsorted. */
export function nextSort(current: SortState | null | undefined, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: "ascending" };
  return current.direction === "ascending" ? { key, direction: "descending" } : null;
}

/** The `aria-sort` value for a sortable column; undefined for a column that cannot be sorted. */
export function ariaSort(current: SortState | null | undefined, key: string, sortable: boolean): AriaSort | undefined {
  if (!sortable) return undefined;
  return current && current.key === key ? current.direction : "none";
}

/** Plain-language hint appended to a sort button's accessible name. */
export function sortHint(sort: AriaSort | undefined): string {
  if (sort === "ascending") return "sorted ascending";
  if (sort === "descending") return "sorted descending";
  return "not sorted";
}

/** Locale-aware, numeric-aware comparison; empty values sort last in either direction. */
export function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const empty = (value: unknown) => value === null || value === undefined || value === "";
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** A stable sorted copy for callers that sort in memory. Empty values stay last regardless of direction. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => string | number | null | undefined, direction: SortDirection): T[] {
  const sign = direction === "ascending" ? 1 : -1;
  return rows.map((row, index) => ({ row, index, v: value(row) })).sort((x, y) => {
    const xe = x.v === null || x.v === undefined || x.v === "";
    const ye = y.v === null || y.v === undefined || y.v === "";
    if (xe || ye) return xe === ye ? x.index - y.index : xe ? 1 : -1;
    return compareValues(x.v, y.v) * sign || x.index - y.index;
  }).map((entry) => entry.row);
}
