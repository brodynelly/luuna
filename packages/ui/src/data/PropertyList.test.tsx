import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyList } from "./PropertyList";

const items = [{ term: "Commit", value: "abc123", mono: true }, { term: "Branch", value: "main" }];

test("renders a dl of term and value groups, with monospace values on request", () => {
  const markup = renderToStaticMarkup(<PropertyList items={items} />);
  expect(markup).toMatch(/^<dl class="property-list" data-layout="stacked">/);
  expect(markup).toContain("<div><dt>Commit</dt><dd><code>abc123</code></dd></div>");
  expect(markup).toContain("<div><dt>Branch</dt><dd>main</dd></div>");
});

test("accepts className facts and passes aria and data props", () => {
  const markup = renderToStaticMarkup(<PropertyList items={items} layout="inline" className="facts" aria-label="Baseline" data-capability="x.y" />);
  expect(markup).toContain('class="property-list facts"');
  expect(markup).toContain('data-layout="inline"');
  expect(markup).toContain('aria-label="Baseline"');
  expect(markup).toContain('data-capability="x.y"');
});
