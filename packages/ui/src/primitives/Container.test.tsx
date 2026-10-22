import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Container } from "./Container";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("Container defaults to the content width and names the other two", () => {
  expect(html(<Container>x</Container>)).toContain('data-size="content"');
  expect(html(<Container size="measure">x</Container>)).toContain('data-size="measure"');
  expect(html(<Container size="narrow">x</Container>)).toContain('data-size="narrow"');
});

test("Container adds the gutter on request, changes tag, and passes props through", () => {
  const markup = html(<Container gutter as="article" className="c" aria-label="Read">x</Container>);
  expect(markup).toMatch(/^<article /);
  expect(markup).toContain('data-gutter=""');
  expect(markup).toContain('class="prim-container c"');
  expect(markup).toContain('aria-label="Read"');
  expect(html(<Container>x</Container>)).not.toContain("data-gutter");
});

test("a free width is a type error", () => {
  // @ts-expect-error not a named size
  void (<Container size="900px" />);
});
