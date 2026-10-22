import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Tooltip } from "./Tooltip";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("the control is described by the tooltip, which is in the DOM but hidden until shown", () => {
  const markup = html(<Tooltip label="Open the sidebar"><button type="button" aria-label="Sidebar">S</button></Tooltip>);
  const describedby = markup.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(describedby).toBeTruthy();
  expect(markup).toContain(`id="${describedby}" class="ov-tooltip" role="tooltip" hidden="">Open the sidebar</span>`);
});

test("an existing description is kept and the tooltip is appended to it", () => {
  const markup = html(<Tooltip label="Copies the id"><button type="button" aria-describedby="help">Copy</button></Tooltip>);
  expect(markup).toMatch(/aria-describedby="help [^"]+"/);
});

test("the wrapper takes class names and data attributes; the child keeps its own", () => {
  const markup = html(<Tooltip label="x" className="rail-item" data-surface="shell"><button type="button" className="quiet" data-capability="project.open">Go</button></Tooltip>);
  expect(markup).toContain('class="ov-tooltip-anchor rail-item"');
  expect(markup).toContain('data-surface="shell"');
  expect(markup).toContain('class="quiet" data-capability="project.open"');
});
