import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyButton } from "./CopyButton";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("CopyButton renders a button and an always-present, empty status region at rest", () => {
  const markup = html(<CopyButton value="abc123" label="Copy commit" copy={() => undefined} />);
  expect(markup).toBe('<span class="copy-button"><button type="button">Copy commit</button><span class="copy-status" role="status"></span></span>');
});

test("the value is never written to the markup", () => {
  const markup = html(<CopyButton value="s3cr3t-value" label="Copy" copy={() => undefined} />);
  expect(markup).not.toContain("s3cr3t-value");
});

test("CopyButton forwards variant, capability and className and keeps the copy function out of the DOM", () => {
  const markup = html(<CopyButton value="x" label="Copy" copy={() => undefined} variant="quiet" data-capability="evidence.copy" className="mine" />);
  expect(markup).toContain('<span class="copy-button mine">');
  expect(markup).toContain('class="quiet"');
  expect(markup).toContain('data-capability="evidence.copy"');
  expect(markup).not.toContain("copy=");
});
