import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveOutput, ScrollList } from "./index";

test("LiveOutput is a labelled, focusable region whose text is exactly the output", () => {
  const html = renderToStaticMarkup(<LiveOutput label="Pi response" live followKey={5}>hello</LiveOutput>);
  expect(html).toBe('<pre aria-label="Pi response" tabindex="0" data-live="true">hello</pre>');
  expect(html).not.toContain("aria-live");
});

test("LiveOutput drops the live marker once the run is terminal", () => {
  const html = renderToStaticMarkup(<LiveOutput label="Pi response" live={false} followKey={5}>done</LiveOutput>);
  expect(html).not.toContain("data-live");
});

test("ScrollList without follow renders the same markup as before", () => {
  const html = renderToStaticMarkup(<ScrollList label="X" data-capability="runs.events">{null}</ScrollList>);
  expect(html).toBe('<ol class="events" aria-label="X" tabindex="0" data-capability="runs.events"></ol>');
});

test("the tail caret is CSS only, through ::after with empty content", () => {
  const css = readFileSync(new URL("../design/components.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter((line) => line.includes("pre[data-live]"));
  expect(rules.length).toBeGreaterThan(0);
  for (const rule of rules) expect(rule).toContain("::after");
  expect(css).toMatch(/pre\[data-live\]::after \{ content: "";/);
});
