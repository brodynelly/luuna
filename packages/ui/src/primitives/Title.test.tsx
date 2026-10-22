import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Title } from "./Title";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("Title emits h2, h3 and h4 by order", () => {
  expect(html(<Title order={2}>View</Title>)).toMatch(/^<h2 .*>View<\/h2>$/);
  expect(html(<Title order={3}>Section</Title>)).toMatch(/^<h3 /);
  expect(html(<Title order={4}>Part</Title>)).toMatch(/^<h4 /);
});

test("Title takes a visual size apart from its level, and passes id and class through", () => {
  const markup = html(<Title order={3} size="page" id="t" className="x">Big</Title>);
  expect(markup).toContain('data-size="page"');
  expect(markup).toContain('id="t"');
  expect(markup).toContain('class="prim-title x"');
  expect(html(<Title order={3}>Plain</Title>)).not.toContain("data-size");
});

test("h1 and free sizes are type errors", () => {
  // @ts-expect-error the page has no h1 (the shell owns it)
  void (<Title order={1} />);
  // @ts-expect-error not a named size
  void (<Title order={2} size="30px" />);
});
