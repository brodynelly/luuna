import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Field } from "./Field";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("Field links the label, hint and error to the control through generated ids", () => {
  const markup = html(<Field label="Branch" hint="The branch to review" error="Name is required" required>{(control) => <input {...control} />}</Field>);
  const id = /<label for="([^"]+)">/.exec(markup)![1];
  expect(markup).toContain(`id="${id}"`);
  expect(markup).toContain(`aria-describedby="${id}-hint ${id}-error"`);
  expect(markup).toContain('aria-invalid="true"');
  expect(markup).toContain('aria-required="true"');
  expect(markup).toContain(`<small id="${id}-hint" class="field-hint">The branch to review</small>`);
  expect(markup).toContain(`id="${id}-error"`);
  expect(markup).toContain("(required)");
});

test("an error is text plus a danger shape mark, never role alert, and the live slot exists without one", () => {
  const withError = html(<Field label="Path" error="Use an absolute path">{(control) => <input {...control} />}</Field>);
  expect(withError).toContain('<span class="tone-mark" data-tone="danger" aria-hidden="true"></span>Use an absolute path');
  expect(withError).not.toContain('role="alert"');
  const without = html(<Field label="Path">{(control) => <input {...control} />}</Field>);
  expect(without).toContain('<span class="field-error-slot" aria-live="polite"></span>');
  expect(without).not.toContain("aria-describedby");
  expect(without).not.toContain("aria-invalid");
});

test("Field keeps an explicit id and passes className, data and aria attributes through", () => {
  const markup = html(<Field label="Name" id="name" className="mine" data-capability="a.b" aria-label="x">{(control) => <input {...control} />}</Field>);
  expect(markup).toContain('<div data-capability="a.b" aria-label="x" class="field mine">');
  expect(markup).toContain('<label for="name">');
  expect(markup).toContain('id="name"');
});
