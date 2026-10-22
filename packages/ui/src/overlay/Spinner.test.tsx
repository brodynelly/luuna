import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Spinner } from "./Spinner";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("the spinner is a status region whose label is real text, with a decorative ring", () => {
  expect(html(<Spinner />)).toBe('<span class="ov-spinner" role="status"><span class="ov-spinner-ring" aria-hidden="true"></span><span class="ov-spinner-label">Loading</span></span>');
});

test("the label says what is in progress", () => {
  expect(html(<Spinner label="Reading projects" />)).toContain(">Reading projects</span>");
});

test("class names and data attributes pass through", () => {
  const markup = html(<Spinner className="inline" data-surface="home" />);
  expect(markup).toContain('class="ov-spinner inline"');
  expect(markup).toContain('data-surface="home"');
});
