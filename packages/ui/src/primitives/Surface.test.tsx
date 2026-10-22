import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Surface } from "./Surface";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("Surface is a raised div by default with no padding hook", () => {
  const markup = html(<Surface>x</Surface>);
  expect(markup).toMatch(/^<div /);
  expect(markup).toContain('data-level="raised"');
  expect(markup).not.toContain("prim-pad");
});

test("Surface can be muted, padded with the panel padding, or padded by a scale step", () => {
  expect(html(<Surface level="muted">x</Surface>)).toContain('data-level="muted"');
  const panel = html(<Surface padded>x</Surface>);
  expect(panel).toContain('class="prim-surface prim-pad"');
  expect(panel).toContain('data-pad="panel"');
  expect(html(<Surface pad={3} padded>x</Surface>)).toContain('data-pad="3"');
  expect(html(<Surface pad={0}>x</Surface>)).toContain('data-pad="0"');
});

test("a labelled Surface can be a landmark and keeps data and aria props", () => {
  const markup = html(<Surface as="section" aria-labelledby="h" data-surface="settings" className="s">x</Surface>);
  expect(markup).toMatch(/^<section /);
  expect(markup).toContain('aria-labelledby="h"');
  expect(markup).toContain('data-surface="settings"');
  expect(markup).toContain('class="prim-surface s"');
});

test("an unknown level or element is a type error", () => {
  // @ts-expect-error not a level
  void (<Surface level="sunken" />);
  // @ts-expect-error not an allowed element
  void (<Surface as="main" />);
});

test("Surface can be a list item and set the shadow explicitly", () => {
  expect(html(<ul><Surface as="li">x</Surface></ul>)).toMatch(/^<ul><li class="prim-surface"/);
  expect(html(<Surface level="muted" shadow>x</Surface>)).toContain('data-shadow="true"');
  expect(html(<Surface shadow={false}>x</Surface>)).toContain('data-shadow="false"');
  expect(html(<Surface>x</Surface>)).not.toContain("data-shadow");
});
