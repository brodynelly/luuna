// Parity evidence (R02, A33): every catalog entry has a TUI command, and each command issues the
// cataloged method and route against a mocked fetch. Nothing here touches a runtime.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LuunaClient } from "@luuna/api-client";
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
