import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "./IconButton";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("IconButton is a quiet button named by its label with a decorative icon", () => {
  const markup = html(<IconButton icon="search" label="Search" />);
  expect(markup).toContain('<button type="button" class="quiet icon-button" aria-label="Search">');
  expect(markup).toContain('<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">');
});

test("IconButton accepts an svg element, a variant, a size and a tone mark", () => {
  const markup = html(<IconButton icon={<svg aria-hidden="true" />} label="Delete" variant="danger" size="md" tone="danger" data-capability="x.delete" />);
  expect(markup).toContain('class="danger button-md icon-button"');
  expect(markup).toContain('data-capability="x.delete"');
  expect(markup).toContain('<span class="tone-mark" data-tone="danger" aria-hidden="true"></span>');
});

test("IconButton passes disabled and className through", () => {
  const markup = html(<IconButton icon="help" label="Help" disabled className="mine" />);
  expect(markup).toContain("disabled");
  expect(markup).toContain("mine");
});
