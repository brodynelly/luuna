import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableOfContents } from "./TableOfContents";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const items = [{ id: "start", label: "Start" }, { id: "plans", label: "Plans", level: 2 as const }, { id: "end", label: "End" }];

test("is a labelled nav holding an ordered list of plain anchors", () => {
  const markup = html(<TableOfContents aria-label="On this page" items={items} />);
  expect(markup).toMatch(/^<nav class="toc" aria-label="On this page"><ol class="toc-list">/);
  expect(markup).toContain('<a href="#start">Start</a>');
  expect(markup).toContain('data-level="2"');
  expect(markup).not.toContain("tabindex");
});

test("only the current section is marked, and rest props pass through", () => {
  const markup = html(<TableOfContents aria-label="Contents" items={items} current="plans" className="x" data-capability="toc" />);
  expect(markup.match(/aria-current="location"/g)).toHaveLength(1);
  expect(markup).toContain('<a href="#plans" aria-current="location">');
  expect(markup).toContain('class="toc x"');
  expect(markup).toContain('data-capability="toc"');
});
