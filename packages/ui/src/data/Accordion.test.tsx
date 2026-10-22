import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Accordion } from "./Accordion";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const items = [
  { id: "a", title: "First", content: "One" },
  { id: "b", title: "Second", content: "Two", defaultOpen: true },
  { id: "c", title: "Third", content: "Three", defaultOpen: true },
];

test("single-open panels share one name and only the first default opens", () => {
  const markup = html(<Accordion items={items} className="faq" data-surface="help" />);
  expect(markup).toMatch(/^<div class="accordion faq" data-surface="help">/);
  const names = [...markup.matchAll(/<details name="([^"]+)"/g)].map((match) => match[1]);
  expect(names).toHaveLength(3);
  expect(new Set(names).size).toBe(1);
  expect(markup.match(/<details[^>]* open=""/g)).toHaveLength(1);
  expect(markup).toContain("<summary>Second</summary>");
});

test("an explicit name is used for the group", () => {
  expect(html(<Accordion items={items} name="help-faq" />).match(/name="help-faq"/g)).toHaveLength(3);
});

test("multiple mode has no name and keeps every default open", () => {
  const markup = html(<Accordion items={items} multiple />);
  expect(markup).not.toContain("name=");
  expect(markup.match(/<details[^>]* open=""/g)).toHaveLength(2);
});
