import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Popover } from "./Popover";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("a closed popover is one trigger button that says it is collapsed and renders no panel", () => {
  const markup = html(<Popover trigger="Filters" label="Filter the board"><p>Panel content</p></Popover>);
  expect(markup).toMatch(/^<div class="ov-anchor"><button type="button" aria-expanded="false" aria-haspopup="true">Filters<\/button><\/div>$/);
  expect(markup).not.toContain("Panel content");
  expect(markup).not.toContain("aria-controls");
});

test("rest props and class names land on the wrapper", () => {
  const markup = html(<Popover trigger="Filters" label="Filter the board" className="toolbar-item" data-surface="board">x</Popover>);
  expect(markup).toContain('class="ov-anchor toolbar-item"');
  expect(markup).toContain('data-surface="board"');
});
