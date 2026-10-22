import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Grid, SimpleGrid } from "./Grid";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("Grid with a count holds it at every width", () => {
  const markup = html(<Grid cols={3} gap={4} className="g" data-capability="x.y">a</Grid>);
  expect(markup).toContain('class="prim-grid prim-gap g"');
  expect(markup).toContain('data-cols="3"');
  expect(markup).toContain('data-gap="4"');
  expect(markup).toContain('data-capability="x.y"');
  expect(markup).not.toContain("data-cols-");
});

test("Grid names its columns at the compact and narrow breakpoints", () => {
  const markup = html(<Grid cols={{ base: 4, compact: 2, narrow: 1 }}>a</Grid>);
  expect(markup).toContain('data-cols="4"');
  expect(markup).toContain('data-cols-compact="2"');
  expect(markup).toContain('data-cols-narrow="1"');
});

test("SimpleGrid defaults to the field column and accepts the hint column", () => {
  expect(html(<SimpleGrid>a</SimpleGrid>)).toContain('data-min="field"');
  const markup = html(<SimpleGrid minItem="hint" gap={2}>a</SimpleGrid>);
  expect(markup).toContain('data-min="hint"');
  expect(markup).toContain('data-gap="2"');
});

test("free numbers and unknown breakpoints are type errors", () => {
  // @ts-expect-error seven columns is not supported
  void (<Grid cols={7} />);
  // @ts-expect-error there is no wide breakpoint
  void (<Grid cols={{ base: 2, wide: 3 }} />);
  // @ts-expect-error a literal length is not a minimum item
  void (<SimpleGrid minItem="12rem" />);
});
