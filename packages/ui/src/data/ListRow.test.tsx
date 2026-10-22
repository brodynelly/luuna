import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "../StatusBadge";
import { ListRow } from "./ListRow";
import { findAll } from "./elementTree";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("a plain row is an li with leading, title, meta and trailing and no button", () => {
  const markup = html(<ListRow leading="A" title="Walkthrough" meta="3 tickets" trailing={<StatusBadge tone="success">passed</StatusBadge>} data-capability="a.b" />);
  expect(markup).toMatch(/^<li class="list-row" data-capability="a.b">/);
  expect(markup).toContain('<span class="list-row-leading">A</span>');
  expect(markup).toContain('<span class="list-row-title">Walkthrough</span><span class="list-row-meta">3 tickets</span>');
  expect(markup).toContain('<span class="state" data-tone="success">passed</span>');
  expect(markup).not.toContain("<button");
  expect(markup).not.toContain("aria-pressed");
});

test("an interactive row is one button that fills it, with aria-pressed for selection", () => {
  const markup = html(<ListRow title="Run" onOpen={() => undefined} selected className="run-card" />);
  expect(markup.match(/<button/g)).toHaveLength(1);
  expect(markup).toContain('class="list-row run-card" data-selected=""');
  expect(markup).toContain('type="button" class="list-row-body" aria-pressed="true"');
  expect(html(<ListRow title="Run" onOpen={() => undefined} />)).not.toContain("aria-pressed");
  expect(html(<ListRow title="Run" onOpen={() => undefined} selected={false} />)).toContain('aria-pressed="false"');
});

test("pressing the row opens it", () => {
  const onOpen = vi.fn();
  const [button] = findAll(<ListRow title="Run" onOpen={onOpen} />, (node) => node.type === "button");
  (button.props.onClick as () => void)();
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("a disabled row disables its button, and a label goes on the button, not the li", () => {
  const markup = html(<ListRow title="Run" onOpen={() => undefined} disabled buttonLabel="Open Run 12" aria-label="Row" data-capability="a.b" />);
  expect(markup).toMatch(/^<li class="list-row" aria-label="Row" data-capability="a.b">/);
  expect(markup).toContain('<button type="button" class="list-row-body" aria-label="Open Run 12" disabled="">');
  expect(html(<ListRow title="Run" onOpen={() => undefined} />)).not.toContain("disabled");
});

test("detail (or children) renders below the title row, outside the button", () => {
  const markup = html(<ListRow title="Project" meta="meta" onOpen={() => undefined} detail={<ul><li>repo</li></ul>} />);
  expect(markup).toContain('</button><div class="list-row-detail"><ul><li>repo</li></ul></div></li>');
  expect(html(<ListRow title="Project"><p>nested</p></ListRow>)).toContain('<div class="list-row-detail"><p>nested</p></div>');
  expect(html(<ListRow title="Project" />)).not.toContain("list-row-detail");
});

test("commands attach a context menu to the li itself: still a plain li, menu closed until asked", () => {
  const markup = html(<ListRow title="Run" className="r" data-capability="a.b" onOpen={() => undefined} commands={() => [{ label: "Open", onSelect: () => undefined }]} menuLabel="Actions for Run" />);
  expect(markup).toMatch(/^<li class="list-row r" data-capability="a.b"><button /);
  expect(markup).not.toContain("role=\"menu\"");
  expect(markup).not.toContain("context-area");
});

test("buttonClassName lands on the inner button only", () => {
  const markup = html(<ListRow title="Run" onOpen={() => undefined} className="run" buttonClassName="run-card" />);
  expect(markup).toContain('<li class="list-row run"');
  expect(markup).toContain('<button type="button" class="list-row-body run-card"');
  expect(html(<ListRow title="Run" buttonClassName="run-card" />)).not.toContain("run-card");
});

test("actions sit beside the row button, inside the li, and add no wrapper when absent", () => {
  const markup = html(<ListRow title="Run" onOpen={() => undefined} actions={<button type="button">Retry</button>} />);
  expect(markup).toContain('<div class="list-row-head"><button type="button" class="list-row-body">');
  expect(markup).toContain('</button><div class="list-row-actions"><button type="button">Retry</button></div></div></li>');
  expect(html(<ListRow title="Run" onOpen={() => undefined} />)).not.toContain("list-row-head");
});

test("titleAs makes the title a block element on a plain row and is ignored on a button row", () => {
  const plain = html(<ListRow title="Long text" titleAs="p" meta="m" />);
  expect(plain).toContain('<div class="list-row-main"><p class="list-row-title">Long text</p><span class="list-row-meta">m</span></div>');
  expect(html(<ListRow title="T" titleAs="div" />)).toContain('<div class="list-row-title">T</div>');
  const button = html(<ListRow title="T" titleAs="div" onOpen={() => undefined} />);
  expect(button).toContain('<span class="list-row-main"><span class="list-row-title">T</span>');
  expect(button).not.toContain('<div class="list-row-title');
});
