import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScrollArea } from "./ScrollArea";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

// Overflow is measured after mount, so the first render of a region is a plain, unfocusable div; the measuring rule is in scroll.test.ts.
test("ScrollArea is not a tab stop or a named region until it overflows", () => {
  const markup = html(<ScrollArea label="Plan">rows</ScrollArea>);
  expect(markup).not.toContain("tabindex");
  expect(markup).not.toContain("role=");
  expect(markup).not.toContain("aria-label");
  expect(markup).not.toContain("data-scrolls");
});

test("ScrollArea carries its bound, axis and hook, and passes props through", () => {
  const markup = html(<ScrollArea label="Plan" maxHeight="plan" axis="both" className="p" data-capability="plan.scroll">rows</ScrollArea>);
  expect(markup).toContain('data-scroll-area=""');
  expect(markup).toContain('data-max="plan"');
  expect(markup).toContain('data-axis="both"');
  expect(markup).toContain('class="prim-scroll p"');
  expect(markup).toContain('data-capability="plan.scroll"');
  expect(html(<ScrollArea label="L">x</ScrollArea>)).toContain('data-max="scroll"');
});

test("a label is required and the bound is a token name", () => {
  // @ts-expect-error a scroll region needs a label
  void (<ScrollArea>x</ScrollArea>);
  // @ts-expect-error a free height is not a bound
  void (<ScrollArea label="x" maxHeight="400px" />);
});
