import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Divider } from "./Divider";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("a plain Divider is a horizontal hr", () => {
  const markup = html(<Divider className="d" />);
  expect(markup).toMatch(/^<hr /);
  expect(markup).toContain('data-orientation="horizontal"');
  expect(markup).not.toContain("aria-orientation");
});

test("a vertical Divider says so to assistive technology", () => {
  const markup = html(<Divider orientation="vertical" />);
  expect(markup).toContain('aria-orientation="vertical"');
  expect(markup).toContain('data-orientation="vertical"');
});

test("a labelled Divider is a separator named by its text", () => {
  const markup = html(<Divider label="Or continue with" />);
  expect(markup).toMatch(/^<div role="separator" aria-label="Or continue with"/);
  expect(markup).toContain("<span>Or continue with</span>");
  expect(markup).toContain('data-labelled=""');
});

test("a decorative Divider has no separator semantics, and rest props pass through", () => {
  expect(html(<Divider decorative />)).toContain('role="presentation"');
  expect(html(<Divider decorative orientation="vertical" />)).not.toContain("aria-orientation");
  expect(html(<Divider label="x" decorative />)).not.toContain("aria-label");
  expect(html(<Divider data-capability="a.b" />)).toContain('data-capability="a.b"');
});

test("a vertical Divider cannot be labelled", () => {
  // @ts-expect-error a vertical rule has no label
  void (<Divider orientation="vertical" label="x" />);
});
