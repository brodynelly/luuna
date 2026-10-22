import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NavGroup } from "./NavGroup";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("is a native details with a summary and a labelled list", () => {
  const markup = html(<NavGroup label="Recent"><li>one</li></NavGroup>);
  expect(markup).toBe('<details class="nav-group"><summary class="nav-group-summary sidebar-label">Recent</summary><ul class="nav-group-list" aria-label="Recent"><li>one</li></ul></details>');
});

test("defaultOpen opens it; rest props and className pass through; no tabindex is added", () => {
  const markup = html(<NavGroup label="Pinned" defaultOpen className="mine" data-capability="nav.pinned"><li>x</li></NavGroup>);
  expect(markup).toContain('<details class="nav-group mine" open=""');
  expect(markup).toContain('data-capability="nav.pinned"');
  expect(markup).not.toContain("tabindex");
  expect(html(<NavGroup label="A"><li /></NavGroup>)).not.toContain("open");
});
