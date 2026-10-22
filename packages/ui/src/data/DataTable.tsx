import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { TableHead } from "./TableHead";
import type { DataColumn } from "./TableHead";
import { selectAllState, selectionAnnouncement, toggleAll, toggleRow } from "./tableSelection";
import type { SortState } from "./tableSort";

export type { DataColumn } from "./TableHead";

export interface DataTableProps<T> extends Omit<HTMLAttributes<HTMLTableElement>, "children"> {
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Names the table for assistive technology; shown above it unless `captionHidden`. */
  caption: string;
  captionHidden?: boolean;
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  /** Selected row keys. Passing `onSelectionChange` adds the checkbox column. */
  selection?: readonly string[];
  onSelectionChange?: (next: string[]) => void;
  /** Accessible name of a row checkbox. */
  rowLabel?: (row: T) => string;
  stickyHeader?: boolean;
  /** Shown in place of rows when there are none. */
  empty?: ReactNode;
}

/**
 * A controlled data table on a native table. Sorting and selection are requested through callbacks; the caller
 * holds the state, orders the rows and decides what a selection means (no bulk action lives here).
 */
export function DataTable<T>({ columns, rows, rowKey, caption, captionHidden, sort, onSortChange, selection = [], onSelectionChange, rowLabel, stickyHeader, empty = "No rows", className, ...rest }: DataTableProps<T>) {
  const keys = rows.map(rowKey);
  const selectable = onSelectionChange !== undefined;
  const chosen = new Set(selection);
  const span = columns.length + (selectable ? 1 : 0);
  return <>
    <table className={cx("data-table", className)} data-sticky={stickyHeader ? "" : undefined} {...rest}>
      <caption className={captionHidden ? "visually-hidden" : undefined}>{caption}</caption>
      <TableHead columns={columns} sort={sort} onSortChange={onSortChange} selectable={selectable} selectAll={selectAllState(keys, selection)} onToggleAll={() => onSelectionChange?.(toggleAll(keys, selection))} selectAllLabel={`Select all ${caption.toLowerCase()} rows`} rowCount={rows.length} />
      <tbody>
        {rows.length === 0 && <tr className="data-table-empty"><td colSpan={span}>{empty}</td></tr>}
        {rows.map((row, index) => <tr key={keys[index]} data-selected={chosen.has(keys[index]) ? "" : undefined}>
          {selectable && <td className="data-table-select"><input type="checkbox" aria-label={rowLabel ? rowLabel(row) : `Select row ${index + 1}`} checked={chosen.has(keys[index])} onChange={() => onSelectionChange?.(toggleRow(keys, selection, keys[index]))} /></td>}
          {columns.map((column) => <td key={column.key} data-align={column.align} data-numeric={column.numeric ? "" : undefined}>{column.render(row)}</td>)}
        </tr>)}
      </tbody>
    </table>
    {selectable && <p className="visually-hidden" role="status">{selectionAnnouncement(selection.filter((key) => keys.includes(key)).length, rows.length)}</p>}
  </>;
}
