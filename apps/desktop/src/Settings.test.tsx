import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DoctorReport } from "@luuna/api-client";
import { DoctorReportView, Settings, doctorTone, readDoctor } from "./Settings";

/** A report as the runtime serves it: presence by name, never a value. */
const report: DoctorReport = { ok: false, items: [
  { name: "git", required: true, status: "ok", detail: "git version 2.55.0" },
  { name: "python", required: false, status: "warning", detail: "python3 not found on PATH" },
  { name: "pi", required: true, status: "missing", detail: "unsupported Pi version; expected 1.3.0" },
  { name: "api_token", required: false, status: "ok", detail: "LUUNA_API_TOKEN is configured (value not shown)" },
  { name: "provider_credentials", required: false, status: "ok", detail: "configured: OPENROUTER_API_KEY (values not shown); set but empty: ANTHROPIC_API_KEY (an empty variable configures nothing)" },
  { name: "port", required: false, status: "ok", detail: "this runtime is the one listening on http://127.0.0.1:4242" },
] };

test("the Settings panel renders every doctor item with the state tones, the required marker and the verdict", () => {
  const html = renderToStaticMarkup(<DoctorReportView report={report} />);
  expect(html).toContain('aria-label="Runtime environment and credential presence"');
  expect(html).toMatch(/<span class="state" data-tone="success">ok<\/span><code>git<\/code><span class="tag">required<\/span>/);
  expect(html).toMatch(/<span class="state" data-tone="attention">warning<\/span><code>python<\/code><span class="settings-detail">/);
  expect(html).toMatch(/<span class="state" data-tone="danger">missing<\/span><code>pi<\/code><span class="tag">required<\/span>/);
  expect(doctorTone).toEqual({ ok: "success", warning: "attention", missing: "danger" });
  expect(html).toContain('data-tone="danger" role="status">doctor: FAILED.');
  expect(renderToStaticMarkup(<DoctorReportView report={{ ok: true, items: report.items.filter((item) => item.status !== "missing") }} />)).toContain('data-tone="success" role="status">doctor: ok.');
  // The text is the runtime's: the status word and the detail line, unchanged.
  for (const item of report.items) expect(html).toContain(item.detail);
});

test("Refresh reads the doctor route once with the abort signal and nothing else", async () => {
  const client = { doctor: vi.fn(async () => report) };
  const signal = new AbortController().signal;
  expect(await readDoctor(client, signal)).toEqual(report);
  expect(client.doctor).toHaveBeenCalledTimes(1);
  expect(client.doctor).toHaveBeenCalledWith(signal);
  const source = renderToStaticMarkup(<Settings client={null} />);
  expect(source).toContain('data-surface="settings"');
  expect(source).toMatch(/<button type="button" class="text-button" disabled="" data-capability="doctor">Refresh<\/button>/);
  expect(source).toContain("Connect to the runtime to see its environment");
});

test("the panel says that values are never shown and that credentials are configured in the runtime's environment, and renders nothing but the report", () => {
  const panel = renderToStaticMarkup(<Settings client={null} />);
  expect(panel).toContain("never its value.");
  expect(panel).toContain("are configured in the runtime&#x27;s environment, not here");
  expect(panel).toContain("<code>LUUNA_API_TOKEN</code>");
  // The view shows the runtime's names, statuses and details and nothing else: no input, no
  // form, nothing editable, and no text that is not in the report.
  const view = renderToStaticMarkup(<DoctorReportView report={report} />);
  expect(view).not.toMatch(/<(input|textarea|form)\b/);
  const text = view.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
  const known = new Set([...report.items.flatMap((item) => [item.status, item.name, item.detail, "required"]), "doctor: FAILED. A required item is missing or the database is unusable; the items above say which."]);
  let rest = text;
  for (const part of [...known].sort((a, b) => b.length - a.length)) rest = rest.split(part).join(" ");
  expect(rest.trim()).toBe("");
});
