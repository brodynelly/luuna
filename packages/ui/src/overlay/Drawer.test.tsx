import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Drawer } from "./Drawer";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;

test("a closed drawer is a native <dialog> on the right by default, named by its title, never open on load", () => {
  const markup = html(<Drawer open={false} onClose={noop} title="Run details"><p>Body</p></Drawer>);
  expect(markup).toMatch(/^<dialog class="ov-drawer" data-side="right"/);
  expect(markup).not.toMatch(/<dialog[^>]* open/);
  const labelled = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
  expect(markup).toContain(`id="${labelled}">Run details</p>`);
});

test("a Close button is always present so the drawer can be left without Escape", () => {
  expect(html(<Drawer open={false} onClose={noop} title="Run details" />)).toContain('<button type="button" class="quiet">Close</button>');
});

test("the side prop and pass-through props land on the dialog", () => {
  const markup = html(<Drawer open={false} onClose={noop} side="left" title="Filters" className="wide" data-surface="board" />);
  expect(markup).toContain('data-side="left"');
  expect(markup).toContain('class="ov-drawer wide"');
  expect(markup).toContain('data-surface="board"');
});
