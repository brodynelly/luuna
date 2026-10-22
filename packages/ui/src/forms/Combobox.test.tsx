import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Combobox } from "./Combobox";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;
const options = [{ value: "main", label: "main" }, { value: "dev", label: "develop", hint: "default" }, { value: "rel", label: "release" }];

test("Combobox follows the ARIA 1.2 pattern: a combobox input controlling a labelled listbox, closed at rest", () => {
  const markup = html(<Combobox label="Branch" options={options} value="" onChange={noop} />);
  const listId = /aria-controls="([^"]+)"/.exec(markup)![1];
  expect(markup).toContain('role="combobox"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-autocomplete="list"');
  expect(markup).not.toContain("aria-activedescendant");
  expect(markup).toContain(`<ul id="${listId}" role="listbox" class="combobox-list" aria-label="Branch" hidden="">`);
  expect(markup).not.toContain('role="option"');
});

test("the input shows the selected option's label, not its value", () => {
  const markup = html(<Combobox label="Branch" options={options} value="dev" onChange={noop} />);
  expect(markup).toContain('value="develop"');
  expect(markup).toContain('name="branch"');
  expect(markup).toContain('<span class="visually-hidden" role="status"></span>');
});

test("Combobox wires its hint, error and required state like every field and forwards data attributes", () => {
  const markup = html(<Combobox label="Branch" options={options} value="" onChange={noop} hint="Pick a branch" error="No branch chosen" required data-capability="project.branch" />);
  expect(markup).toContain('aria-invalid="true"');
  expect(markup).toContain('aria-required="true"');
  expect(markup).toMatch(/aria-describedby="[^"]+-hint [^"]+-error"/);
  expect(markup).toContain('data-capability="project.branch"');
});
