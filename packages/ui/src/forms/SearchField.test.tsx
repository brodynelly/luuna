import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchField } from "./SearchField";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;

test("SearchField is a labelled native search input with a name and no spell checking", () => {
  const markup = html(<SearchField label="Search memory" value="" onChange={noop} />);
  expect(markup).toContain("<label for=");
  expect(markup).toContain('type="search"');
  expect(markup).toContain('name="search-memory"');
  expect(markup).toContain('autoComplete="off"');
  expect(markup).toContain('spellCheck="false"');
});

test("the clear button appears only with a query and is named by clearLabel", () => {
  expect(html(<SearchField label="Find" value="" onChange={noop} />)).not.toContain("search-clear");
  const filled = html(<SearchField label="Find" value="abc" onChange={noop} clearLabel="Clear the query" />);
  expect(filled).toContain('<button type="button" class="quiet search-clear" aria-label="Clear the query">');
  expect(filled).toContain('value="abc"');
  expect(html(<SearchField label="Find" value="abc" onChange={noop} />)).toContain('aria-label="Clear search"');
});

test("SearchField wires hint and error and passes data attributes to the input", () => {
  const markup = html(<SearchField label="Find" value="" onChange={noop} hint="Press Enter" error="Too short" data-capability="atlas.search" />);
  expect(markup).toContain('data-capability="atlas.search"');
  expect(markup).toMatch(/aria-describedby="[^"]+-hint [^"]+-error"/);
  expect(markup).toContain('aria-invalid="true"');
});

test("clearable false renders no clear button and the default still does", () => {
  expect(html(<SearchField label="Find" value="abc" onChange={noop} clearable={false} />)).not.toContain("search-clear");
  expect(html(<SearchField label="Find" value="abc" onChange={noop} clearable />)).toContain("search-clear");
});
