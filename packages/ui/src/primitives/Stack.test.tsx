import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Center, Inline, Spacer, Stack } from "./Stack";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("Stack is a div with a token gap and passes class, data and aria through", () => {
  const markup = html(<Stack gap={3} align="start" justify="center" className="x" data-capability="a.b" aria-label="Fields">child</Stack>);
  expect(markup).toMatch(/^<div /);
  expect(markup).toContain('class="prim-stack prim-gap x"');
  expect(markup).toContain('data-gap="3"');
  expect(markup).toContain('data-align="start"');
  expect(markup).toContain('data-justify="center"');
  expect(markup).toContain('data-capability="a.b"');
  expect(markup).toContain('aria-label="Fields"');
});

test("Stack without a gap carries no gap hook, and half steps are written as strings", () => {
  expect(html(<Stack>x</Stack>)).not.toContain("prim-gap");
  expect(html(<Stack gap="1.5">x</Stack>)).toContain('data-gap="1.5"');
});

test("a Stack rendered as a list keeps the list role and holds items", () => {
  const markup = html(<Stack as="ul" gap={2}><li>one</li><li>two</li></Stack>);
  expect(markup).toMatch(/^<ul role="list"/);
  expect(html(<Stack as="ol">x</Stack>)).toMatch(/^<ol role="list"/);
  expect(html(<Stack as="section" aria-label="Group">x</Stack>)).toMatch(/^<section /);
  expect(html(<Stack>x</Stack>)).not.toContain("role=");
});

test("an unsupported gap, tag or alignment is a type error", () => {
  // @ts-expect-error not on the scale
  void (<Stack gap={7} />);
  // @ts-expect-error not an allowed element
  void (<Stack as="table" />);
  // @ts-expect-error not an alignment
  void (<Stack align="baseline" />);
});

test("Center centres, can be inline or reserve the empty-state height", () => {
  expect(html(<Center>x</Center>)).toContain('class="prim-center"');
  const markup = html(<Center inline fill as="section" aria-label="Empty">x</Center>);
  expect(markup).toMatch(/^<section /);
  expect(markup).toContain('data-inline=""');
  expect(markup).toContain('data-fill=""');
  expect(html(<Center>x</Center>)).not.toContain("data-inline");
});

test("Spacer is hidden from assistive technology, flexible by default and fixed when sized", () => {
  const flexible = html(<Spacer />);
  expect(flexible).toContain('aria-hidden="true"');
  expect(flexible).not.toContain("data-size");
  expect(html(<Spacer size={4} className="y" />)).toContain('class="prim-spacer y" data-size="4"');
});

test("Inline is a row with a token gap, wrap, align and justify, and passes class, data and aria through", () => {
  const markup = html(<Inline gap={2} wrap align="baseline" justify="between" className="x" data-capability="a.b" aria-label="Actions">child</Inline>);
  expect(markup).toMatch(/^<div /);
  expect(markup).toContain('class="prim-inline prim-gap x"');
  for (const part of ['data-gap="2"', 'data-align="baseline"', 'data-justify="between"', 'data-wrap=""', 'data-capability="a.b"', 'aria-label="Actions"']) expect(markup).toContain(part);
  expect(html(<Inline>x</Inline>)).not.toMatch(/prim-gap|data-wrap/);
  expect(html(<Inline as="ul"><li>x</li></Inline>)).toMatch(/^<ul role="list"/);
  expect(html(<Inline as="span">x</Inline>)).toMatch(/^<span /);
});

test("an unsupported Inline gap or tag is a type error", () => {
  // @ts-expect-error not on the scale
  void (<Inline gap={7} />);
  // @ts-expect-error not an allowed element
  void (<Inline as="table" />);
});
