import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Split } from "./layout";
import { read } from "./design/sheet-fixtures";

test("Split without stickyRail renders the rail directly, as before", () => {
  expect(renderToStaticMarkup(<Split className="l" rail={<nav>r</nav>}><p>d</p></Split>)).toBe('<div class="l"><nav>r</nav><p>d</p></div>');
});

test("stickyRail wraps the rail in the sticky hook and the sheet owns the banner offset", () => {
  expect(renderToStaticMarkup(<Split className="l" rail={<nav>r</nav>} stickyRail><p>d</p></Split>)).toBe('<div class="l"><div class="split-rail" data-sticky=""><nav>r</nav></div><p>d</p></div>');
  const css = read("ui/styles/components.css");
  expect(css).toContain(".split-rail[data-sticky] { position: sticky; top: calc(var(--topbar-height) + var(--spacing-lg));");
  expect(css).toContain(".app[data-banner] .split-rail[data-sticky] { top: calc(var(--banner-height) + var(--topbar-height) + var(--spacing-lg)); }");
});
