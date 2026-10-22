import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EventEnvelope, LuunaClient, RunRecord } from "@luuna/api-client";
import { EventPanel } from "./SessionParts";

const run = (state: RunRecord["state"]): RunRecord => ({ id: "run-1", project_id: "p", state, revision: 2, metadata: { prompt: "hi" }, created_at: "", updated_at: "" });
const events: EventEnvelope[] = [{ run_id: "run-1", sequence: 1, type: "run.started", timestamp: "2026-10-22T00:00:00Z", payload: {} } as EventEnvelope];
const render = (state: RunRecord["state"]) => renderToStaticMarkup(<EventPanel client={{} as LuunaClient} active={run(state)} events={events} output="Hello" live="" candidateActive={false} busy={false} onCancel={() => {}} />);

test("a running session shows an aria-hidden streaming indicator outside the response, with the response region untouched", () => {
  const html = render("running");
  expect(html).toMatch(/<span class="streaming-dots" aria-hidden="true">/);
  expect(html.indexOf("streaming-dots")).toBeLessThan(html.indexOf('aria-label="Pi response"'));
  expect(html).toMatch(/<pre[^>]*data-live="true"[^>]*aria-label="Pi response"|<pre[^>]*aria-label="Pi response"[^>]*data-live="true"/);
  expect(html).toContain('aria-label="Durable session events"');
  const before = html.slice(html.indexOf("assistant-output"), html.indexOf("<pre"));
  for (const motion of ["reveal", "glow-surface", "aurora", "streaming-dots", "style="]) expect(before).not.toContain(motion);
});

test("a terminal session shows no streaming indicator and no live caret", () => {
  const html = render("completed");
  expect(html).not.toContain("streaming-dots");
  expect(html).not.toContain("data-live");
});
