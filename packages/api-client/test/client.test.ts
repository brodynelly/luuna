import { describe, expect, it, vi } from "vitest";
import { ApiError, EventReplay, EventWindow, LuunaClient, MAX_REASON_LENGTH, advisoryRole, assistantText, awaitsValidation, checkResults, confirmedManifest, isTerminal, loopbackUrl, mergeEvents, nextStep, orbitCommand, overrideFromRefusal, planRequestForTasks, registerProjectRequest, sandboxCommand } from "../src/index";
import type { DoctorReport, EventEnvelope, ProjectManifest, ProjectExport } from "../src/index";

it("retains bounded event payloads while replaying text and rejects a gap atomically", () => {
  const window = new EventWindow();
  const event = (sequence: number) => ({ schema_version: "0.1", timestamp: "2026-10-21T00:00:00Z", project_id: "demo", sequence, event_id: `e${sequence}`, run_id: "run", type: "pi.message_update", payload: { assistantMessageEvent: { type: "text_delta", delta: "x" }, large: "y".repeat(4000) } }) as EventEnvelope;
  for (let start = 1; start <= 2000; start += 200) window.append(Array.from({ length: 200 }, (_, i) => event(start + i)));
  expect(window.cursor).toBe(2000);
  expect(window.records.length).toBeLessThan(200);
  expect(window.text).toBe("x".repeat(2000));
  const previous = window.records;
  expect(window.append([])).toBe(previous);
  expect(() => window.append([event(2001), event(2003)])).toThrow("gap");
  expect(window.records).toBe(previous);
  expect(window.cursor).toBe(2000);
  window.append([{ ...event(2001), type: "pi.message_end", payload: { message: { role: "assistant", content: [{ type: "text", text: "final" }] } } }]);
  expect(window.text).toBe("final");
});

describe("project component authority and resources", () => {
  it("keeps component routes authenticated, project scoped and source reconciliation revision guarded", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    const client = new LuunaClient("http://localhost:4242", "private-token", fetcher);
    const signal = new AbortController().signal;
    await client.components("project/one", signal);
    await client.enableComponents("project/one", signal);
    await client.ticketSource("ticket/one", signal);
    await client.reconcileTicket("ticket/one", 7, signal);
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET", init?.body])).toEqual([
      ["http://localhost:4242/api/v1/projects/project%2Fone/components", "GET", undefined],
      ["http://localhost:4242/api/v1/projects/project%2Fone/components", "POST", undefined],
      ["http://localhost:4242/api/v1/tickets/ticket%2Fone/source", "GET", undefined],
      ["http://localhost:4242/api/v1/tickets/ticket%2Fone/reconcile", "POST", JSON.stringify({ expected_revision: 7 })],
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token");
      expect(init?.signal).toBe(signal);
      expect(init?.redirect).toBe("error");
    }
    expect(() => client.reconcileTicket("t", 0)).toThrow("Invalid ticket revision");
  });

  it("does not retrieve user memory by default and names explicit consent, provenance and deletion identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("[]")));
    const client = new LuunaClient("http://localhost:4242", "t", fetcher);
    await client.listMemory("p");
    await client.listMemory("p", { query: "scope / evidence", includeUser: true });
    const record = { idempotency_key: "repeat-delivery", scope: "project" as const, content: "Source-backed knowledge", provenance: "Run 12" };
    await client.createMemory("p", record);
    await client.deleteMemory("p", "memory/1", "sha256:exact-content");
    const calls = fetcher.mock.calls;
    expect(calls[0][0]).toBe("http://localhost:4242/api/v1/projects/p/memory");
    expect(calls[1][0]).toBe("http://localhost:4242/api/v1/projects/p/memory?q=scope%20%2F%20evidence&include_user=true");
    expect(calls[2][1]?.body).toBe(JSON.stringify(record));
    expect(calls[3][0]).toBe("http://localhost:4242/api/v1/projects/p/memory/memory%2F1?expected_hash=sha256%3Aexact-content");
    expect(calls[3][1]?.method).toBe("DELETE");
    expect(() => client.deleteMemory("p", "m", "")).toThrow("exact content hash");
  });

  it("sends exact prompt versions and explicit context references without granting approval", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    const client = new LuunaClient("http://localhost:4242", "t", fetcher);
    await client.listPrompts("p");
    const prompt = { idempotency_key: "same-prompt-write", name: "writer/scope", body: "Stay in scope", expected_version: 2 };
    await client.createPrompt("p", prompt);
    await client.renderPrompt("p", "writer/scope", 3);
    const request = { task: { repository_id: "app", paths: ["src"], operations: ["read" as const] }, component_context: { memory_ids: ["selected-memory"], prompt: { name: "writer/scope", version: 3, hash: "sha256:exact-prompt" } } };
    await client.createPlan("ticket", request);
    expect(fetcher.mock.calls[0][0]).toBe("http://localhost:4242/api/v1/projects/p/prompts");
    expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify(prompt));
    expect(fetcher.mock.calls[2][0]).toBe("http://localhost:4242/api/v1/projects/p/prompts/writer%2Fscope/render?version=3");
    expect(fetcher.mock.calls[3][1]?.body).toBe(JSON.stringify(request));
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("/approvals"))).toBe(true);
    expect(() => client.renderPrompt("p", "scope", 0)).toThrow("Invalid prompt version");
  });
});

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

  it("reads the runtime's doctor report as a token-protected GET and returns it unchanged (ADR 0027 point 4)", async () => {
    const report: DoctorReport = { ok: false, items: [
      { name: "git", required: true, status: "ok", detail: "git version 2.55.0" },
      { name: "api_token", required: false, status: "ok", detail: "LUUNA_API_TOKEN is configured (value not shown)" },
      { name: "provider_credentials", required: false, status: "warning", detail: "set but empty: ANTHROPIC_API_KEY (an empty variable configures nothing); no provider credential carries a value (model runs fail until one does)" },
      { name: "pi", required: true, status: "missing", detail: "unsupported Pi version; expected 1.3.0" },
    ] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(report), { headers: { "Content-Type": "application/json" } }));
    const signal = new AbortController().signal;
    const client = new LuunaClient("http://localhost:4242", "private-token", fetcher);
    expect(await client.doctor(signal)).toEqual(report);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("http://localhost:4242/api/v1/doctor");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBe(signal);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token");
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive", { status: 401 }));
    await expect(new LuunaClient("http://localhost:4242", "t", rejected).doctor()).rejects.toMatchObject({ status: 401, name: "ApiError" });
  });
});

describe("durable event replay", () => {
  it("incrementally replays overlap without replacing unchanged history", () => {
    const event = (sequence: number) => ({ sequence, event_id: `e${sequence}`, run_id: "run" });
    const replay = new EventReplay<ReturnType<typeof event>>();
    const first = replay.append([event(2), event(1)]);
    expect(replay.append([])).toBe(first);
    expect(replay.append([event(2)])).toBe(first);
    const next = replay.append([event(4), event(2), event(3)]);
    expect(next).toEqual(mergeEvents(first, [event(4), event(2), event(3)]));
    expect(next[0]).toBe(first[0]);
    expect(first).toHaveLength(2);
    expect(replay.cursor).toBe(4);
  });

  it("rejects a whole bad page without poisoning cursor, identities or retained records", () => {
    const event = (sequence: number) => ({ sequence, event_id: `e${sequence}`, run_id: "run" });
    for (const invalid of [
      [event(2), event(4)],
      [event(2), { ...event(3), event_id: "e1" }],
      [event(2), { ...event(2), event_id: "other" }],
      [event(2), { ...event(3), run_id: "other" }],
      [{ ...event(2), sequence: NaN }],
      [{ ...event(2), event_id: "" }],
    ]) {
      const replay = new EventReplay<ReturnType<typeof event>>();
      const first = replay.append([event(1)]);
      expect(() => replay.append(invalid)).toThrow();
      expect(replay.cursor).toBe(1);
      expect(replay.append([])).toBe(first);
      expect(replay.append([event(2), event(3)])).toHaveLength(3);
    }
  });
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

  it("imports an export with local checkouts through POST and refuses a non-export document locally", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    const exported = { kind: "luuna-project-export", schema_version: "0.1", export_hash: `sha256:${"a".repeat(64)}` } as unknown as ProjectExport;
    await client.importProject({ export: exported, repositories: [{ id: "app", path: "/srv/clone" }], idempotency_key: "import-1" });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:4242/api/v1/projects/import");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ export: exported, repositories: [{ id: "app", path: "/srv/clone" }], idempotency_key: "import-1" });
    expect(() => client.importProject({ export: { kind: "other" } as unknown as ProjectExport, repositories: [{ id: "app", path: "/srv/clone" }], idempotency_key: "k" })).toThrow("not a Luuna project export");
    expect(() => client.importProject({ export: exported, repositories: [], idempotency_key: "k" })).toThrow("local checkout path");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("surfaces short deterministic runtime reasons for conflicts and validation failures only", async () => {
    const respond = (status: number, body: string) => vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status, headers: { "Content-Type": "application/json" } }));
    const conflict = new LuunaClient("http://localhost:4242", "t", respond(409, '{"error":"revision conflict: expected 1, current 0"}'));
    await expect(conflict.discover("fixture")).rejects.toThrow("revision conflict: expected 1, current 0");
    const invalid = new LuunaClient("http://localhost:4242", "t", respond(422, '{"error":"default branch release is not a local or origin branch of repository app"}'));
    await expect(invalid.discover("fixture")).rejects.toThrow("default branch release");
    const invalidPath = new LuunaClient("http://localhost:4242", "t", respond(400, '{"error":"repository path must be an absolute path to the repository root"}'));
    await expect(invalidPath.registerProject({ name: "x", repositories: [{ id: "app", path: "relative" }] })).rejects.toThrow("absolute path");
    // A deterministic reason may quote a testing-setup offer or a dependency override (ADR 0022, ADR 0023), so the bound is 1000; longer bodies are never surfaced.
    const quoted = new LuunaClient("http://localhost:4242", "t", respond(422, JSON.stringify({ error: `task consumer in repository consumer must depend on task shared in repository shared: ${"x".repeat(400)}` })));
    await expect(quoted.discover("fixture")).rejects.toThrow("task consumer in repository consumer must depend on");
    const long = new LuunaClient("http://localhost:4242", "t", respond(422, JSON.stringify({ error: "x".repeat(MAX_REASON_LENGTH + 1) })));
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

describe("tickets, plans, approvals and the writer (M2c)", () => {
  it("creates tickets through the canonical project-scoped route with an idempotency key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 201 }));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    await client.createTicket("my project", { idempotency_key: "k1", title: "T", intent: "I", acceptance_criteria: ["c"], repository_ids: ["app"] });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4242/api/v1/projects/my%20project/tickets");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body)).idempotency_key).toBe("k1");
    expect(() => client.createTicket("p", { idempotency_key: " ", title: "T", intent: "I", acceptance_criteria: ["c"], repository_ids: ["app"] })).toThrow();
  });

  it("approves by exact hash and schedules the writer against the run", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    expect(() => client.approvePlan("plan-1", { plan_revision: 1, plan_hash: "not-a-hash", approved_by: "dev" })).toThrow();
    await client.approvePlan("plan-1", { plan_revision: 2, plan_hash: "sha256:abc", approved_by: "dev" });
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:4242/api/v1/plans/plan-1/approvals");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ plan_revision: 2, plan_hash: "sha256:abc", approved_by: "dev" });
    await client.implement("run/1", { provider: "openrouter", model: "m" });
    expect(fetcher.mock.calls[1][0]).toBe("http://127.0.0.1:4242/api/v1/runs/run%2F1/implement");
    await client.worktrees("run/1");
    expect(fetcher.mock.calls[2][0]).toBe("http://127.0.0.1:4242/api/v1/runs/run%2F1/worktrees");
  });

  it("surfaces the runtime's refusal reason for a stale or refused implementation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "implementation refused: baseline lacks a passed result for required check unit" }), { status: 422 }));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    await expect(client.implement("run-1")).rejects.toThrow("implementation refused");
    expect(awaitsValidation("validating")).toBe(true);
    expect(isTerminal("validating")).toBe(false);
    expect(isTerminal("reviewed")).toBe(true);
  });
});

describe("candidate validation and repair (M3)", () => {
  const candidate_hash = `sha256:${"a".repeat(64)}`;

  it("reads candidate-bound evidence and diff and submits the expected hash for both actions", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    const signal = new AbortController().signal;
    await client.candidate("run/1", signal);
    await client.candidateDiff("run/1", signal);
    await client.validateCandidate("run/1", { candidate_hash, provider: "openrouter", model: "review-model" }, signal);
    await client.repairCandidate("run/1", { candidate_hash }, signal);
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET", init?.body])).toEqual([
      ["http://127.0.0.1:4242/api/v1/runs/run%2F1/candidate", "GET", undefined],
      ["http://127.0.0.1:4242/api/v1/runs/run%2F1/diff", "GET", undefined],
      ["http://127.0.0.1:4242/api/v1/runs/run%2F1/validate", "POST", JSON.stringify({ candidate_hash, provider: "openrouter", model: "review-model" })],
      ["http://127.0.0.1:4242/api/v1/runs/run%2F1/repair", "POST", JSON.stringify({ candidate_hash })],
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.signal).toBe(signal);
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
    }
  });

  it("requires a complete candidate hash before any work request reaches the runtime", () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new LuunaClient("http://localhost:4242", "test-token", fetcher);
    for (const bad of ["", "sha256:a", "a".repeat(64), `sha256:${"z".repeat(64)}`]) {
      expect(() => client.validateCandidate("r", { candidate_hash: bad })).toThrow("complete hash");
      expect(() => client.repairCandidate("r", { candidate_hash: bad })).toThrow("complete hash");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces stale candidate and exhausted repair reasons without treating a refusal as success", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "candidate hash changed; reload" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "repair budget exhausted" }), { status: 422 }));
    const client = new LuunaClient("http://localhost:4242", "test-token", fetcher);
    await expect(client.validateCandidate("r", { candidate_hash })).rejects.toThrow("candidate hash changed");
    await expect(client.repairCandidate("r", { candidate_hash })).rejects.toThrow("repair budget exhausted");
  });

  it("requests automatic repairs only through explicit validation settings", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const client = new LuunaClient("http://localhost:4242", "test-token", fetcher);
    await client.validateCandidate("r", { candidate_hash, auto_repair: true });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ candidate_hash, auto_repair: true });
  });
});

describe("live event following over SSE", () => {
  const record = (sequence: number, type = "pi.message_update") => ({ schema_version: "0.1", event_id: `e${sequence}`, sequence, timestamp: "2026-10-21T00:00:00Z", project_id: "p", run_id: "run", type, payload: {} });
  const sse = (events: object[]) => new Response(events.map((event) => `event: run_event\nid: ${(event as { sequence: number }).sequence}\ndata: ${JSON.stringify(event)}\n\n`).join(": keep-alive\n\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });

  it("streams run events in order with Last-Event-ID resumption and rejects another run's events", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(sse([record(3), record(4)]));
    const client = new LuunaClient("http://127.0.0.1:4242", "t", fetcher);
    const received = [];
    for await (const event of client.streamEvents("run", 2)) received.push(event.sequence);
    expect(received).toEqual([3, 4]);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:4242/api/v1/runs/run/stream?after=2");
    expect(new Headers(init?.headers).get("Last-Event-ID")).toBe("2");
    expect(new Headers(init?.headers).get("Accept")).toBe("text/event-stream");
    fetcher.mockResolvedValueOnce(sse([{ ...record(1), run_id: "other" }]));
    await expect((async () => { for await (const _event of client.streamEvents("run")) { /* consume */ } })()).rejects.toThrow("different run");
    fetcher.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect((async () => { for await (const _event of client.streamEvents("run")) { /* consume */ } })()).rejects.toMatchObject({ status: 404 });
  });

  it("follows through an outage from the last received sequence and stops when the run settles", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(sse([record(1)]))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(sse([record(2, "run.completed")]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "run", state: "completed", metadata: {} })));
    const client = new LuunaClient("http://127.0.0.1:4242", "t", fetcher);
    const outages: unknown[] = [];
    let reconnected = 0;
    const received = [];
    for await (const event of client.followEvents("run", 0, undefined, { outage: (failure) => outages.push(failure), reconnected: () => { reconnected += 1; }, wait: async () => undefined })) received.push(event.sequence);
    expect(received).toEqual([1, 2]);
    expect(outages).toHaveLength(1);
    expect(reconnected).toBe(1);
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get("Last-Event-ID")).toBe("1");
    expect(String(fetcher.mock.calls[3][0])).toBe("http://127.0.0.1:4242/api/v1/runs/run");
  });

  it("ends a follow on a rejected token instead of retrying", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 401 }));
    const client = new LuunaClient("http://127.0.0.1:4242", "t", fetcher);
    await expect((async () => { for await (const _event of client.followEvents("run", 0, undefined, { wait: async () => undefined })) { /* consume */ } })()).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("ticket editing, memory correction, the personal export and retention (ADR 0026)", () => {
  it("sends each edit at the revision or hash the client read, and the retention routes as cataloged", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    const client = new LuunaClient("http://localhost:4242", "t", fetcher);
    await client.updateTicket("ticket/one", { expected_revision: 3, title: "Edited", repository_ids: ["app", "web"] });
    await client.updateMemory("p", "mem/1", { idempotency_key: "k1", expected_hash: "sha256:exact", content: "corrected" });
    await client.exportUserMemory();
    await client.memoryRetention("p");
    await client.setMemoryRetention("p", { process_max_age_days: 30, project_max_age_days: null });
    await client.applyMemoryRetention("p", { idempotency_key: "k2" });
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET", init?.body])).toEqual([
      ["http://localhost:4242/api/v1/tickets/ticket%2Fone", "PUT", JSON.stringify({ expected_revision: 3, title: "Edited", repository_ids: ["app", "web"] })],
      ["http://localhost:4242/api/v1/projects/p/memory/mem%2F1", "PUT", JSON.stringify({ idempotency_key: "k1", expected_hash: "sha256:exact", content: "corrected" })],
      ["http://localhost:4242/api/v1/memory/user/export", "GET", undefined],
      ["http://localhost:4242/api/v1/projects/p/memory/retention", "GET", undefined],
      ["http://localhost:4242/api/v1/projects/p/memory/retention", "PUT", JSON.stringify({ process_max_age_days: 30, project_max_age_days: null })],
      ["http://localhost:4242/api/v1/projects/p/memory/retention/apply", "POST", JSON.stringify({ idempotency_key: "k2" })],
    ]);
    for (const [, init] of fetcher.mock.calls) expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer t");
    expect(() => client.updateTicket("t", { expected_revision: 0, title: "x" })).toThrow("Invalid ticket revision");
    expect(() => client.updateTicket("t", { expected_revision: 1 })).toThrow("at least one ticket field");
    expect(() => client.updateMemory("p", "m", { idempotency_key: "k", expected_hash: "", content: "x" })).toThrow("exact content hash");
    expect(() => client.updateMemory("p", "m", { idempotency_key: "k", expected_hash: "sha256:x", content: " " })).toThrow("content is required");
    expect(() => client.setMemoryRetention("p", { process_max_age_days: 0, project_max_age_days: null })).toThrow("between 1 and 3650");
    expect(() => client.setMemoryRetention("p", { process_max_age_days: null, project_max_age_days: 4000 })).toThrow("between 1 and 3650");
    expect(() => client.applyMemoryRetention("p", { idempotency_key: " " })).toThrow("idempotency key");
  });
});

describe("shared request builders (R02, A33: the desktop and the TUI send the same body)", () => {
  it("registers every repository row once, trimmed, and refuses a row without an id or a path", () => {
    expect(registerProjectRequest(" Walkthrough ", [{ id: "app", path: "/srv/app" }, { id: " web ", path: " /srv/web " }], " walkthrough ")).toEqual({ name: "Walkthrough", id: "walkthrough", repositories: [{ id: "app", path: "/srv/app" }, { id: "web", path: "/srv/web" }] });
    expect(registerProjectRequest("One", [{ id: "app", path: "/srv/app" }, { id: "", path: "" }])).toEqual({ name: "One", repositories: [{ id: "app", path: "/srv/app" }] });
    expect(() => registerProjectRequest("One", [{ id: "app", path: "" }])).toThrow("needs an id and an absolute root path");
    expect(() => registerProjectRequest("One", [{ id: "app", path: "/a" }, { id: "app", path: "/b" }])).toThrow("unique");
    expect(() => registerProjectRequest("One", [])).toThrow("at least one repository");
    expect(() => registerProjectRequest(" ", [{ id: "app", path: "/a" }])).toThrow("needs a name");
  });

  it("keeps a single task in its pre-M4 shape and builds a task graph with dependencies and workers", () => {
    expect(planRequestForTasks([{ repository_id: "app", paths: [" src ", ""], operations: ["read", "write"] }], { max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000, max_workers: 1 }))
      .toEqual({ task: { repository_id: "app", paths: ["src"], operations: ["read", "write"] }, budgets: { max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000 } });
    expect(planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"] }])).toEqual({ task: { repository_id: "app", paths: ["src"], operations: ["read"] } });
    const graph = planRequestForTasks([
      { repository_id: "shared", paths: ["lib"], operations: ["read", "write"] },
      { repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"] },
      { repository_id: "consumer", paths: ["src", "tests"], operations: ["read", "write"], depends_on: ["shared", "api"], acceptance_criteria: ["imports the shared package"] },
    ], { max_workers: 2, max_attempts: 3 }, { componentContext: { memory_ids: ["mem-1"], prompt: null } });
    expect(graph).toEqual({
      tasks: [
        { id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read", "write"] },
        { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"] },
        { id: "consumer", repository_id: "consumer", paths: ["src", "tests"], operations: ["read", "write"], acceptance_criteria: ["imports the shared package"], depends_on: ["shared", "api"] },
      ],
      budgets: { max_attempts: 3, max_workers: 2 },
      component_context: { memory_ids: ["mem-1"], prompt: null },
    });
    expect(planRequestForTasks([{ repository_id: "a", paths: ["src"], operations: ["read"] }], {}, { componentContext: { memory_ids: [], prompt: null } })).not.toHaveProperty("component_context");
    expect(() => planRequestForTasks([])).toThrow("at least one task");
    expect(() => planRequestForTasks([{ repository_id: "a", paths: [], operations: ["read"] }, { repository_id: "a", paths: [], operations: ["read"] }])).toThrow("distinct repository");
    expect(() => planRequestForTasks([{ repository_id: "a", paths: [], operations: ["read"], depends_on: ["a"] }, { repository_id: "b", paths: [], operations: ["read"] }])).toThrow("cannot depend on itself");
    expect(() => planRequestForTasks([{ repository_id: "a", paths: [], operations: ["read"], depends_on: ["zzz"] }, { repository_id: "b", paths: [], operations: ["read"] }])).toThrow("not a task of this plan");
    expect(() => planRequestForTasks([{ repository_id: "a", paths: [], operations: ["read"] }, { repository_id: "b", paths: [], operations: ["read"] }], { max_workers: 3 })).toThrow("between 1 and 2");
    expect(() => planRequestForTasks([{ repository_id: "a", paths: [], operations: ["read"] }], { max_attempts: 0 })).toThrow("budgets.max_attempts");
  });
});

// ---- ADR 0022 (testing-setup prerequisite) and ADR 0023 (roles, traces, overrides): the request
// fields both clients send through one client, and the structured offer a refusal carries. ----
describe("testing-setup prerequisite and delegated roles", () => {
  const sent = () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    return { fetcher, client: new LuunaClient("http://localhost:4242", "t", fetcher), body: (index: number) => JSON.parse(String(fetcher.mock.calls[index][1]?.body)) };
  };

  it("creates a testing_setup ticket and a setup plan with its check recipes", async () => {
    const { client, body } = sent();
    await client.createTicket("p", { idempotency_key: "k", title: "Establish tests", intent: "Add a harness", acceptance_criteria: ["python -m unittest executes one test"], repository_ids: ["app"], purpose: "testing_setup" });
    expect(body(0)).toMatchObject({ purpose: "testing_setup", repository_ids: ["app"] });
    const request = planRequestForTasks([{ repository_id: "app", paths: ["tests"], operations: ["read", "write"] }], { max_attempts: 2 }, { checks: [{ id: "unit", executable: "python", args: ["-m", "unittest"], timeout_seconds: 120 }, { id: "lint", executable: "ruff", args: [], cwd: ".", timeout_seconds: 60, capabilities: ["network"] }] });
    expect(request).toEqual({ task: { repository_id: "app", paths: ["tests"], operations: ["read", "write"] }, budgets: { max_attempts: 2 }, checks: [{ id: "unit", executable: "python", args: ["-m", "unittest"], timeout_seconds: 120, capabilities: [], required: true }, { id: "lint", executable: "ruff", args: [], timeout_seconds: 60, capabilities: ["network"], required: true }] });
    await client.createPlan("ticket-1", { ...request, idempotency_key: "k2" });
    expect(body(1)).toEqual({ ...request, idempotency_key: "k2" });
    // What no runtime accepts is refused before anything is sent.
    expect(() => planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"] }], {}, { checks: [{ id: "", executable: "python", timeout_seconds: 10 }] })).toThrow("id and an executable");
    expect(() => planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"] }], {}, { checks: [{ id: "unit", executable: "python", timeout_seconds: 0 }] })).toThrow("timeout");
    expect(() => planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"] }], {}, { checks: [{ id: "unit", executable: "python", timeout_seconds: 10, required: false as never }] })).toThrow("required checks only");
    expect(() => planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"] }], {}, { checks: [{ id: "unit", executable: "python", timeout_seconds: 10 }, { id: "unit", executable: "pytest", timeout_seconds: 10 }] })).toThrow("unique");
    expect(() => planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"] }, { repository_id: "web", paths: [], operations: ["read"] }], {}, { checks: [{ id: "unit", executable: "python", timeout_seconds: 10 }] })).toThrow("exactly one task");
    expect(planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"] }], {}, { checks: [] })).not.toHaveProperty("checks");
  });

  it("surfaces the structured testing-setup offer of a refused implementation with the shared next step", async () => {
    const prerequisite = { kind: "testing_setup", project_id: "p", repository_id: "app", baseline_id: "b1", reason: "the manifest names no required check for repository app", next: "POST /api/v1/projects/p/tickets with purpose testing_setup and repository_ids [\"app\"], then POST /api/v1/tickets/{id}/plans with the check recipes (checks)" };
    const error = `implementation refused: repository app has no usable testing setup (${prerequisite.reason}); a prerequisite testing-setup ticket is offered: ${prerequisite.next}`;
    const refused = new LuunaClient("http://localhost:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error, prerequisite }), { status: 422, headers: { "Content-Type": "application/json" } })));
    const failure = await refused.implement("run-1").catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe(error);
    expect((failure as ApiError).fromRuntime).toBe(true);
    expect((failure as ApiError).prerequisite).toEqual(prerequisite);
    expect(nextStep(error)).toContain("Create the testing-setup ticket the runtime offers");
    // A detail of another shape is not an offer; a plain refusal carries none.
    const odd = new LuunaClient("http://localhost:4242", "t", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "refused", prerequisite: { kind: "other", next: "x" } }), { status: 422, headers: { "Content-Type": "application/json" } })));
    expect(((await odd.implement("run-1").catch((caught: unknown) => caught)) as ApiError).prerequisite).toBeUndefined();
  });

  it("sends roles, derivation and dependency overrides only when given, and refuses what the domain refuses", () => {
    const drafts = [
      { id: "lead", repository_id: "shared", paths: ["lib"], operations: ["read" as const], role: "repository_lead" as const },
      { id: "api", repository_id: "api", paths: ["src"], operations: ["read" as const, "write" as const], depends_on: ["lead"], derived_from_task: "orchestrate" },
      { id: "consumer", repository_id: "consumer", paths: ["src"], operations: ["read" as const, "write" as const], role: "implementer" as const },
    ];
    const request = planRequestForTasks(drafts, { max_workers: 2 }, { dependencyOverrides: [{ consumer: "consumer", producer: "api", action: "waive", justification: " the consumer pins the published package " }] });
    expect(request).toEqual({
      tasks: [
        { id: "lead", repository_id: "shared", paths: ["lib"], operations: ["read"], role: "repository_lead" },
        { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["lead"], derived_from_task: "orchestrate" },
        { id: "consumer", repository_id: "consumer", paths: ["src"], operations: ["read", "write"] },
      ],
      dependency_overrides: [{ consumer: "consumer", producer: "api", action: "waive", justification: "the consumer pins the published package" }],
      budgets: { max_workers: 2 },
    });
    // A single advisory task keeps the single-task shape with its role; a single implementer stays pre-M4.
    expect(planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"], role: "project_orchestrator" }])).toEqual({ task: { repository_id: "app", paths: ["src"], operations: ["read"], role: "project_orchestrator" } });
    expect(planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read", "write"], role: "implementer" }])).toEqual({ task: { repository_id: "app", paths: ["src"], operations: ["read", "write"] } });
    expect(() => planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read", "write"], role: "repository_lead" }])).toThrow("reads only");
    expect(() => planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"], role: "reviewer" as never }])).toThrow("unknown role");
    expect(() => planRequestForTasks([{ id: "a", repository_id: "app", paths: [], operations: ["read"] }, { id: "b", repository_id: "web", paths: [], operations: ["read"], derived_from_task: "a" }])).toThrow("same plan");
    expect(() => planRequestForTasks([{ repository_id: "app", paths: [], operations: ["read"], derived_from_task: "implement" }])).toThrow("derive from itself");
    const two = [{ id: "a", repository_id: "app", paths: [], operations: ["read" as const, "write" as const] }, { id: "b", repository_id: "web", paths: [], operations: ["read" as const, "write" as const] }];
    expect(() => planRequestForTasks(two, {}, { dependencyOverrides: [{ consumer: "a", producer: "zzz", action: "add", justification: "x" }] })).toThrow("not a task of this plan");
    expect(() => planRequestForTasks(two, {}, { dependencyOverrides: [{ consumer: "a", producer: "a", action: "add", justification: "x" }] })).toThrow("both consumer and producer");
    expect(() => planRequestForTasks(two, {}, { dependencyOverrides: [{ consumer: "a", producer: "b", action: "add", justification: "  " }] })).toThrow("justification");
    expect(() => planRequestForTasks(two, {}, { dependencyOverrides: [{ consumer: "a", producer: "b", action: "add", justification: "x" }, { consumer: "a", producer: "b", action: "waive", justification: "y" }] })).toThrow("repeated");
    expect(() => planRequestForTasks(two, {}, { dependencyOverrides: [{ consumer: "a", producer: "b", action: "skip" as never, justification: "x" }] })).toThrow("waive or add");
    expect(() => planRequestForTasks([two[0], { ...two[1], operations: ["read"], role: "repository_lead" }], {}, { dependencyOverrides: [{ consumer: "a", producer: "b", action: "add", justification: "x" }] })).toThrow("advisory task");
    expect(advisoryRole("repository_lead") && advisoryRole("project_orchestrator") && !advisoryRole("implementer") && !advisoryRole(undefined)).toBe(true);
  });

  it("reads the override a relationship refusal quotes, so the developer only adds the justification", () => {
    const reason = 'task consumer in repository consumer must depend on task shared in repository shared: confirmed relationship shared -> consumer (package npm:@fixture/shared); add the dependency, or waive it with dependency_overrides [{"consumer": "consumer", "producer": "shared", "action": "waive", "justification": "..."}]';
    expect(overrideFromRefusal(reason)).toEqual({ consumer: "consumer", producer: "shared", action: "waive", justification: "" });
    expect(overrideFromRefusal('… record it with dependency_overrides [{"consumer": "b", "producer": "a", "action": "add", "justification": "..."}]')).toEqual({ consumer: "b", producer: "a", action: "add", justification: "" });
    expect(overrideFromRefusal("repository app already has an active writer")).toBeNull();
    expect(overrideFromRefusal("dependency_overrides [{broken")).toBeNull();
    expect(nextStep(reason)).toContain("record the quoted dependency override");
  });
});

describe("orbit (ADR 0036)", () => {
  it("sends the five orbit routes project scoped and refuses empty commands and bad timeouts locally", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    await client.orbit("my/app");
    await client.orbitExec("my/app", { executable: "git", args: ["status", "--short"], parallel: true });
    await client.orbitRun("my/app", { recipe: "test", repositories: ["api"] });
    await client.orbitSync("my/app", { fetch: false });
    await client.orbitSandbox("my/app", "none");
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET", init?.body])).toEqual([
      ["http://127.0.0.1:4242/api/v1/projects/my%2Fapp/orbit", "GET", undefined],
      ["http://127.0.0.1:4242/api/v1/projects/my%2Fapp/orbit/exec", "POST", JSON.stringify({ executable: "git", args: ["status", "--short"], parallel: true })],
      ["http://127.0.0.1:4242/api/v1/projects/my%2Fapp/orbit/run", "POST", JSON.stringify({ recipe: "test", repositories: ["api"] })],
      ["http://127.0.0.1:4242/api/v1/projects/my%2Fapp/orbit/sync", "POST", JSON.stringify({ fetch: false })],
      ["http://127.0.0.1:4242/api/v1/projects/my%2Fapp/orbit/sandbox?network=none", "GET", undefined],
    ]);
    expect(() => client.orbitExec("p", { executable: "  " })).toThrow("Type a command");
    expect(() => client.orbitExec("p", { executable: "git", timeout_seconds: 0 })).toThrow("timeout");
    expect(() => client.orbitRun("p", { recipe: "" })).toThrow("recipe");
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("splits a typed command into an argument array without a shell and names the sandbox command", () => {
    expect(orbitCommand(`git commit -m "two words" 'and more'`)).toEqual({ executable: "git", args: ["commit", "-m", "two words", "and more"] });
    expect(() => orbitCommand("   ")).toThrow("Type a command");
    expect(sandboxCommand("luuna")).toBe("lu sbx luuna");
    expect(sandboxCommand("luuna", "none")).toBe("lu sbx luuna --network none");
  });
});
