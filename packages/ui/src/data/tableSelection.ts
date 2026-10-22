/** DOM-free selection logic for DataTable. Selection is a list of row keys held by the caller. */
export type SelectAllState = "none" | "some" | "all";

/** State of the select-all checkbox for the rows currently shown. */
export function selectAllState(rowKeys: readonly string[], selected: readonly string[]): SelectAllState {
  if (rowKeys.length === 0) return "none";
  const chosen = new Set(selected);
  const count = rowKeys.filter((key) => chosen.has(key)).length;
  return count === 0 ? "none" : count === rowKeys.length ? "all" : "some";
}

/** Toggle one row. Kept keys outside the shown rows (other pages) are preserved; shown keys keep row order. */
export function toggleRow(rowKeys: readonly string[], selected: readonly string[], key: string): string[] {
  const chosen = new Set(selected);
  if (chosen.has(key)) chosen.delete(key); else chosen.add(key);
  return orderSelection(rowKeys, selected, chosen);
}

/** Select every shown row unless all are selected, in which case clear the shown rows. */
export function toggleAll(rowKeys: readonly string[], selected: readonly string[]): string[] {
  const chosen = new Set(selected);
  const clearing = selectAllState(rowKeys, selected) === "all";
  for (const key of rowKeys) { if (clearing) chosen.delete(key); else chosen.add(key); }
  return orderSelection(rowKeys, selected, chosen);
}

function orderSelection(rowKeys: readonly string[], previous: readonly string[], chosen: ReadonlySet<string>): string[] {
  const shown = new Set(rowKeys);
  const hidden = previous.filter((key) => !shown.has(key) && chosen.has(key));
  return [...hidden, ...rowKeys.filter((key) => chosen.has(key))];
}

/** The sentence a screen reader hears after selection changes. */
export function selectionAnnouncement(selectedCount: number, rowCount: number): string {
  if (selectedCount === 0) return "No rows selected";
  return `${selectedCount} of ${rowCount} ${rowCount === 1 ? "row" : "rows"} selected`;
}
