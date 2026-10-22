import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Anchor } from "./Anchor";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("an internal Anchor is a plain link with no target", () => {
  const markup = html(<Anchor href="#/help">Help</Anchor>);
  expect(markup).toMatch(/^<a /);
  expect(markup).toContain('href="#/help"');
  expect(markup).not.toContain("target=");
  expect(markup).not.toContain("opens in a new window");
  expect(markup).toContain('data-variant="accent"');
  expect(markup).toContain('data-underline="hover"');
});

test("an external Anchor opens a new window safely and says so in text and with a hidden mark", () => {
  const markup = html(<Anchor href="https://example.com" external>Docs</Anchor>);
  expect(markup).toContain('target="_blank"');
  expect(markup).toContain('rel="noopener noreferrer"');
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).toContain('<span class="visually-hidden"> (opens in a new window)</span>');
});

test("Anchor takes a variant and underline, and passes class, data and aria through", () => {
  const markup = html(<Anchor href="/x" variant="subtle" underline="always" className="a" data-capability="link.x" aria-label="Open x">x</Anchor>);
  expect(markup).toContain('data-variant="subtle"');
  expect(markup).toContain('data-underline="always"');
  expect(markup).toContain('class="prim-anchor a"');
  expect(markup).toContain('data-capability="link.x"');
  expect(markup).toContain('aria-label="Open x"');
});

test("an Anchor needs an href", () => {
  // @ts-expect-error href is required
  void (<Anchor>x</Anchor>);
});
