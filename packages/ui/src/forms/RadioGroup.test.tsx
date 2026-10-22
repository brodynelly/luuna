import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RadioGroup } from "./RadioGroup";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;
const options = [{ value: "a", label: "Alpha", hint: "First" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma", disabled: true }];

test("RadioGroup is a fieldset named by its legend with one native radio per option sharing a name", () => {
  const markup = html(<RadioGroup legend="Mode" name="mode" value="b" onChange={noop} options={options} />);
  expect(markup).toMatch(/^<fieldset class="radio-group"[^>]*><legend>Mode<\/legend>/);
  expect(markup.match(/type="radio"/g)).toHaveLength(3);
  expect(markup.match(/checked=""/g)).toHaveLength(1);
  expect(markup).toMatch(/name="mode" checked="" value="b"/);
  expect(markup).toContain("disabled");
});

test("an option hint is linked to its radio and the group hint and error to the fieldset", () => {
  const markup = html(<RadioGroup legend="Mode" name="mode" value="a" onChange={noop} options={options} hint="Pick one" error="Choose a mode" />);
  const hintId = /<small id="([^"]+)">First<\/small>/.exec(markup)![1];
  expect(markup).toContain(`aria-describedby="${hintId}"`);
  expect(markup).toMatch(/<fieldset[^>]* aria-describedby="[^"]+-hint [^"]+-error"/);
  expect(markup.match(/aria-invalid="true"/g)).toHaveLength(3);
  expect(markup).toContain('data-tone="danger"');
});

test("RadioGroup forwards className and data attributes to the fieldset", () => {
  const markup = html(<RadioGroup legend="Mode" name="mode" value="" onChange={noop} options={options} className="mine" data-capability="x.y" />);
  expect(markup).toContain('class="radio-group mine"');
  expect(markup).toContain('data-capability="x.y"');
  expect(markup).not.toContain("checked");
});
