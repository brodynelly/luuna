import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentedControl } from "./SegmentedControl";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const options = [{ value: "list", label: "List" }, { value: "board", label: "Board" }, { value: "graph", label: "Graph", disabled: true }];

test("is a labelled radiogroup of native radios sharing one name, one checked", () => {
  const markup = html(<SegmentedControl aria-label="View" name="view" options={options} value="board" onChange={() => undefined} />);
  expect(markup).toContain('role="radiogroup"');
  expect(markup).toContain('aria-label="View"');
  expect(markup.match(/<input type="radio"/g)).toHaveLength(3);
  expect(markup.match(/name="view"/g)).toHaveLength(3);
  expect(markup.match(/checked=""/g)).toHaveLength(1);
  expect(markup).toMatch(/checked="" value="board"/);
  expect(markup).toMatch(/disabled="" name="view" value="graph"/);
  expect(markup).not.toContain("tabindex");
});

test("each radio sits inside its label with visible text; a generated name is shared", () => {
  const markup = html(<SegmentedControl aria-label="Mode" options={options} value="list" onChange={() => undefined} className="x" data-capability="mode" />);
  expect(markup.match(/<label class="segmented-option">/g)).toHaveLength(3);
  expect(markup).toContain("<span>List</span>");
  const names = new Set([...markup.matchAll(/name="([^"]+)"/g)].map((match) => match[1]));
  expect(names.size).toBe(1);
  expect(markup).toContain('class="segmented x"');
  expect(markup).toContain('data-capability="mode"');
});
