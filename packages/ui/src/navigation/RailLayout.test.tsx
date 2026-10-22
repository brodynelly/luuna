import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RailLayout } from "./RailLayout";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("with a rail: main first, a labelled aside second, data-rail set", () => {
  const markup = html(<RailLayout main={<p>m</p>} rail={<p>r</p>} railLabel="Run details" />);
  expect(markup).toBe('<div class="rail-layout" data-rail=""><div class="rail-main"><p>m</p></div><aside class="rail-aside" aria-label="Run details"><p>r</p></aside></div>');
});

test("without a rail there is no aside and no data-rail; props pass through", () => {
  const markup = html(<RailLayout main="m" className="x" data-surface="s" />);
  expect(markup).not.toContain("aside");
  expect(markup).not.toContain("data-rail");
  expect(markup).toContain('class="rail-layout x"');
  expect(markup).toContain('data-surface="s"');
});

test("the default rail label is not empty", () => {
  expect(html(<RailLayout main="m" rail="r" />)).toContain('aria-label="Details"');
});
