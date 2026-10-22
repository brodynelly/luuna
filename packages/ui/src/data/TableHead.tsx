import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ariaSort, nextSort, sortHint } from "./tableSort";
import type { SortState } from "./tableSort";
import type { SelectAllState } from "./tableSelection";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** The header becomes a button that asks for the next sort; the caller sorts. */
  sortable?: boolean;
  align?: "start" | "center" | "end";
  /** Right-aligned with tabular figures. */
  numeric?: boolean;
  /** Plain text for the sort button's accessible name when `header` is not text. */
  headerLabel?: string;
}

interface Props<T> {
  columns: readonly DataColumn<T>[];
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  selectable: boolean;
  selectAll: SelectAllState;
  onToggleAll: () => void;
  selectAllLabel: string;
  rowCount: number;
}

/** The select-all checkbox. `indeterminate` is a DOM property, so it is set after render. */
function SelectAll({ state, label, onChange, disabled }: { state: SelectAllState; label: string; onChange: () => void; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === "some"; }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={state === "all"} disabled={disabled} data-selection={state} onChange={onChange} />;
}

export function TableHead<T>({ columns, sort, onSortChange, selectable, selectAll, onToggleAll, selectAllLabel, rowCount }: Props<T>) {
  return <thead><tr>
    {selectable && <th scope="col" className="data-table-select"><SelectAll state={selectAll} label={selectAllLabel} onChange={onToggleAll} disabled={rowCount === 0} /></th>}
    {columns.map((column) => {
      const sorted = ariaSort(sort, column.key, Boolean(column.sortable));
      const direction = sorted === "ascending" || sorted === "descending" ? sorted : undefined;
      const text = column.headerLabel ?? (typeof column.header === "string" ? column.header : column.key);
      return <th key={column.key} scope="col" aria-sort={sorted} data-align={column.align} data-numeric={column.numeric ? "" : undefined}>
        {column.sortable
          ? <button type="button" className="sort-button" data-direction={direction} aria-label={`${text}, ${sortHint(sorted)}`} onClick={() => onSortChange?.(nextSort(sort, column.key))}>{column.header}<span className="sort-mark" aria-hidden="true" /></button>
          : column.header}
      </th>;
    })}
  </tr></thead>;
}
