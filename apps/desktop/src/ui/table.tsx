import type { ReactNode } from "react";

/**
 * A data table: fixed layout that wraps instead of scrolling sideways, hairline rows, tabular
 * numerics. Columns say how to read a row; nothing here decides a value.
 */
export interface TableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-aligned with tabular figures. */
  numeric?: boolean;
}

export interface TableProps<T> {
  label: string;
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  className?: string;
}

export function Table<T>({ label, columns, rows, rowKey, className }: TableProps<T>) {
  return <table className={["table", className].filter(Boolean).join(" ")} aria-label={label}>
    <thead><tr>{columns.map((column) => <th key={column.id} scope="col" data-numeric={column.numeric ? "" : undefined}>{column.header}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.id} data-numeric={column.numeric ? "" : undefined}>{column.cell(row)}</td>)}</tr>)}</tbody>
  </table>;
}
