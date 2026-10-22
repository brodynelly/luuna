import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TONES } from "../tone/tone";
import { Alert } from "./Alert";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;

test("danger is role=alert and always carries a Dismiss button", () => {
  const markup = html(<Alert tone="danger" title="Run failed" onDismiss={noop}>The check exited with code 2.</Alert>);
  expect(markup).toContain('role="alert"');
  expect(markup).toContain('data-tone="danger"');
  expect(markup).toContain(">Dismiss</button>");
  expect(markup).toContain("Run failed");
  expect(markup).toContain("The check exited with code 2.");
});

test("every other tone is role=status, without a Dismiss unless asked", () => {
  for (const tone of TONES.filter((name) => name !== "danger")) {
    const markup = html(<Alert tone={tone}>Message</Alert>);
    expect(markup, tone).toContain('role="status"');
    expect(markup, tone).not.toContain('role="alert"');
    expect(markup, tone).not.toContain("Dismiss");
  }
  expect(html(<Alert tone="attention" onDismiss={noop}>Waiting on you</Alert>)).toContain(">Dismiss</button>");
});

test("every tone carries three channels: the tone ground, a shape mark and the text", () => {
  for (const tone of TONES) {
    const markup = tone === "danger" ? html(<Alert tone="danger" onDismiss={noop}>Words</Alert>) : html(<Alert tone={tone}>Words</Alert>);
    expect(markup, tone).toContain(`data-tone="${tone}"`);
    expect(markup, tone).toContain(`<span class="tone-mark" data-tone="${tone}" aria-hidden="true"></span>`);
    expect(markup, tone).toContain("Words");
  }
});

test("the default tone is neutral and a title is optional", () => {
  const markup = html(<Alert>Saved the note</Alert>);
  expect(markup).toContain('data-tone="neutral"');
  expect(markup).not.toContain("ov-alert-title");
});

test("class names, data attributes and aria props pass through", () => {
  const markup = html(<Alert tone="active" className="wide" data-surface="home" aria-label="Sync">Syncing</Alert>);
  expect(markup).toContain('class="ov-alert wide"');
  expect(markup).toContain('data-surface="home"');
  expect(markup).toContain('aria-label="Sync"');
});

test("announce=status makes any tone a status region with no Dismiss unless asked", () => {
  for (const tone of TONES) {
    const markup = html(<Alert tone={tone} announce="status">Blocked</Alert>);
    expect(markup, tone).toContain('role="status"');
    expect(markup, tone).not.toContain('role="alert"');
    expect(markup, tone).not.toContain("Dismiss");
  }
  expect(html(<Alert tone="danger" announce="status" onDismiss={noop}>x</Alert>)).toContain(">Dismiss</button>");
});

test("announce=alert on a non-danger tone is role=alert with Dismiss, and the types hold the rule", () => {
  const markup = html(<Alert tone="attention" announce="alert" onDismiss={noop}>x</Alert>);
  expect(markup).toContain('role="alert"');
  expect(markup).toContain(">Dismiss</button>");
  // @ts-expect-error a danger alert with role=alert needs onDismiss
  void (<Alert tone="danger">x</Alert>);
  // @ts-expect-error an alert on any tone needs onDismiss
  void (<Alert tone="attention" announce="alert">x</Alert>);
});
