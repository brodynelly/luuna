import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog } from "./Dialog";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;

test("a closed dialog renders a native <dialog> without the open attribute, so it never opens on load", () => {
  const markup = html(<Dialog open={false} onClose={noop} title="Approve plan" actions={<button type="button">Approve</button>} />);
  expect(markup).toMatch(/^<dialog class="ov-dialog"/);
  expect(markup).not.toMatch(/<dialog[^>]* open/);
});

test("the dialog is named by its title and described by its description through paired ids", () => {
  const markup = html(<Dialog open={false} onClose={noop} title="Approve plan" description="Approving binds this exact plan." actions={null} />);
  const labelled = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
  const described = markup.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(markup).toContain(`id="${labelled}"`);
  expect(markup).toContain(`id="${described}"`);
  expect(markup).toContain("Approve plan");
  expect(markup).toContain("Approving binds this exact plan.");
});

test("without a description there is no aria-describedby pointing at nothing", () => {
  expect(html(<Dialog open={false} onClose={noop} title="Rename" actions={null} />)).not.toContain("aria-describedby");
});

test("the title is a paragraph, not a heading, so a dialog never adds a second h2 to the page outline", () => {
  const markup = html(<Dialog open={false} onClose={noop} title="Rename" actions={null} />);
  expect(markup).toContain('<p class="ov-dialog-title"');
  expect(markup).not.toMatch(/<h[1-6]/);
});

test("the danger tone adds a decorative shape mark; the title text is unchanged", () => {
  const danger = html(<Dialog open={false} onClose={noop} tone="danger" title="Discard candidate" actions={null} />);
  expect(danger).toContain('<span class="tone-mark" data-tone="danger" aria-hidden="true"></span>Discard candidate');
  expect(html(<Dialog open={false} onClose={noop} title="Rename" actions={null} />)).not.toContain("tone-mark");
});

test("the actions render in a footer after the body, in the caller's order", () => {
  const markup = html(<Dialog open={false} onClose={noop} title="Rename" actions={<><button type="button">Cancel</button><button type="button">Rename</button></>}><p>New name</p></Dialog>);
  expect(markup.indexOf("New name")).toBeLessThan(markup.indexOf("ov-dialog-actions"));
  expect(markup.indexOf("Cancel")).toBeLessThan(markup.indexOf(">Rename</button>"));
});

test("class names, data attributes and aria props pass through", () => {
  const markup = html(<Dialog open={false} onClose={noop} title="Rename" actions={null} className="wide" data-surface="projects" aria-modal="true" />);
  expect(markup).toContain('class="ov-dialog wide"');
  expect(markup).toContain('data-surface="projects"');
});
