import { describe, expect, it, vi } from "vitest";
import { ApiError, LuunaClient, assistantText, checkResults, confirmedManifest, isTerminal, loopbackUrl, mergeEvents } from "../src/index";
import type { EventEnvelope, ProjectManifest } from "../src/index";

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

describe("project import and discovery", () => {
  const base = { schema_version: "0.1", project_id: "fixture", run_id: "project:fixture", timestamp: "2026-10-17T00:00:00Z" };

  it("registers by absolute path, discovers with POST and confirms with a revision guard", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    await client.registerProject({ id: "fixture", name: "Fixture", repositories: [{ id: "app", path: "/srv/app" }] });
    await client.discover("fixture");
    const manifest: ProjectManifest = { schema_version: "0.1", id: "fixture", name: "Fixture", revision: 1, repositories: [], relationships: [], policy: { approval: "plan", testing_prerequisite: true, publish: "automatic_pr", merge: "human", max_explorers: 1, max_implementers: 1, max_task_repairs: 2 } };
    await client.confirmManifest("fixture", 0, manifest);
    await client.projectEvents("fixture", 2);
    const calls = fetcher.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET", init?.body]);
    expect(calls[0]).toEqual(["http://127.0.0.1:4242/api/v1/projects", "POST", JSON.stringify({ id: "fixture", name: "Fixture", repositories: [{ id: "app", path: "/srv/app" }] })]);
    expect(calls[1]).toEqual(["http://127.0.0.1:4242/api/v1/projects/fixture/discover", "POST", undefined]);
    expect(calls[2]).toEqual(["http://127.0.0.1:4242/api/v1/projects/fixture/manifest", "PUT", JSON.stringify({ expected_revision: 0, manifest })]);
    expect(calls[3]).toEqual(["http://127.0.0.1:4242/api/v1/projects/fixture/events?after=2", "GET", undefined]);
    expect(() => client.confirmManifest("fixture", -1, manifest)).toThrow("Invalid manifest revision");
  });

  it("surfaces short deterministic runtime reasons for conflicts and validation failures only", async () => {
    const respond = (status: number, body: string) => vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status, headers: { "Content-Type": "application/json" } }));
    const conflict = new LuunaClient("http://localhost:4242", "t", respond(409, '{"error":"revision conflict: expected 1, current 0"}'));
    await expect(conflict.discover("fixture")).rejects.toThrow("revision conflict: expected 1, current 0");
    const invalid = new LuunaClient("http://localhost:4242", "t", respond(422, '{"error":"default branch release is not a local or origin branch of repository app"}'));
    await expect(invalid.discover("fixture")).rejects.toThrow("default branch release");
    const invalidPath = new LuunaClient("http://localhost:4242", "t", respond(400, '{"error":"repository path must be an absolute path to the repository root"}'));
    await expect(invalidPath.registerProject({ name: "x", repositories: [{ id: "app", path: "relative" }] })).rejects.toThrow("absolute path");
    const long = new LuunaClient("http://localhost:4242", "t", respond(422, JSON.stringify({ error: "x".repeat(301) })));
    await expect(long.discover("fixture")).rejects.toThrow("Runtime request failed (HTTP 422)");
    const server = new LuunaClient("http://localhost:4242", "t", respond(500, '{"error":"secret prompt text"}'));
    await expect(server.discover("fixture")).rejects.not.toThrow("secret");
    const text = new LuunaClient("http://localhost:4242", "t", respond(409, "not json"));
    await expect(text.discover("fixture")).rejects.toThrow("The run state changed");
  });

  it("starts baselines, lists them and reads artifacts by identity only", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((url) => Promise.resolve(new Response(String(url).includes("/artifacts/") ? "log text" : "[]")));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    await client.startBaseline("fixture", { repository_id: "app" });
    await client.listBaselines("fixture");
    expect(await client.artifact("run-1", "unit.stdout")).toBe("log text");
    const calls = fetcher.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET", init?.body]);
    expect(calls[0]).toEqual(["http://127.0.0.1:4242/api/v1/projects/fixture/baselines", "POST", JSON.stringify({ repository_id: "app" })]);
    expect(calls[1]).toEqual(["http://127.0.0.1:4242/api/v1/projects/fixture/baselines", "GET", undefined]);
    expect(calls[2]).toEqual(["http://127.0.0.1:4242/api/v1/runs/run-1/artifacts/unit.stdout", "GET", undefined]);
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get("Authorization")).toBe("Bearer test-token");
    for (const bad of ["../luuna.sqlite3", "unit.stdin", "a/b.stdout", "unit..stdout"]) {
      await expect(client.artifact("run-1", bad)).rejects.toThrow("Invalid artifact identifier");
    }
    const missing = new LuunaClient("http://127.0.0.1:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(new Response("secret path", { status: 404 })));
    await expect(missing.artifact("run-1", "unit.stdout")).rejects.toThrow("not available");
  });

  it("extracts check results from a baseline event stream in order", () => {
    const result = (recipe_id: string, status: "passed" | "failed") => ({ schema_version: "0.1", id: recipe_id, run_id: "r", repository_id: "app", recipe_id, candidate_hash: "sha256:a", commit: "b".repeat(40), environment_fingerprint: "sha256:e", command: ["cargo", "test"], status, exit_code: status === "passed" ? 0 : 1, artifact_refs: [] });
    const events: EventEnvelope[] = [
      { ...base, event_id: "1", sequence: 1, type: "check.started", payload: { recipe_id: "unit" } },
      { ...base, event_id: "2", sequence: 2, type: "check.finished", payload: { result: result("unit", "passed") } },
      { ...base, event_id: "3", sequence: 3, type: "check.finished", payload: { result: result("lint", "failed") } },
      { ...base, event_id: "4", sequence: 4, type: "check.finished", payload: { result: "model text saying passed" } },
    ];
    expect(checkResults(events).map((r) => [r.recipe_id, r.status])).toEqual([["unit", "passed"], ["lint", "failed"]]);
  });

  it("reconstructs the confirmed map from the project event stream", () => {
    const manifest = { schema_version: "0.1", id: "fixture", name: "Fixture", revision: 2, repositories: [], relationships: [], policy: {} } as unknown as ProjectManifest;
    const events: EventEnvelope[] = [
      { ...base, event_id: "project:fixture:1", sequence: 1, type: "project.registered", payload: { name: "Fixture" } },
      { ...base, event_id: "project:fixture:2", sequence: 2, type: "manifest.confirmed", payload: { revision: 1, manifest_hash: "sha256:a", manifest: { ...manifest, revision: 1 } } },
      { ...base, event_id: "project:fixture:3", sequence: 3, type: "discovery.proposed", payload: { discovery_id: "d" } },
      { ...base, event_id: "project:fixture:4", sequence: 4, type: "manifest.confirmed", payload: { revision: 2, manifest_hash: "sha256:b", manifest } },
    ];
    expect(confirmedManifest(events.slice(0, 1))).toBeNull();
    expect(confirmedManifest(events)).toEqual({ revision: 2, hash: "sha256:b", manifest });
    expect(mergeEvents([], events).map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });
});
