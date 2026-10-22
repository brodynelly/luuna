import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableHead } from "./TableHead";
import type { DataColumn } from "./TableHead";
import { findAll } from "./elementTree";

const columns: DataColumn<{ n: string }>[] = [
  { key: "name", header: "Name", sortable: true, render: (row) => row.n },
  { key: "note", header: <em>Note</em>, headerLabel: "Note text", sortable: true, align: "end", render: (row) => row.n },
  { key: "plain", header: "Plain", render: (row) => row.n },
];
const base = { columns, selectable: false, selectAll: "none" as const, onToggleAll: () => undefined, selectAllLabel: "Select all", rowCount: 2 };
const table = (props: Parameters<typeof TableHead<{ n: string }>>[0]) => renderToStaticMarkup(<table><TableHead {...props} /></table>);

test("renders aria-sort only for sortable columns and names buttons from header text", () => {
  const markup = table({ ...base, sort: { key: "note", direction: "ascending" } });
  expect(markup).toContain('aria-sort="none"');
  expect(markup).toContain('aria-sort="ascending"');
  expect(markup.match(/aria-sort=/g)).toHaveLength(2);
  expect(markup).toContain('aria-label="Name, not sorted"');
  expect(markup).toContain('aria-label="Note text, sorted ascending"');
  expect(markup).toContain('data-align="end"');
});

test("the select column appears only when selectable and disables select-all with no rows", () => {
  expect(table(base)).not.toContain("checkbox");
  expect(table({ ...base, selectable: true, selectAll: "all" })).toContain('checked=""');
  expect(table({ ...base, selectable: true, rowCount: 0 })).toContain("disabled");
});

test("activating a sort button reports the next sort", () => {
  const onSortChange = vi.fn();
  const buttons = findAll(<TableHead {...base} onSortChange={onSortChange} />, (node) => node.type === "button");
  expect(buttons).toHaveLength(2);
  (buttons[1].props.onClick as () => void)();
  expect(onSortChange).toHaveBeenCalledWith({ key: "note", direction: "ascending" });
});
