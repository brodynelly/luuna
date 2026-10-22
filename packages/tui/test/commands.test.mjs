// Parity evidence (R02, A33): every catalog entry has a TUI command, and each command issues the
// cataloged method and route against a mocked fetch. Nothing here touches a runtime.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LuunaClient, planRequestForTasks } from "@luuna/api-client";
import { catalog } from "../src/catalog.mjs";
import { COMMANDS, commandsByName, usage } from "../src/commands.mjs";
import { makeIo, parseArguments, runCommand } from "../src/cli.mjs";

const HASH = `sha256:${"a".repeat(64)}`;
const PLAN = { id: "plan-1", revision: 1, ticket_id: "ticket-1", ticket_revision: 1, hash: HASH, base_commits: { app: "abc" }, tasks: [{ paths: ["src"], operations: ["read", "write"] }], budgets: { max_attempts: 2, timeout_seconds: 600, cost_usd_micros: 1_000_000 } };
const RUN = { id: "run-1", project_id: "walkthrough", state: "completed", revision: 3, metadata: { kind: "workflow" }, created_at: "2026-10-21T00:00:00Z", updated_at: "2026-10-21T00:00:00Z" };
const EVENT = { schema_version: "0.1", event_id: "e1", sequence: 1, timestamp: "2026-10-21T00:00:00Z", project_id: "walkthrough", run_id: "run-1", type: "run.completed", payload: {} };

/** A fetch double that records every request and answers with records the commands can use. */
function mockFetch({ sequence = 1 } = {}) {
  const requests = [];
  const fetcher = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const { pathname, search } = new URL(url);
    requests.push({ method, pathname, search, headers: new Headers(init.headers), body: init.body });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (/\/stream$/.test(pathname)) return new Response(`event: run_event\nid: 1\ndata: ${JSON.stringify({ ...EVENT, sequence })}\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    if (/\/artifacts\//.test(pathname)) return new Response("Ran 1 test\n\nOK\n", { status: 200, headers: { "Content-Type": "text/plain" } });
    if (/^\/api\/v1\/plans\/[^/]+$/.test(pathname)) return json(PLAN);
    if (/^\/api\/v1\/plans\/[^/]+\/approvals$/.test(pathname)) return json({ approval: { plan_id: "plan-1", plan_revision: 1, plan_hash: HASH, approved_by: "developer" }, run: { ...RUN, state: "approved" } });
    if (/^\/api\/v1\/runs\/[^/]+$/.test(pathname)) return json(RUN);
    if (/^\/api\/v1\/runs\/[^/]+\/candidate$/.test(pathname)) return json({ evidence: { candidate: { revision: 1, hash: HASH, plan_hash: HASH, repository_commits: {} }, status: "pending", results: [] }, active: false, repair_allowed: false, revalidate_allowed: false });
    if (/^\/api\/v1\/projects\/[^/]+$/.test(pathname)) return json({ project: { id: "walkthrough", name: "Walkthrough", revision: 0 }, repositories: [{ repository_id: "app", local_path: "/srv/app", observation: { identity: {}, dirty: {} } }], manifest: null, discovery: null });
    if (/^\/api\/v1\/tickets\/[^/]+$/.test(pathname)) return json({ id: "ticket-1", revision: 1, source: "luuna_sqlite_temporary", title: "t", intent: "i", acceptance_criteria: [], repository_ids: ["app"] });
    if (/\/events$/.test(pathname)) return json([]);
    return json(/plans$/.test(pathname) && method === "POST" ? { plan: PLAN, run: RUN } : {});
  };
  return { fetcher, requests };
}

function routeMatcher(route) {
  return new RegExp(`^${route.replace(/\{[a-z_]+\}/g, "[^/]+")}$`);
}

function io(overrides = {}) {
  let out = "";
  let err = "";
  const base = makeIo({ stdin: { setEncoding() {}, on() {}, resume() {} }, stdout: { write: (text) => { out += text; return true; } }, stderr: { write: (text) => { err += text; return true; } }, json: true, ...overrides });
  base.readStdin = async () => JSON.stringify({ schema_version: "0.1", id: "walkthrough" });
  base.readFile = (path) => JSON.stringify(String(path).includes("export") ? { schema_version: "0.1", kind: "luuna-project-export", export_hash: `sha256:${"b".repeat(64)}`, project: { id: "walkthrough" } } : { schema_version: "0.1", id: "walkthrough" });
  return { io: base, out: () => out, err: () => err };
}

test("every catalog entry has exactly one TUI command, and every command is cataloged", () => {
  for (const capability of catalog.capabilities) {
    const command = commandsByName.get(capability.tui);
    assert.ok(command, `${capability.id}: no TUI command named ${capability.tui}`);
    assert.equal(command.id, capability.id, `${capability.tui} implements ${command.id}, the catalog says ${capability.id}`);
    assert.ok(command.action, `${capability.id}: the command names no action label for refusals`);
    assert.ok(command.example, `${capability.id}: the command has no example for the parity test`);
    assert.ok(usage(command).startsWith(command.name));
  }
  const ids = new Set(catalog.capabilities.map((capability) => capability.id));
  assert.deepEqual(COMMANDS.filter((command) => !ids.has(command.id)).map((command) => command.name), []);
  assert.equal(new Set(COMMANDS.map((command) => command.name)).size, COMMANDS.length, "command names are unique");
  assert.equal(COMMANDS.length, catalog.capabilities.length);
});

for (const capability of catalog.capabilities) {
  test(`${capability.tui} issues ${capability.method} ${capability.route}`, async () => {
    const command = commandsByName.get(capability.tui);
    const { fetcher, requests } = mockFetch();
    const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
    const { io: context, out, err } = io();
    const code = await runCommand(command, { args: command.example.args, flags: { ...command.example.flags } }, client, context);
    assert.equal(code, 0, `${capability.tui} failed: ${err()}`);
    const matcher = routeMatcher(capability.route);
    const issued = requests.filter((request) => request.method === capability.method && matcher.test(request.pathname));
    assert.ok(issued.length >= 1, `${capability.tui} issued ${requests.map((request) => `${request.method} ${request.pathname}`).join(", ")}, not ${capability.method} ${capability.route}`);
    for (const request of requests) {
      assert.equal(request.headers.get("Authorization"), "Bearer test-token");
      assert.ok(!request.search.includes("test-token"), "the token never travels in a query string");
    }
    assert.ok(out().trim().length > 0, "a --json result is printed");
    assert.doesNotThrow(() => out().trim().split("\n").map((line) => JSON.parse(line)), "every --json line is JSON");
  });
}

test("commands reachable interactively cover every context menu", () => {
  const contexts = new Set(COMMANDS.map((command) => command.context));
  assert.deepEqual([...contexts].sort(), ["plan", "project", "run", "runtime", "ticket"]);
  for (const command of COMMANDS) {
    const contextual = command.args.filter((arg) => arg.context).map((arg) => arg.name);
    if (command.context !== "runtime") assert.deepEqual(contextual, [command.context], `${command.name} takes its ${command.context} from the selection`);
    for (const arg of command.args) if (!arg.context) assert.ok(arg.prompt, `${command.name}: argument ${arg.name} needs a prompt for the interactive mode`);
  }
});

test("argument parsing: positionals, values, repeated and boolean flags, --json", () => {
  const command = commandsByName.get("create-ticket");
  const parsed = parseArguments(["walkthrough", "--title", "T", "--criterion", "a", "--criterion=b", "--json", "--repository", "app"], command);
  assert.deepEqual(parsed, { args: ["walkthrough"], flags: { title: "T", criterion: ["a", "b"], json: true, repository: "app" } });
  assert.throws(() => parseArguments(["--bogus", "x"], command), /Unknown option --bogus/);
  assert.throws(() => parseArguments(["--title"], command), /needs a value/);
  assert.deepEqual(parseArguments(["r1", "--auto-repair"], commandsByName.get("validate")).flags, { "auto-repair": true });
});

test("follow streams through the SSE route with Last-Event-ID resumption and prints each event", async () => {
  const { fetcher, requests } = mockFetch();
  const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
  const { io: context, out } = io();
  const code = await runCommand(commandsByName.get("follow"), { args: ["run-1"], flags: { after: "0" } }, client, context);
  assert.equal(code, 0);
  const stream = requests.find((request) => request.pathname.endsWith("/stream"));
  assert.equal(stream.headers.get("Accept"), "text/event-stream");
  const lines = out().trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines[0].sequence, 1);
  assert.deepEqual(lines.at(-1), { run_id: "run-1", state: "completed", last_sequence: 1, events_followed: 1 });
  // Resuming after sequence 7 sends Last-Event-ID.
  const resumed = mockFetch({ sequence: 8 });
  const resumedClient = new LuunaClient("http://127.0.0.1:4242", "test-token", resumed.fetcher);
  assert.equal(await runCommand(commandsByName.get("follow"), { args: ["run-1"], flags: { after: "7" } }, resumedClient, io().io), 0);
  assert.equal(resumed.requests.find((request) => request.pathname.endsWith("/stream")).headers.get("Last-Event-ID"), "7");
});

// ---- Behaviour-level parity (R02, A33): the bodies the TUI sends for multi-repository registration,
// a task graph with workers, a task-specific resume and a ticket edit, the same the desktop builds. ----
function sentBody(requests, method, suffix) {
  const request = requests.find((item) => item.method === method && item.pathname.endsWith(suffix));
  assert.ok(request, `no ${method} …${suffix} among ${requests.map((item) => `${item.method} ${item.pathname}`).join(", ")}`);
  return JSON.parse(request.body);
}
async function run(name, args, flags, fetcher = mockFetch()) {
  const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher.fetcher);
  const { io: context, err } = io();
  const code = await runCommand(commandsByName.get(name), { args, flags }, client, context);
  return { code, requests: fetcher.requests, err: err() };
}

test("register sends every repository: the positional one and each repeated --repository <id>=<path>", async () => {
  const { code, requests } = await run("register", ["Walkthrough", "app", "/srv/app"], { id: "walkthrough", repository: ["web=/srv/web", "shared=/srv/shared"] });
  assert.equal(code, 0);
  assert.deepEqual(sentBody(requests, "POST", "/api/v1/projects"), { name: "Walkthrough", id: "walkthrough", repositories: [{ id: "app", path: "/srv/app" }, { id: "web", path: "/srv/web" }, { id: "shared", path: "/srv/shared" }] });
  const single = await run("register", ["Walkthrough", "app", "/srv/app"], {});
  assert.deepEqual(sentBody(single.requests, "POST", "/api/v1/projects"), { name: "Walkthrough", repositories: [{ id: "app", path: "/srv/app" }] });
  const malformed = await run("register", ["Walkthrough", "app", "/srv/app"], { repository: ["web"] });
  assert.equal(malformed.code, 2);
  const duplicate = await run("register", ["Walkthrough", "app", "/srv/app"], { repository: ["app=/srv/other"] });
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.err, /unique/);
  assert.ok(!duplicate.requests.some((request) => request.method === "POST"), "nothing is sent for a refused registration");
});

test("plan sends the task graph with dependencies and max_workers exactly as the shared builder shapes it", async () => {
  const { code, requests } = await run("plan", ["ticket-1"], { task: ["shared=lib", "api=src>shared", "consumer=src,tests>shared,api"], workers: "2", attempts: "3", key: "k4" });
  assert.equal(code, 0);
  const body = sentBody(requests, "POST", "/plans");
  assert.deepEqual(body, {
    tasks: [
      { id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read", "write"] },
      { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"] },
      { id: "consumer", repository_id: "consumer", paths: ["src", "tests"], operations: ["read", "write"], depends_on: ["shared", "api"] },
    ],
    budgets: { max_attempts: 3, max_workers: 2 },
    idempotency_key: "k4",
  });
  assert.deepEqual(body, { ...planRequestForTasks([
    { id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read", "write"] },
    { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"] },
    { id: "consumer", repository_id: "consumer", paths: ["src", "tests"], operations: ["read", "write"], depends_on: ["shared", "api"] },
  ], { max_attempts: 3, max_workers: 2 }), idempotency_key: "k4" });
  // The single-task form keeps its pre-M4 shape: no id, no tasks list, no max_workers.
  const single = await run("plan", ["ticket-1"], { repository: "app", path: ["src"], attempts: "2", key: "k5" });
  assert.deepEqual(sentBody(single.requests, "POST", "/plans"), { task: { repository_id: "app", paths: ["src"], operations: ["read", "write"] }, budgets: { max_attempts: 2 }, idempotency_key: "k5" });
  // A graph the runtime would refuse is refused before anything is sent.
  const cyclic = await run("plan", ["ticket-1"], { task: ["a=src>zzz", "b=src"] });
  assert.equal(cyclic.code, 1);
  assert.match(cyclic.err, /not a task of this plan/);
  assert.ok(!cyclic.requests.some((request) => request.method === "POST"));
  const tooMany = await run("plan", ["ticket-1"], { task: ["a=src", "b=src"], workers: "3" });
  assert.equal(tooMany.code, 1);
  assert.match(tooMany.err, /between 1 and 2/);
});

test("implement --task resumes one task of the graph under the original approval", async () => {
  const { code, requests } = await run("implement", ["run-1"], { task: "consumer", provider: "test", model: "synthetic" });
  assert.equal(code, 0);
  assert.deepEqual(sentBody(requests, "POST", "/implement"), { task_id: "consumer", provider: "test", model: "synthetic" });
  const whole = await run("implement", ["run-1"], {});
  assert.deepEqual(sentBody(whole.requests, "POST", "/implement"), {});
});

test("edit-ticket sends only the named fields at the revision the client read, and refuses an empty edit", async () => {
  const { code, requests } = await run("edit-ticket", ["ticket-1"], { intent: "Print a different greeting", criterion: ["prints it", " "], repository: ["app", "web"] });
  assert.equal(code, 0);
  assert.deepEqual(sentBody(requests, "PUT", "/api/v1/tickets/ticket-1"), { expected_revision: 1, intent: "Print a different greeting", acceptance_criteria: ["prints it"], repository_ids: ["app", "web"] });
  assert.ok(requests.some((request) => request.method === "GET" && request.pathname === "/api/v1/tickets/ticket-1"), "the revision is read from the ticket when not given");
  const explicit = await run("edit-ticket", ["ticket-1"], { title: "Edited", revision: "4" });
  assert.deepEqual(sentBody(explicit.requests, "PUT", "/api/v1/tickets/ticket-1"), { expected_revision: 4, title: "Edited" });
  assert.ok(!explicit.requests.some((request) => request.method === "GET"), "an explicit revision is not re-read");
  const empty = await run("edit-ticket", ["ticket-1"], {});
  assert.equal(empty.code, 2);
  const blank = await run("edit-ticket", ["ticket-1"], { title: "  " });
  assert.equal(blank.code, 2);
  assert.ok(!blank.requests.some((request) => request.method === "PUT"));
});

test("baseline targets the named repository and baselines lists every repository's records", async () => {
  const { requests } = await run("baseline", ["walkthrough", "web"], { "include-optional": true });
  assert.deepEqual(sentBody(requests, "POST", "/baselines"), { repository_id: "web", include_optional: true });
  const listed = await run("baselines", ["walkthrough"], {});
  assert.ok(listed.requests.some((request) => request.method === "GET" && request.pathname === "/api/v1/projects/walkthrough/baselines"));
});

test("set-retention sends null for a scope that keeps its records and refuses an out-of-range limit", async () => {
  const { requests } = await run("set-retention", ["walkthrough"], { "process-days": "30", "project-days": "none" });
  assert.deepEqual(sentBody(requests, "PUT", "/memory/retention"), { process_max_age_days: 30, project_max_age_days: null });
  const tooLong = await run("set-retention", ["walkthrough"], { "process-days": "4000" });
  assert.equal(tooLong.code, 2);
  const correction = await run("correct-memory", ["walkthrough", "mem-1", HASH, "Tests use pytest"], { key: "k12" });
  assert.deepEqual(sentBody(correction.requests, "PUT", "/memory/mem-1"), { idempotency_key: "k12", expected_hash: HASH, content: "Tests use pytest" });
});
