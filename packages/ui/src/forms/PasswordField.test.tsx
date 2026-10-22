import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordField } from "./PasswordField";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;

test("PasswordField is masked by default and the toggle starts unpressed", () => {
  const markup = html(<PasswordField label="Token" value="" onChange={noop} />);
  expect(markup).toContain('type="password"');
  expect(markup).toContain('aria-pressed="false"');
  expect(markup).toContain(">Show value</button>");
  expect(markup).toContain('autoComplete="off"');
  expect(markup).toContain('name="token"');
});

test("the secret is never written to markup: no value attribute and no copy of the text", () => {
  const secret = "s3cr3t-token-9f2";
  const markup = html(<PasswordField label="Token" value={secret} onChange={noop} hint="Stored in the keychain" />);
  expect(markup).not.toContain(secret);
  expect(markup).not.toMatch(/\svalue=/);
  expect(markup).not.toMatch(/defaultvalue/i);
});

test("revealable can be turned off and the label is configurable", () => {
  expect(html(<PasswordField label="Token" value="" onChange={noop} revealable={false} />)).not.toContain("<button");
  expect(html(<PasswordField label="Token" value="" onChange={noop} revealLabel="Reveal" />)).toContain(">Reveal</button>");
});

test("PasswordField wires its error and required state to the control", () => {
  const markup = html(<PasswordField label="Token" value="" onChange={noop} error="Token rejected" required data-capability="conn.token" />);
  expect(markup).toContain('aria-invalid="true"');
  expect(markup).toContain('aria-required="true"');
  expect(markup).toContain('data-capability="conn.token"');
  expect(markup).toContain("Token rejected");
});
