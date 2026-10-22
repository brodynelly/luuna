import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NumberField } from "./NumberField";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;

test("NumberField is a native number input with bounds, step, value text and a name", () => {
  const markup = html(<NumberField label="Retention days" value="30" onChange={noop} min={1} max={365} step={1} />);
  expect(markup).toContain('type="number"');
  expect(markup).toContain('min="1"');
  expect(markup).toContain('max="365"');
  expect(markup).toContain('step="1"');
  expect(markup).toContain('value="30"');
  expect(markup).toContain('name="retention-days"');
  expect(markup).toContain('inputMode="decimal"');
});

test("NumberField draws no custom spinner and wires hint, error and required", () => {
  const markup = html(<NumberField label="Count" value="" onChange={noop} hint="Whole days" error="Out of range" required />);
  expect(markup).not.toContain("<button");
  expect(markup).toContain('aria-invalid="true"');
  expect(markup).toContain('aria-required="true"');
  expect(markup).toMatch(/aria-describedby="[^"]+-hint [^"]+-error"/);
});
