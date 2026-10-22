import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "../StatusBadge";
import { DataTable } from "./DataTable";
import type { DataColumn } from "./DataTable";
import { findAll } from "./elementTree";

interface Run { id: string; name: string; count: number; state: string }
const rows: Run[] = [{ id: "r1", name: "one", count: 3, state: "passed" }, { id: "r2", name: "two", count: 12, state: "failed" }];
const columns: DataColumn<Run>[] = [
  { key: "name", header: "Name", sortable: true, render: (row) => row.name },
  { key: "count", header: "Count", numeric: true, render: (row) => row.count },
  { key: "state", header: "State", render: (row) => <StatusBadge tone={row.state === "passed" ? "success" : "danger"}>{row.state}</StatusBadge> },
];
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("DataTable markup", () => {
  test("is a native table with a caption, scoped headers and numeric cells", () => {
    const markup = html(<DataTable caption="Runs" rows={rows} columns={columns} rowKey={(row) => row.id} />);
    expect(markup).toContain('<table class="data-table">');
    expect(markup).toContain("<caption>Runs</caption>");
    expect(markup.match(/<th scope="col"/g)).toHaveLength(3);
    expect(markup).toContain('data-numeric="">12</td>');
    expect(markup).toContain('<span class="state" data-tone="success">passed</span>');
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain('role="status"');
  });

  test("passes className, data and aria props through and can hide the caption", () => {
    const markup = html(<DataTable caption="Runs" captionHidden stickyHeader className="wide" data-surface="runs" aria-describedby="note" rows={rows} columns={columns} rowKey={(row) => row.id} />);
    expect(markup).toContain('class="data-table wide"');
    expect(markup).toContain('data-surface="runs"');
    expect(markup).toContain('aria-describedby="note"');
    expect(markup).toContain('data-sticky=""');
    expect(markup).toContain('<caption class="visually-hidden">Runs</caption>');
  });

  test("sortable headers are buttons inside th with aria-sort; others carry none", () => {
    const markup = html(<DataTable caption="Runs" rows={rows} columns={columns} rowKey={(row) => row.id} sort={{ key: "name", direction: "descending" }} onSortChange={() => undefined} />);
    expect(markup).toContain('<th scope="col" aria-sort="descending"><button type="button" class="sort-button" data-direction="descending" aria-label="Name, sorted descending">Name');
    expect(markup.match(/aria-sort=/g)).toHaveLength(1);
    expect(html(<DataTable caption="Runs" rows={rows} columns={columns} rowKey={(row) => row.id} />)).toContain('aria-sort="none"');
  });

  test("an empty table shows the empty state across every column", () => {
    const markup = html(<DataTable caption="Runs" rows={[]} columns={columns} rowKey={(row) => row.id} onSelectionChange={() => undefined} empty={<span>No runs yet</span>} />);
    expect(markup).toMatch(/<td col[sS]pan="4">/);
    expect(markup).toContain("No runs yet");
    expect(markup).toContain("No rows selected");
  });
});

describe("DataTable selection", () => {
  const select = (selection: string[], onSelectionChange = vi.fn()) => ({ element: <DataTable caption="Runs" rows={rows} columns={columns} rowKey={(row) => row.id} rowLabel={(row) => `Select ${row.name}`} selection={selection} onSelectionChange={onSelectionChange} />, onSelectionChange });

  test("adds a labelled select-all, labelled row boxes and a status announcement", () => {
    const markup = html(select(["r2"]).element);
    expect(markup).toContain('aria-label="Select all runs rows"');
    expect(markup).toContain('data-selection="some"');
    expect(markup).toContain('aria-label="Select one"');
    expect(markup).toContain('<tr data-selected="">');
    expect(markup).toContain('<p class="visually-hidden" role="status">1 of 2 rows selected</p>');
  });

  test("select-all and row boxes report the next selection", () => {
    const { element, onSelectionChange } = select(["r2"]);
    const boxes = findAll(element, (node) => node.type === "input" && node.props.type === "checkbox");
    expect(boxes).toHaveLength(2);
    const [rowOne] = findAll(element, (node) => node.type === "input" && node.props["aria-label"] === "Select one");
    (rowOne.props.onChange as () => void)();
    expect(onSelectionChange).toHaveBeenLastCalledWith(["r1", "r2"]);
    const [all] = findAll(element, (node) => typeof node.type === "function" && node.props["aria-label" as string] === undefined && node.props.state !== undefined);
    expect(all.props.state).toBe("some");
    (all.props.onChange as () => void)();
    expect(onSelectionChange).toHaveBeenLastCalledWith(["r1", "r2"]);
  });

  test("a sort header press asks for the next sort and never sorts rows itself", () => {
    const onSortChange = vi.fn();
    const element = <DataTable caption="Runs" rows={rows} columns={columns} rowKey={(row) => row.id} sort={{ key: "name", direction: "ascending" }} onSortChange={onSortChange} />;
    const [button] = findAll(element, (node) => node.type === "button");
    (button.props.onClick as () => void)();
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", direction: "descending" });
    expect(html(element).indexOf("one")).toBeLessThan(html(element).indexOf("two"));
  });
});
