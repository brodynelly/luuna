import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "./PageHeader";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("renders the Page template hooks: panel-heading row with one h2, then p.scope", () => {
  const markup = html(<PageHeader id="home" title="Home" description="What needs you." actions={<button type="button">New</button>} />);
  expect(markup).toBe('<div class="panel-heading page-header"><h2 id="home-heading" aria-describedby="home-description">Home</h2><button type="button">New</button></div><p class="scope" id="home-description">What needs you.</p>');
  expect(markup.match(/<h2/g)).toHaveLength(1);
});

test("the sentence, meta and breadcrumbs are optional and ordered", () => {
  const bare = html(<PageHeader id="x" title="X" />);
  expect(bare).not.toContain("aria-describedby");
  expect(bare).not.toContain("scope");
  const full = html(<PageHeader id="x" title="X" description="d" meta={<span>m</span>} breadcrumbs={<nav aria-label="Path" />} data-surface="s" className="extra" />);
  expect(full.indexOf("<nav")).toBeLessThan(full.indexOf("<h2"));
  expect(full.indexOf("<h2")).toBeLessThan(full.indexOf('class="scope"'));
  expect(full.indexOf('class="scope"')).toBeLessThan(full.indexOf('class="page-meta"'));
  expect(full).toContain('class="panel-heading page-header extra"');
  expect(full).toContain('data-surface="s"');
});
