import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Code } from "./Code";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("Code is an inline code element showing the whole identity", () => {
  const markup = html(<Code>0123456789abcdef0123456789abcdef01234567</Code>);
  expect(markup).toMatch(/^<code /);
  expect(markup).toContain("0123456789abcdef0123456789abcdef01234567</code>");
  expect(markup).toContain('data-size="mono"');
});

test("Code can follow the surrounding size and passes props through", () => {
  const markup = html(<Code size="inherit" className="c" data-capability="id.copy" title="commit">abc</Code>);
  expect(markup).toContain('data-size="inherit"');
  expect(markup).toContain('class="prim-code c"');
  expect(markup).toContain('data-capability="id.copy"');
  expect(markup).toContain('title="commit"');
});
