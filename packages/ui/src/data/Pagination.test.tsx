import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Pagination } from "./Pagination";
import { findAll, text } from "./elementTree";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("is a labelled nav with the current page marked and a polite summary", () => {
  const markup = html(<Pagination page={5} pageCount={10} label="Runs pages" onPageChange={() => undefined} className="runs" data-surface="runs" />);
  expect(markup).toContain('<nav class="pagination runs" aria-label="Runs pages" data-surface="runs">');
  expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  expect(markup).toContain('aria-current="page" aria-label="Page 5">5</button>');
  expect(markup).toContain('role="status">Page 5 of 10<');
  expect(markup.match(/aria-hidden="true">\.\.\.</g)).toHaveLength(2);
});

test("Previous and Next are disabled at the ends", () => {
  const first = html(<Pagination page={1} pageCount={3} label="Pages" onPageChange={() => undefined} />);
  expect(first).toMatch(/<button type="button" disabled="">Previous/);
  expect(first).not.toMatch(/disabled="">Next/);
  const last = html(<Pagination page={3} pageCount={3} label="Pages" onPageChange={() => undefined} />);
  expect(last).toMatch(/disabled="">Next/);
});

test("shows an item range when the totals are known", () => {
  expect(html(<Pagination page={2} pageCount={6} pageSize={10} totalItems={53} label="Pages" onPageChange={() => undefined} />)).toContain("Showing 11 to 20 of 53");
});

test("buttons request pages, never the current or an out-of-range one", () => {
  const onPageChange = vi.fn();
  const buttons = findAll(<Pagination page={2} pageCount={3} label="Pages" onPageChange={onPageChange} />, (node) => node.type === "button");
  const press = (label: string) => (buttons.find((button) => text(button) === label)!.props.onClick as () => void)();
  press("Next");
  press("Previous");
  press("2");
  press("3");
  expect(onPageChange.mock.calls).toEqual([[3], [1], [3]]);
});

test("a page beyond the count is clamped", () => {
  expect(html(<Pagination page={99} pageCount={4} label="Pages" onPageChange={() => undefined} />)).toContain("Page 4 of 4");
});
