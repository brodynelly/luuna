import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createBridge, LIMITS } from "../src/bridge.mjs";
import { COMMANDS, PROJECTIONS, commandsByName } from "../src/commands.mjs";
import { catalog } from "../src/catalog.mjs";

const HASH = `sha256:${"a".repeat(64)}`;
const PLAN = { id: "plan-1", revision: 1, ticket_id: "ticket-1", ticket_revision: 1, hash: HASH, base_commits: { app: "abc" }, tasks: [{ paths: ["src"], operations: ["read", "write"] }], budgets: { max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1000000 } };
const RUN = { id: "run-1", project_id: "walkthrough", state: "completed", revision: 3, metadata: { kind: "workflow" } };
const EVENT = { schema_version: "0.1", event_id: "e1", sequence: 1, timestamp: "2026-10-21T00:00:00Z", project_id: "walkthrough", run_id: "run-1", type: "run.completed", payload: {} };
const json = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function fixture() {
  const requests = [];
  const fetcher = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const { pathname, search } = new URL(url);
    requests.push({ method, pathname, search, headers: new Headers(init.headers), body: init.body });
    if (/\/stream$/.test(pathname)) return new Response(`event: run_event\nid: 1\ndata: ${JSON.stringify(EVENT)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    if (/\/artifacts\//.test(pathname)) return new Response("Ran 1 test\nOK\n", { headers: { "Content-Type": "text/plain" } });
    if (/\/doctor$/.test(pathname)) return json({ ok: true, items: [] });
    if (/\/memory\/user\/export$/.test(pathname)) return json({ memory: [], omitted: [] });
    if (/\/retention\/apply$/.test(pathname)) return json({ deleted: [] });
    if (method !== "GET" && (/\/projects$/.test(pathname) || /\/manifest$/.test(pathname) || /\/rebind$/.test(pathname))) return json({ project: { id: "walkthrough", name: "Walkthrough", revision: 1 }, repositories: [] });
    if (method !== "GET" && (/\/tickets$/.test(pathname) || /\/tickets\/[^/]+\/reconcile$/.test(pathname))) return json({ id: "ticket-1", revision: 1, source: "luuna_sqlite_temporary", title: "t", intent: "i", acceptance_criteria: [], repository_ids: ["app"] });
    if (/^\/api\/v1\/plans\/[^/]+$/.test(pathname)) return json(PLAN);
    if (/\/approvals$/.test(pathname)) return json({ approval: { plan_id: "plan-1", plan_revision: 1, plan_hash: HASH, approved_by: "developer" }, run: { ...RUN, state: "approved" } });
    if (/^\/api\/v1\/runs\/[^/]+$/.test(pathname)) return json(RUN);
    if (/\/candidate$/.test(pathname)) return json({ evidence: { candidate: { revision: 1, hash: HASH, plan_hash: HASH, repository_commits: {} }, status: "pending", results: [] }, active: false });
    if (/^\/api\/v1\/projects\/[^/]+$/.test(pathname)) return json({ project: { id: "walkthrough", name: "Walkthrough", revision: 0 }, repositories: [{ repository_id: "app", local_path: "/srv/app", observation: { identity: {}, dirty: {} } }], manifest: null });
    if (/^\/api\/v1\/tickets\/[^/]+$/.test(pathname)) return json({ id: "ticket-1", revision: 1, source: "luuna_sqlite_temporary", title: "t", intent: "i", acceptance_criteria: [], repository_ids: ["app"] });
    if (/\/events$/.test(pathname)) return json([]);
    if (/\/projects$/.test(pathname) && method === "GET") return json([]);
    if (/\/runs$/.test(pathname) && method === "GET") return json([]);
    return json(/plans$/.test(pathname) && method === "POST" ? { plan: PLAN, run: RUN } : {});
  };
  return { fetcher, requests };
}
function harness(t, options = {}) {
  const frames = [];
  const mock = fixture();
  let bridge;
  let counter = 0;
  bridge = createBridge({
    env: { LUUNA_API_TOKEN: "fixture-secret", LUUNA_URL: "http://127.0.0.1:4242" },
    fetcher: mock.fetcher,
    readFile: (path) => JSON.stringify(String(path).includes("export") ? { schema_version: "0.1", kind: "luuna-project-export", export_hash: HASH, project: { id: "walkthrough" } } : { schema_version: "0.1", id: "walkthrough" }),
    ...options,
    send: async (frame) => {
      frames.push(frame);
      if (options.send) await options.send(frame);
      if (frame.event === "prompt" && options.answer !== false) queueMicrotask(() => { void bridge.dispatch({ v: 1, id: `reply-${++counter}`, op: "reply", request_id: frame.id, prompt_id: frame.prompt_id, value: options.answer?.(frame) ?? (frame.kind === "confirm" ? true : frame.kind === "hash" ? HASH : '{"schema_version":"0.1","id":"walkthrough"}') }); });
    },
  });
  t.after(() => bridge.close());
  const run = async (request) => { await bridge.dispatch({ v: 1, id: "test", op: "invoke", ...request }); await bridge.flushed(); return frames.filter((frame) => frame.id === (request.id ?? "test")); };
  return { bridge, frames, run, requests: mock.requests };
}

test("catalog serializes every action and projection with safe interactive metadata", async (t) => {
  const { run } = harness(t, { env: {} });
  const [result] = await run({ op: "catalog" });
  assert.deepEqual(result.commands.map((command) => command.id), [...COMMANDS, ...PROJECTIONS].map((command) => command.id));
  assert.equal(result.commands.length, catalog.capabilities.length + 2);
  for (const command of result.commands) {
    assert.equal(command.read_only, PROJECTIONS.some((item) => item.id === command.id) || catalog.capabilities.some((item) => item.id === command.id && item.method === "GET"));
    assert.equal(command.run, undefined);
  }
  assert.equal(result.commands.find((command) => command.name === "approve").flags["acknowledge-hash"], undefined);
});

for (const capability of catalog.capabilities) {
  test(`bridge preserves ${capability.tui}: ${capability.method} ${capability.route}`, async (t) => {
    const { run, requests } = harness(t);
    const command = commandsByName.get(capability.tui);
    const flags = { ...command.example.flags };
    delete flags["acknowledge-hash"];
    const frames = await run({ name: command.name, args: command.example.args, flags, stdin_document: '{"schema_version":"0.1","id":"walkthrough"}' });
    assert.equal(frames.at(-1).event, "result", JSON.stringify(frames.at(-1)));
    const matcher = new RegExp(`^${capability.route.replace(/\{[a-z_]+\}/g, "[^/]+")}$`);
    assert.ok(requests.some((request) => request.method === capability.method && matcher.test(request.pathname)));
    assert.equal(frames.filter((frame) => ["error", "result"].includes(frame.event)).length, 1);
    for (const request of requests) assert.equal(request.headers.get("Authorization"), "Bearer fixture-secret");
    assert.ok(!JSON.stringify(frames).includes("fixture-secret"));
  });
}

for (const name of ["home", "board"]) test(`${name} projection crosses read boundary`, async (t) => {
  const { run, requests } = harness(t);
  const frames = await run({ op: "read", name });
  assert.equal(frames.at(-1).event, "result");
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("read refuses mutation names and local export writes; malformed flags cannot bypass validation", async (t) => {
  const { run, requests } = harness(t);
  for (const request of [{ op: "read", name: "cancel", args: ["run-1"] }, { op: "read", name: "export", args: ["project"], flags: { output: "file.json" } }, { name: "validate", args: ["run-1"], flags: { "auto-repair": "false" } }, { name: "projects", flags: { unknown: true } }, { name: "projects", args: [3] }]) assert.equal((await run(request)).at(-1).event, "error");
  assert.equal(requests.length, 0);
});

test("fresh approval shows the complete plan before requesting typed hash", async (t) => {
  const { run, requests } = harness(t);
  const frames = await run({ name: "approve", args: ["plan-1"] });
  const plan = frames.filter((frame) => frame.event === "output").map((frame) => frame.text).join("");
  assert.ok(plan.includes(JSON.stringify(PLAN, null, 2)));
  assert.ok(frames.findIndex((frame) => frame.event === "output") < frames.findIndex((frame) => frame.event === "prompt"));
  assert.equal(frames.find((frame) => frame.event === "prompt").kind, "hash");
  assert.deepEqual(JSON.parse(requests.find((request) => request.method === "POST").body), { plan_revision: 1, plan_hash: HASH, approved_by: "developer" });
});

test("preacknowledged, mismatched and cancelled approval never POST", async (t) => {
  for (const answer of ["", "sha256:wrong"]) {
    const { run, requests } = harness(t, { answer: () => answer });
    assert.equal((await run({ name: "approve", args: ["plan-1"] })).at(-1).event, "error");
    assert.ok(requests.every((request) => request.method === "GET"));
  }
  const { run, requests } = harness(t);
  assert.equal((await run({ name: "approve", args: ["plan-1"], flags: { "acknowledge-hash": HASH } })).at(-1).event, "error");
  assert.equal(requests.length, 0);
});

test("oversized plans disable approval before a hash prompt", async (t) => {
  const { run } = harness(t, { fetcher: async () => json({ ...PLAN, description: "x".repeat(LIMITS.display) }) });
  const frames = await run({ name: "approve", args: ["plan-1"] });
  assert.equal(frames.at(-1).code, "plan_too_large");
  assert.ok(!frames.some((frame) => frame.event === "prompt"));
});

const reviewText = (plan) => `Plan ${plan.id} revision ${plan.revision}\nImmutable plan hash: ${plan.hash}\n${JSON.stringify(plan, null, 2)}`;

test("complete near-256 KiB plans reach approval with immediately draining output", async (t) => {
  for (const pattern of ["x", '"\\\n', "\u{1f319}"]) {
    const empty = { ...PLAN, description: "" };
    const overhead = Buffer.byteLength(reviewText(empty));
    const unit = Buffer.byteLength(JSON.stringify(pattern).slice(1, -1));
    const plan = { ...empty, description: pattern.repeat(Math.floor((LIMITS.display - overhead) / unit)) };
    const expected = reviewText(plan);
    assert.ok(Buffer.byteLength(expected) <= LIMITS.display);
    assert.ok(Buffer.byteLength(expected) > LIMITS.display - 16);
    let approvals = 0;
    const { run, bridge } = harness(t, { fetcher: async (_url, init) => {
      if (init.method === "POST") {
        approvals++;
        return json({ approval: { plan_id: PLAN.id, plan_revision: 1, plan_hash: HASH, approved_by: "developer" }, run: RUN });
      }
      return json(plan);
    } });
    const frames = await run({ name: "approve", args: [PLAN.id] });
    assert.equal(frames.at(-1).event, "result", JSON.stringify(frames.at(-1)));
    const output = frames.filter((frame) => frame.event === "output");
    assert.equal(output.map((frame) => frame.text).join(""), expected);
    assert.ok(output.every((frame) => Buffer.byteLength(JSON.stringify(frame)) < LIMITS.text && frame.text.isWellFormed()));
    assert.ok(frames.find((frame) => frame.event === "prompt" && frame.kind === "hash"));
    assert.equal(approvals, 1);
    bridge.close();
  }
});

test("credentials crossing old and serialized output chunk boundaries cannot reassemble", async (t) => {
  const token = "test-secret";
  let plan = { ...PLAN, description: "x".repeat(2 * LIMITS.text) };
  const { run, bridge } = harness(t, { env: { LUUNA_API_TOKEN: token }, answer: () => "", fetcher: async () => json(plan) });
  const baseline = await run({ id: "baseline", name: "approve", args: [PLAN.id] });
  const output = baseline.filter((frame) => frame.event === "output");
  const boundaries = [8000];
  let position = 0;
  for (const frame of output.slice(0, -1)) { position += frame.text.length; boundaries.push(position); }
  const prefix = reviewText(plan).indexOf('"description": "') + '"description": "'.length;
  for (const boundary of boundaries) {
    for (let split = 1; split < token.length; split++) {
      const before = boundary - prefix - split;
      plan = { ...PLAN, description: "x".repeat(before) + token + "x".repeat(2 * LIMITS.text - before - token.length) };
      const frames = await run({ id: `boundary-${boundary}-${split}`, name: "approve", args: [PLAN.id] });
      const reconstructed = frames.filter((frame) => frame.event === "output").map((frame) => frame.text).join("");
      assert.equal(reconstructed, reviewText(plan).replaceAll(token, "[redacted]"));
      assert.ok(!reconstructed.includes(token));
    }
  }
  bridge.close();
});

test("malformed successful responses hide body diagnostics and preserve uncertain mutations", async (t) => {
  for (const name of ["cancel", "health"]) {
    const requests = [];
    const bodyMarker = "private-response-fragment";
    const { run } = harness(t, { fetcher: async (_url, init) => {
      requests.push(init.method ?? "GET");
      return new Response(`{${bodyMarker}`, { headers: { "Content-Type": "application/json" } });
    } });
    const frames = await run({ name, args: name === "cancel" ? [RUN.id] : [] });
    const failure = frames.at(-1);
    assert.equal(failure.code, "invalid_response");
    assert.equal(failure.outcome, name === "cancel" ? "unknown" : "refused");
    assert.equal(failure.exit_code, 1);
    assert.ok(!JSON.stringify(frames).includes(bodyMarker));
    assert.match(failure.message, /unreadable response/);
    assert.deepEqual(requests, [name === "cancel" ? "POST" : "GET"]);
  }
});

test("authoritative mutation refusals keep their reason and refused outcome", async (t) => {
  const { run } = harness(t, { fetcher: async () => new Response(JSON.stringify({ error: "revision conflict" }), { status: 409, headers: { "Content-Type": "application/json" } }) });
  const frames = await run({ name: "cancel", args: [RUN.id] });
  assert.equal(frames.at(-1).outcome, "refused");
  assert.match(frames.at(-1).message, /revision conflict/);
});

test("document prompts and explicit stdin documents preserve exact prompt bodies", async (t) => {
  for (const explicit of [true, false]) {
    const text = "line one\nline two\t☾";
    const { run, requests } = harness(t, { answer: () => text });
    const frames = await run({ name: "save-prompt", args: ["walkthrough", "greeting", "-"], flags: { "expected-version": "2", key: "stable" }, ...(explicit ? { stdin_document: text } : {}) });
    assert.equal(frames.at(-1).event, "result");
    assert.equal(frames.some((frame) => frame.kind === "document"), !explicit);
    assert.deepEqual(JSON.parse(requests.find((request) => request.method === "POST").body), { idempotency_key: "stable", name: "greeting", body: text, expected_version: 2 });
  }
});

test("repeated criteria, booleans and expected revisions retain their bodies", async (t) => {
  const { run, requests } = harness(t);
  await run({ name: "edit-ticket", args: ["ticket-1"], flags: { revision: "7", criterion: ["first", "second"], title: "New" } });
  assert.deepEqual(JSON.parse(requests.find((request) => request.method === "PUT").body), { expected_revision: 7, title: "New", acceptance_criteria: ["first", "second"] });
  await run({ name: "validate", args: ["run-1"], flags: { "auto-repair": false, "candidate-hash": HASH } });
  assert.equal(JSON.parse(requests.find((request) => request.pathname.endsWith("/validate")).body).auto_repair, false);
});

test("multi-repository registration and graph planning retain shared builder shapes", async (t) => {
  const { run, requests } = harness(t);
  assert.equal((await run({ name: "register", args: ["Walkthrough", "app", "/srv/app"], flags: { id: "walkthrough", repository: ["web=/srv/web", "shared=/srv/shared"] } })).at(-1).event, "result");
  assert.deepEqual(JSON.parse(requests.find((request) => request.method === "POST").body), { name: "Walkthrough", id: "walkthrough", repositories: [{ id: "app", path: "/srv/app" }, { id: "web", path: "/srv/web" }, { id: "shared", path: "/srv/shared" }] });
  assert.equal((await run({ name: "plan", args: ["ticket-1"], flags: { task: ["shared=lib", "api=src>shared"], workers: "2", attempts: "3", key: "stable" } })).at(-1).event, "result");
  assert.deepEqual(JSON.parse(requests.find((request) => request.method === "POST" && request.pathname.endsWith("/plans")).body), {
    tasks: [{ id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read", "write"] }, { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"] }],
    budgets: { max_attempts: 3, max_workers: 2 }, idempotency_key: "stable",
  });
});

test("memory correction and scope retention preserve exact hash and null semantics", async (t) => {
  const { run, requests } = harness(t);
  await run({ name: "correct-memory", args: ["walkthrough", "mem-1", HASH, "Use pytest"], flags: { key: "memory-key" } });
  assert.deepEqual(JSON.parse(requests.find((request) => request.pathname.endsWith("/memory/mem-1")).body), { idempotency_key: "memory-key", expected_hash: HASH, content: "Use pytest" });
  await run({ name: "set-retention", args: ["walkthrough"], flags: { "process-days": "30", "project-days": "none" } });
  assert.deepEqual(JSON.parse(requests.find((request) => request.pathname.endsWith("/memory/retention")).body), { process_max_age_days: 30, project_max_age_days: null });
});

test("plan output chunks preserve Unicode scalar boundaries and stay below 64 KiB", async (t) => {
  const plan = { ...PLAN, description: "🌙".repeat(24000) };
  const { run } = harness(t, { answer: () => "", fetcher: async () => json(plan) });
  const frames = await run({ name: "approve", args: ["plan-1"] });
  const output = frames.filter((frame) => frame.event === "output");
  assert.ok(output.length > 1);
  for (const frame of output) {
    assert.ok(Buffer.byteLength(JSON.stringify(frame)) < LIMITS.text);
    assert.ok(frame.text.isWellFormed());
  }
  assert.ok(output.map((frame) => frame.text).join("").includes(JSON.stringify(plan, null, 2)));
});

test("file export adapter writes the complete result without treating a path as shell code", async (t) => {
  const writes = [];
  const exported = { omitted: [], tickets: [], memory: [], prompts: [] };
  const { run } = harness(t, { fetcher: async () => json(exported), writeFile: (...args) => writes.push(args) });
  const frames = await run({ name: "export", args: ["walkthrough"], flags: { output: "space & $(literal).json" } });
  assert.equal(frames.at(-1).event, "result");
  assert.deepEqual(writes, [["space & $(literal).json", `${JSON.stringify(exported, null, 2)}\n`]]);
});

test("SSE records and final authoritative state cross distinct event/result frames", async (t) => {
  const { run, requests } = harness(t);
  const frames = await run({ name: "follow", args: ["run-1"], flags: { after: "0" } });
  assert.deepEqual(frames.find((frame) => frame.event === "event").record, EVENT);
  assert.equal(frames.at(-1).value.state, "completed");
  assert.equal(requests.find((request) => request.pathname.endsWith("/stream")).headers.get("Accept"), "text/event-stream");
});

test("stale/wrong prompt answers are rejected; abort invalidates prompt without runtime cancellation", async (t) => {
  const { bridge, frames, requests } = harness(t, { answer: false });
  const pending = bridge.dispatch({ v: 1, id: "approval", op: "invoke", name: "approve", args: ["plan-1"] });
  await new Promise((resolve) => setImmediate(resolve));
  const prompt = frames.find((frame) => frame.event === "prompt");
  assert.ok(prompt);
  await bridge.dispatch({ v: 1, id: "wrong", op: "reply", request_id: "other", prompt_id: prompt.prompt_id, value: HASH });
  await bridge.dispatch({ v: 1, id: "abort", op: "abort", request_id: "approval" });
  await pending;
  await bridge.dispatch({ v: 1, id: "stale", op: "reply", request_id: "approval", prompt_id: prompt.prompt_id, value: HASH });
  await bridge.flushed();
  assert.equal(frames.find((frame) => frame.id === "wrong").code, "stale_prompt");
  assert.equal(frames.find((frame) => frame.id === "stale").code, "stale_prompt");
  assert.ok(requests.every((request) => request.method === "GET"));
  assert.equal(frames.find((frame) => frame.id === "approval" && frame.event === "error").code, "aborted");
});

test("four reads and one mutation admitted; control abort stays responsive", async (t) => {
  const fetcher = (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }); });
  const { bridge, frames } = harness(t, { fetcher });
  const pending = Array.from({ length: LIMITS.reads }, (_, index) => bridge.dispatch({ v: 1, id: `read-${index}`, op: "read", name: "projects" }));
  pending.push(bridge.dispatch({ v: 1, id: "mutation", op: "invoke", name: "cancel", args: ["run-1"] }));
  await new Promise((resolve) => setImmediate(resolve));
  await bridge.dispatch({ v: 1, id: "overflow", op: "read", name: "projects" });
  await bridge.dispatch({ v: 1, id: "overflow-mutation", op: "invoke", name: "cancel", args: ["run-2"] });
  await bridge.dispatch({ v: 1, id: "stop", op: "shutdown" });
  await Promise.all(pending);
  await bridge.flushed();
  assert.equal(frames.find((frame) => frame.id === "overflow").code, "busy");
  assert.equal(frames.find((frame) => frame.id === "overflow-mutation").code, "busy");
  assert.equal(frames.find((frame) => frame.id === "stop").event, "result");
  assert.equal(frames.find((frame) => frame.id === "mutation").outcome, "unknown");
});

test("token strings are redacted after JSON escaping; display control sequences cannot reach terminal", async (t) => {
  const token = 'private"\\secret';
  const { run } = harness(t, { env: { LUUNA_API_TOKEN: token }, fetcher: async () => json({ detail: `${token}\x1b]52;c;clipboard\x07\x1b[31mbad\x00` }) });
  const frames = await run({ name: "propose-scaffold", args: ["python", "fresh", "/srv"] });
  assert.ok(!JSON.stringify(frames).includes(JSON.stringify(token).slice(1, -1)));
  assert.equal(frames.at(-1).value.detail.startsWith("[redacted]"), true);
  assert.ok(!frames.at(-1).formatted.includes(JSON.stringify(token).slice(1, -1)));
  assert.ok(!/[\x1b\x00\x07]/.test(frames.at(-1).formatted));
});

test("oversized results report completed execution rather than returning partial JSON", async (t) => {
  const { run } = harness(t, { fetcher: async () => json({ text: "x".repeat(LIMITS.frame) }) });
  const frames = await run({ name: "propose-scaffold", args: ["python", "fresh", "/srv"] });
  assert.equal(frames.at(-1).code, "result_too_large");
  assert.equal(frames.at(-1).outcome, "completed");
});

test("malformed envelopes, unsupported versions and unexpected fields are rejected", async (t) => {
  const { bridge, frames } = harness(t);
  for (const request of [null, { v: 2, id: "x", op: "catalog" }, { v: 1, id: "x", op: "shell" }, { v: 1, id: "x", op: "catalog", token: "no" }]) await bridge.dispatch(request);
  await bridge.flushed();
  assert.equal(frames.length, 4);
  assert.ok(frames.every((frame) => frame.event === "error"));
});

test("loopback validation refuses an external endpoint before a credential-bearing fetch", async (t) => {
  let calls = 0;
  const { run } = harness(t, { env: { LUUNA_URL: "https://example.com", LUUNA_API_TOKEN: "fixture-secret" }, fetcher: async () => { calls++; return json({}); } });
  assert.equal((await run({ name: "health" })).at(-1).event, "error");
  assert.equal(calls, 0);
});

test("usage errors from command bodies retain exit code 2", async (t) => {
  const { run } = harness(t);
  const frames = await run({ name: "remember", args: ["walkthrough", "bad-scope", "content", "provenance"] });
  assert.equal(frames.at(-1).exit_code, 2);
});

test("health publishes outage/recovery once per transition and bounds outstanding polling", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  let available = false;
  let calls = 0;
  const { frames } = harness(t, { fetcher: async () => { calls++; if (!available) throw new TypeError("offline"); return json({ status: "ok" }); } });
  t.mock.timers.tick(LIMITS.healthMs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frames.at(-1).state, "disconnected");
  t.mock.timers.tick(LIMITS.healthMs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frames.length, 1);
  available = true;
  t.mock.timers.tick(LIMITS.healthMs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frames.at(-1).state, "connected");
  assert.equal(calls, 3);
});

test("a hung health request times out and no simultaneous poll starts", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  let calls = 0;
  let aborted = 0;
  const { frames } = harness(t, { fetcher: (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted++; reject(new DOMException("aborted", "AbortError")); }, { once: true }));
  } });
  t.mock.timers.tick(LIMITS.healthMs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  t.mock.timers.tick(LIMITS.healthMs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(aborted, 1);
  assert.equal(frames.at(-1).state, "disconnected");
});

test("duplicate outstanding ids cannot launch a second action", async (t) => {
  const { bridge, frames, requests } = harness(t, { answer: false });
  const pending = bridge.dispatch({ v: 1, id: "approval", op: "invoke", name: "approve", args: ["plan-1"] });
  await new Promise((resolve) => setImmediate(resolve));
  await bridge.dispatch({ v: 1, id: "approval", op: "invoke", name: "cancel", args: ["run-1"] });
  await bridge.dispatch({ v: 1, id: "abort", op: "abort", request_id: "approval" });
  await pending;
  await bridge.flushed();
  assert.ok(frames.some((frame) => frame.code === "duplicate_id"));
  assert.equal(requests.length, 1);
});

test("aborting an SSE follower closes local stream without canceling runtime", async (t) => {
  const requests = [];
  const { bridge, frames } = harness(t, { fetcher: async (url, { signal, method = "GET" }) => {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    requests.push({ url: String(url), method });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: run_event\nid: 1\ndata: ${JSON.stringify(EVENT)}\n\n`));
      signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
    } }), { headers: { "Content-Type": "text/event-stream" } });
  } });
  const pending = bridge.dispatch({ v: 1, id: "follow", op: "read", name: "follow", args: ["run-1"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(frames.some((frame) => frame.event === "event"));
  await bridge.dispatch({ v: 1, id: "abort", op: "abort", request_id: "follow" });
  await pending;
  await bridge.flushed();
  assert.ok(requests.every((request) => request.method === "GET"));
  assert.equal(frames.find((frame) => frame.id === "follow" && frame.event === "error").outcome, "aborted");
});

test("blocked output queue stays bounded and reports backpressure once it drains", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { bridge, frames } = harness(t, { send: () => gate });
  for (let index = 0; index < LIMITS.queue + 5; index++) await bridge.dispatch({ v: 1, id: `catalog-${index}`, op: "catalog" });
  assert.equal(frames.length, 1);
  release();
  await bridge.flushed();
  assert.ok(frames.length <= LIMITS.queue);
  assert.ok(frames.some((frame) => frame.code === "output_backpressure"));
});

async function processInput(input) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/bridge.mjs", import.meta.url))], { env: { ...process.env, LUUNA_API_TOKEN: "", LUUNA_URL: "" }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { err += chunk; });
  child.stdin.on("error", () => {});
  const exited = once(child, "exit");
  const timer = setTimeout(() => child.kill(), 5000);
  child.stdin.end(input);
  await exited;
  clearTimeout(timer);
  assert.equal(err, "");
  return out.trim().split("\n").map((line) => JSON.parse(line));
}
test("executable parses split-independent JSONL and catalog without credentials", async () => {
  const frames = await processInput('{"v":1,"id":"catalog","op":"catalog"}\n{"v":1,"id":"quit","op":"shutdown"}\n');
  assert.equal(frames[0].event, "catalog");
  assert.equal(frames.at(-1).id, "quit");
});
test("executable rejects oversized and malformed frames before dispatch", async () => {
  for (const [input, code] of [["x".repeat(LIMITS.frame + 1), "frame_too_large"], ["{bad}\n", "invalid_json"], ['{"v":1}', "invalid_json"], [Buffer.from([0xff, 10]), "invalid_json"]]) {
    const frames = await processInput(input);
    assert.equal(frames.at(-1).code, code);
  }
});
