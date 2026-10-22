import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FormSection, InlineFields } from "./FormSection";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("FormSection is a fieldset with a legend and a described one-sentence description", () => {
  const markup = html(<FormSection title="Retention" description="How long records stay."><p>body</p></FormSection>);
  const id = /<small id="([^"]+)" class="form-section-description">How long records stay\.<\/small>/.exec(markup)![1];
  expect(markup).toContain(`aria-describedby="${id}"`);
  expect(markup).toContain("<legend>Retention</legend>");
  expect(markup.startsWith('<fieldset class="form-section"')).toBe(true);
});

test("FormSection without a description has no describedby and forwards className, disabled and data attributes", () => {
  const markup = html(<FormSection title="Limits" className="mine" disabled data-surface="settings">x</FormSection>);
  expect(markup).not.toContain("aria-describedby");
  expect(markup).toContain('class="form-section mine"');
  expect(markup).toContain("disabled");
  expect(markup).toContain('data-surface="settings"');
});

test("InlineFields defaults to two columns, supports 3 and 4, and is a group only when labelled", () => {
  expect(html(<InlineFields>x</InlineFields>)).toBe('<div class="inline-fields" data-columns="2">x</div>');
  expect(html(<InlineFields columns={4} label="Plan controls" className="mine">x</InlineFields>)).toBe('<div role="group" aria-label="Plan controls" class="inline-fields mine" data-columns="4">x</div>');
  expect(html(<InlineFields columns={3}>x</InlineFields>)).toContain('data-columns="3"');
});

test("InlineFields stack marks a single column and leaves the default alone", () => {
  expect(renderToStaticMarkup(<InlineFields stack columns={3}>x</InlineFields>)).toContain('data-columns="3" data-stack=""');
  expect(renderToStaticMarkup(<InlineFields>x</InlineFields>)).not.toContain("data-stack");
});
