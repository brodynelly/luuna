import { describe, expect, it, vi } from "vitest";
import { ApiError, LuunaClient, assistantText, isTerminal, loopbackUrl, mergeEvents } from "../src/index";
import type { EventEnvelope } from "../src/index";

describe("local runtime connection", () => {
  it("accepts loopback origins and rejects remote, credential, path and query URLs", () => {
    expect(loopbackUrl("http://127.0.0.1:4242/")).toBe("http://127.0.0.1:4242");
    expect(loopbackUrl("http://[::1]:4242")).toBe("http://[::1]:4242");
    for (const url of ["https://example.com", "http://127.0.0.1.example.com", "http://127.0.0.1@evil.test", "http://user:pass@localhost", "http://localhost/runs", "http://localhost?token=secret"]) {
      expect(() => loopbackUrl(url)).toThrow();
    }
  });

  it("authenticates replay with a cursor and refuses redirect-based token forwarding", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]"));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    await client.events("run/1", 19);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4242/api/v1/runs/run%2F1/events?after=19");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
  });

  it("uses the browser global receiver for native fetch", async () => {
    const fetcher = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response("[]"));
    });
    await new LuunaClient("http://localhost:4242", "test-token", fetcher).listRuns();
  });

  it("returns useful auth failures without exposing response body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive server output", { status: 401 }));
    const client = new LuunaClient("http://localhost:4242", "test-token", fetcher);
    await expect(client.listRuns()).rejects.toMatchObject({ status: 401, name: "ApiError" });
    await expect(client.listRuns()).rejects.not.toThrow("sensitive");
  });

  it("passes cancellation through the service and aborts on disconnect", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"r","state":"cancelled"}'));
    const signal = new AbortController().signal;
    const result = await new LuunaClient("http://localhost:4242", "test-token", fetcher).cancelRun("r", signal);
    expect(result.state).toBe("cancelled");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", signal });
  });
});

describe("durable event replay", () => {
  it("deduplicates reconnect overlap and restores sequence order", () => {
    const event = (sequence: number) => ({ sequence, event_id: `e${sequence}`, run_id: "run" });
    expect(mergeEvents([event(1), event(2)], [event(3), event(2)]).map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it("rejects malformed cursors instead of losing subsequent events", () => {
    expect(() => mergeEvents([], [{ sequence: Number.NaN, event_id: "a", run_id: "r" }])).toThrow("invalid event sequence");
    expect(() => mergeEvents([], [{ sequence: 0, event_id: "a", run_id: "r" }])).toThrow();
  });

  it("rejects gaps, cross-run records, and conflicting replay identities", () => {
    const first = { sequence: 1, event_id: "a", run_id: "r" };
    expect(() => mergeEvents([first], [{ sequence: 3, event_id: "c", run_id: "r" }])).toThrow("gap");
    expect(() => mergeEvents([first], [{ sequence: 2, event_id: "b", run_id: "another" }])).toThrow("different run");
    expect(() => mergeEvents([first], [{ sequence: 1, event_id: "replaced", run_id: "r" }])).toThrow("conflicting");
    expect(() => mergeEvents([first], [{ sequence: 2, event_id: "a", run_id: "r" }])).toThrow("conflicting");
  });

  it("recognizes persisted terminal states", () => {
    for (const state of ["completed", "failed", "cancelled", "interrupted"] as const) expect(isTerminal(state)).toBe(true);
    expect(isTerminal("running")).toBe(false);
    expect(new ApiError(500, "failed").status).toBe(500);
  });

  it("shows Pi text deltas and replaces them with the complete recorded message", () => {
    const base = { schema_version: "0.1", project_id: "demo", run_id: "r", timestamp: "2026-10-16T00:00:00Z" };
    const events: EventEnvelope[] = [
      { ...base, event_id: "a", sequence: 1, type: "pi.message_update", payload: { assistantMessageEvent: { type: "text_delta", delta: "Hello " } } },
      { ...base, event_id: "b", sequence: 2, type: "pi.message_update", payload: { assistantMessageEvent: { type: "text_delta", delta: "world." } } },
    ];
    expect(assistantText(events)).toBe("Hello world.");
    events.push({ ...base, event_id: "c", sequence: 3, type: "pi.message_end", payload: { message: { role: "assistant", content: [{ type: "text", text: "Hello world." }] } } });
    expect(assistantText(events)).toBe("Hello world.");
    expect(isTerminal("running")).toBe(false);
  });
});
