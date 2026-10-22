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

// ---- ADR 0022: the testing-setup prerequisite through the terminal client. ----
test("create-ticket sends purpose testing_setup only when asked, and refuses another purpose", async () => {
  const setup = await run("create-ticket", ["walkthrough"], { title: "Establish tests", intent: "Add a harness", criterion: ["python -m unittest counts one test"], repository: "app", purpose: "testing_setup", key: "k20" });
  assert.equal(setup.code, 0, setup.err);
  assert.deepEqual(sentBody(setup.requests, "POST", "/tickets"), { idempotency_key: "k20", title: "Establish tests", intent: "Add a harness", acceptance_criteria: ["python -m unittest counts one test"], repository_ids: ["app"], purpose: "testing_setup" });
  const feature = await run("create-ticket", ["walkthrough"], { title: "T", intent: "I", criterion: ["c"], repository: "app", key: "k21" });
  assert.ok(!("purpose" in sentBody(feature.requests, "POST", "/tickets")), "a feature ticket omits the default purpose");
  const other = await run("create-ticket", ["walkthrough"], { title: "T", intent: "I", criterion: ["c"], repository: "app", purpose: "cleanup" });
  assert.equal(other.code, 2);
});

test("plan --check and --checks send the setup recipes in the manifest-check shape through the shared builder", async () => {
  const { code, requests, err } = await run("plan", ["ticket-1"], { repository: "app", path: ["tests"], check: ["unit=python,-m,unittest@120", "lint=ruff"], key: "k22" });
  assert.equal(code, 0, err);
  assert.deepEqual(sentBody(requests, "POST", "/plans"), { task: { repository_id: "app", paths: ["tests"], operations: ["read", "write"] }, checks: [{ id: "unit", executable: "python", args: ["-m", "unittest"], timeout_seconds: 120, capabilities: [], required: true }, { id: "lint", executable: "ruff", args: [], timeout_seconds: 600, capabilities: [], required: true }], idempotency_key: "k22" });
  const fetcher = mockFetch();
  const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher.fetcher);
  const { io: context } = io();
  context.readFile = () => JSON.stringify([{ id: "unit", executable: "python", args: ["-m", "unittest"], cwd: "src", timeout_seconds: 90, capabilities: ["shell"] }]);
  assert.equal(await runCommand(commandsByName.get("plan"), { args: ["ticket-1"], flags: { repository: "app", checks: "checks.json", key: "k23" } }, client, context), 0);
  assert.deepEqual(sentBody(fetcher.requests, "POST", "/plans").checks, [{ id: "unit", executable: "python", args: ["-m", "unittest"], cwd: "src", timeout_seconds: 90, capabilities: ["shell"], required: true }]);
  const malformed = await run("plan", ["ticket-1"], { repository: "app", check: ["unit"] });
  assert.equal(malformed.code, 2);
  const twoTasks = await run("plan", ["ticket-1"], { task: ["app=src", "web=src"], check: ["unit=python"] });
  assert.equal(twoTasks.code, 1);
  assert.match(twoTasks.err, /exactly one task/);
  assert.ok(!twoTasks.requests.some((request) => request.method === "POST"));
});

test("candidate prints the testing-setup handoff with the runtime's next step, and baselines print the offer", async () => {
  const handoff = { kind: "testing_setup", repository_id: "app", checks: [{ id: "unit", executable: "python", args: ["-m", "unittest"], required: true, timeout_seconds: 120, capabilities: [], cwd: "." }], candidate_commit: "c".repeat(40), reviewed: true, next: "the setup candidate passed its checks and review: merge it into the developer checkout of repository app, then PUT /api/v1/projects/walkthrough/manifest with the next revision listing these checks" };
  const offer = { kind: "testing_setup", project_id: "walkthrough", repository_id: "app", baseline_id: "b1", reason: "the manifest names no required check for repository app", next: "POST /api/v1/projects/walkthrough/tickets with purpose testing_setup" };
  const fetcher = async (url) => {
    const { pathname } = new URL(url);
    const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    if (pathname.endsWith("/candidate")) return json({ evidence: { candidate: { revision: 1, hash: HASH, plan_hash: HASH, repository_commits: { app: "c".repeat(40) } }, status: "reviewed", results: [], review: { verdict: "passed", findings: [], reviewer_session: "r1" } }, active: false, repair_allowed: false, revalidate_allowed: false, prerequisite: handoff });
    if (pathname.endsWith("/baselines")) return json([{ id: "b1", run_id: "run-b", manifest_revision: 1, identity: { commit: "d".repeat(40), repository_id: "app" }, status: "blocked", required_checks: [], results: [], reason: "no required check", prerequisite: offer }]);
    return json({});
  };
  const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
  const { io: context, out } = io({ json: false });
  assert.equal(await runCommand(commandsByName.get("candidate"), { args: ["run-1"], flags: {} }, client, context), 0);
  assert.match(out(), /testing setup for app: reviewed with a passed verdict/);
  assert.match(out(), /unit: python -m unittest/);
  assert.ok(out().includes(`next: ${handoff.next}`), out());
  const listed = io({ json: false });
  assert.equal(await runCommand(commandsByName.get("baselines"), { args: ["walkthrough"], flags: {} }, client, listed.io), 0);
  assert.ok(listed.out().includes(`testing setup needed for app: ${offer.reason}`), listed.out());
  assert.ok(listed.out().includes(`next: ${offer.next}`));
});

// ---- ADR 0023: roles, derivation, overrides and the trace through the terminal client. ----
test("plan --task carries role= and derived_from=, --role the single task's, and --override the plan's dependency overrides", async () => {
  const graph = await run("plan", ["ticket-1"], { task: ["shared=lib;role=repository_lead", "api=src>shared;derived_from=orchestrate", "consumer=src>api"], override: ["consumer:api:waive:the consumer pins the published package"], workers: "2", key: "k24" });
  assert.equal(graph.code, 0, graph.err);
  assert.deepEqual(sentBody(graph.requests, "POST", "/plans"), {
    tasks: [
      { id: "shared", repository_id: "shared", paths: ["lib"], operations: ["read"], role: "repository_lead" },
      { id: "api", repository_id: "api", paths: ["src"], operations: ["read", "write"], depends_on: ["shared"], derived_from_task: "orchestrate" },
      { id: "consumer", repository_id: "consumer", paths: ["src"], operations: ["read", "write"], depends_on: ["api"] },
    ],
    dependency_overrides: [{ consumer: "consumer", producer: "api", action: "waive", justification: "the consumer pins the published package" }],
    budgets: { max_workers: 2 },
    idempotency_key: "k24",
  });
  const single = await run("plan", ["ticket-1"], { repository: "app", role: "project_orchestrator", key: "k25" });
  assert.deepEqual(sentBody(single.requests, "POST", "/plans"), { task: { repository_id: "app", paths: ["src"], operations: ["read"], role: "project_orchestrator" }, idempotency_key: "k25" });
  const derived = await run("plan", ["ticket-1"], { repository: "app", "derived-from": "orchestrate", key: "k26" });
  assert.deepEqual(sentBody(derived.requests, "POST", "/plans").task, { repository_id: "app", paths: ["src"], operations: ["read", "write"], derived_from_task: "orchestrate" });
  const badRole = await run("plan", ["ticket-1"], { task: ["app=src;role=reviewer"] });
  assert.equal(badRole.code, 1);
  assert.match(badRole.err, /unknown role/);
  const badOverride = await run("plan", ["ticket-1"], { task: ["app=src", "web=src"], override: ["app:web:skip:x"] });
  assert.equal(badOverride.code, 2);
  const unknownTask = await run("plan", ["ticket-1"], { task: ["app=src", "web=src"], override: ["app:zzz:add:x"] });
  assert.equal(unknownTask.code, 1);
  assert.ok(!unknownTask.requests.some((request) => request.method === "POST"));
});

test("tasks prints each task's assignment trace, derivation, overrides and advisory result", async () => {
  const trace = { approved_by: "developer", approval_id: "approval-1", approved_at: "2026-10-22T10:00:00Z", plan_id: "plan-1", plan_revision: 2, plan_hash: HASH };
  const tasks = [
    { run_id: "run-1", task_id: "orchestrate", repository_id: "app", role: "project_orchestrator", state: "completed", depends_on: [], assigned_by: trace, dependency_overrides: [], advisory_result: { findings: ["the API lacks a contract test"], proposed_tasks: [{ id: "api", repository_id: "api", role: "implementer", depends_on: [], paths: ["src"], acceptance_criteria: ["contract test passes"], rationale: "contract first" }], risks: ["the shared package is unpinned"] }, updated_at: "" },
    { run_id: "run-1", task_id: "consumer", repository_id: "consumer", role: "implementer", state: "failed", depends_on: ["orchestrate"], assigned_by: trace, derived_from_task: "orchestrate", dependency_overrides: [{ consumer: "consumer", producer: "shared", action: "waive", justification: "pinned package" }], reason: "scope violation", updated_at: "" },
  ];
  const fetcher = async () => new Response(JSON.stringify(tasks), { status: 200, headers: { "Content-Type": "application/json" } });
  const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
  const { io: context, out } = io({ json: false });
  assert.equal(await runCommand(commandsByName.get("tasks"), { args: ["run-1"], flags: {} }, client, context), 0);
  const text = out();
  assert.match(text, /orchestrate  completed  app · role project_orchestrator/);
  assert.ok(text.includes(`assigned by developer · approval approval-1 at 2026-10-22 10:00:00Z · plan plan-1 r2 · ${HASH}`), text);
  assert.match(text, /derived from task orchestrate/);
  assert.match(text, /dependency overrides: waive consumer <- shared \(pinned package\)/);
  assert.match(text, /advisory result: 1 finding\(s\), 1 proposed task\(s\), 1 risk\(s\)/);
  assert.match(text, /finding: the API lacks a contract test/);
  assert.match(text, /proposed task api \(api, implementer\) · paths src · contract first/);
  assert.match(text, /risk: the shared package is unpinned/);
  assert.match(text, /derived_from=orchestrate/);
});

// ---- ADR 0027 point 4: the Home summary and the Kanban projection, the same the desktop renders. ----
import { PROJECTIONS, projectionsByName } from "../src/commands.mjs";
import { boardProjection, homeSummary } from "@luuna/api-client";

function projectionFetch() {
  const requests = [];
  const offer = { kind: "testing_setup", project_id: "two", repository_id: "lib", baseline_id: "b2", reason: "the manifest names no required check for repository lib", next: "POST /api/v1/projects/two/tickets with purpose testing_setup" };
  const views = {
    one: { project: { id: "one", name: "One", revision: 2, manifest_hash: "sha256:m" }, repositories: [{ repository_id: "app", local_path: "/srv/app" }], manifest: { revision: 2, hash: "sha256:m" }, discovery: null, prerequisites: [] },
    two: { project: { id: "two", name: "Two", revision: 1, manifest_hash: "sha256:n" }, repositories: [{ repository_id: "lib", local_path: "/srv/lib" }], manifest: { revision: 1, hash: "sha256:n" }, discovery: null, prerequisites: [offer] },
  };
  const baselines = { one: [{ id: "b1", run_id: "run-b1", manifest_revision: 2, identity: { repository_id: "app", commit: "a".repeat(40) }, status: "passed", required_checks: ["unit"], results: [] }], two: [{ id: "b2", run_id: "run-b2", manifest_revision: 1, identity: { repository_id: "lib", commit: "b".repeat(40) }, status: "blocked", required_checks: [], results: [], reason: "no required check", prerequisite: offer }] };
  const tickets = { one: [{ id: "t1", project_id: "one", revision: 1, title: "Greeting", source: "luuna_sqlite_temporary", intent: "", acceptance_criteria: [], repository_ids: ["app"] }, { id: "t2", project_id: "one", revision: 1, title: "Unplanned", source: "luuna_sqlite_temporary", intent: "", acceptance_criteria: [], repository_ids: ["app"] }], two: [{ id: "t3", project_id: "two", revision: 2, title: "Establish tests", purpose: "testing_setup", source: "luuna_sqlite_temporary", intent: "", acceptance_criteria: [], repository_ids: ["lib"] }] };
  const runs = [
    { id: "run-1", project_id: "one", state: "paused", revision: 5, metadata: { kind: "workflow", ticket_id: "t1", plan_id: "plan-1", plan_revision: 2 }, created_at: "", updated_at: "2" },
    { id: "run-0", project_id: "one", state: "failed", revision: 3, metadata: { kind: "workflow", ticket_id: "t1", plan_id: "plan-1", plan_revision: 1 }, created_at: "", updated_at: "1" },
    { id: "run-3", project_id: "two", state: "approved", revision: 2, metadata: { kind: "workflow", ticket_id: "t3", plan_id: "plan-3", plan_revision: 1 }, created_at: "", updated_at: "3" },
    { id: "run-s", project_id: "one", state: "completed", revision: 2, metadata: { prompt: "hello" }, created_at: "", updated_at: "4" },
  ];
  const fetcher = async (url, init = {}) => {
    const { pathname } = new URL(url);
    requests.push(`${init.method ?? "GET"} ${pathname}`);
    const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    if (pathname === "/api/v1/projects") return json(Object.values(views).map((view) => view.project));
    if (pathname === "/api/v1/runs") return json(runs);
    const project = /^\/api\/v1\/projects\/([^/]+)(?:\/(baselines|tickets))?$/.exec(pathname);
    if (project && !project[2]) return json(views[project[1]]);
    if (project?.[2] === "baselines") return json(baselines[project[1]]);
    if (project?.[2] === "tickets") return json(tickets[project[1]]);
    return json({});
  };
  return { fetcher, requests, expected: { views: Object.values(views), baselines, tickets, runs } };
}

test("home and board are projections over cataloged read actions, reachable by name but not cataloged as actions", () => {
  assert.deepEqual(PROJECTIONS.map((command) => command.name), ["home", "board"]);
  const ids = new Set(catalog.capabilities.map((capability) => capability.id));
  for (const command of PROJECTIONS) {
    assert.equal(commandsByName.get(command.name), command);
    assert.equal(projectionsByName.get(command.name), command);
    assert.equal(command.context, "runtime");
    assert.ok(command.projects.length > 0 && command.projects.every((id) => ids.has(id)), `${command.name} projects cataloged actions only`);
    for (const id of command.projects) assert.equal(catalog.capabilities.find((capability) => capability.id === id).method, "GET", `${command.name} reads only`);
    assert.ok(!ids.has(command.id), "a projection is not a catalog action");
  }
  assert.ok(!COMMANDS.some((command) => command.name === "home" || command.name === "board"));
});

test("home prints every project's validation health and blockers, and board every column with read-only cards", async () => {
  const { fetcher, requests, expected } = projectionFetch();
  const client = new LuunaClient("http://127.0.0.1:4242", "test-token", fetcher);
  const home = io();
  assert.equal(await runCommand(commandsByName.get("home"), { args: [], flags: {} }, client, home.io), 0, home.err());
  assert.deepEqual(JSON.parse(home.out()), homeSummary({ projects: expected.views, baselines: expected.baselines, tickets: expected.tickets, runs: expected.runs }));
  assert.ok(requests.every((request) => request.startsWith("GET ")), "projections never mutate");
  const summary = JSON.parse(home.out());
  assert.deepEqual(summary.projects.map((project) => [project.id, project.repositories[0].baseline?.status ?? null, project.repositories[0].prerequisite !== null, project.tickets, project.active_workflows]), [["one", "passed", false, 2, 1], ["two", "blocked", true, 1, 1]]);
  assert.deepEqual(summary.blockers.map((blocker) => [blocker.kind, blocker.project_id, blocker.run_id ?? blocker.repository_id]), [["workflow", "one", "run-1"], ["prerequisite", "two", "lib"]]);
  const text = io({ json: false });
  assert.equal(await runCommand(commandsByName.get("home"), { args: [], flags: {} }, client, text.io), 0);
  assert.match(text.out(), /One \(one\)  manifest r2 · 2 ticket\(s\) · 1 active workflow\(s\)/);
  assert.match(text.out(), /app: baseline passed · manifest r2/);
  assert.match(text.out(), /lib: baseline blocked .* · testing setup needed/);
  assert.match(text.out(), /blockers \(2\):/);
  assert.match(text.out(), /create a ticket: create-ticket/);
  const board = io();
  assert.equal(await runCommand(commandsByName.get("board"), { args: [], flags: {} }, client, board.io), 0, board.err());
  const projection = JSON.parse(board.out());
  assert.deepEqual(projection, boardProjection({ projects: expected.views, tickets: Object.values(expected.tickets).flat(), runs: expected.runs }));
  assert.deepEqual(projection.columns.map(({ column, cards }) => [column.id, cards.map((card) => card.ticket_id ?? card.repository_id)]), [["backlog", ["t2"]], ["testing_prerequisite", ["lib"]], ["plan", []], ["approval", []], ["implementation", ["t3"]], ["checks", []], ["review", ["t1"]], ["prs", []]]);
  assert.equal(projection.columns[6].cards[0].plan_revision, 2, "a ticket sits in the column of its latest plan revision's run");
  assert.match(projection.note, /dragging a card is not implemented/);
  const filtered = io();
  assert.equal(await runCommand(commandsByName.get("board"), { args: [], flags: { project: "two" } }, client, filtered.io), 0);
  assert.deepEqual(JSON.parse(filtered.out()).columns.flatMap(({ cards }) => cards.map((card) => card.project_id)), ["two", "two"]);
  const missing = io();
  assert.equal(await runCommand(commandsByName.get("board"), { args: [], flags: { project: "none" } }, client, missing.io), 1);
  const rendered = io({ json: false });
  assert.equal(await runCommand(commandsByName.get("board"), { args: [], flags: {} }, client, rendered.io), 0);
  assert.match(rendered.out(), /Review \(1\)/);
  assert.match(rendered.out(), /\[ticket\] Greeting · one · t1 r1 · run run-1 paused \(plan r2\)/);
  assert.match(rendered.out(), /\[prerequisite\] Testing setup needed for lib · two/);
  assert.match(rendered.out(), /\[ticket\] Establish tests · two · t3 r2 · testing setup · run run-3 approved/);
});

// ---- ADR 0027 point 4: settings are the runtime's doctor report, printed as the CLI subcommand prints it. ----
test("doctor prints the runtime's doctor table exactly as luuna-runtime doctor does, naming credentials without values", async () => {
  const report = { ok: false, items: [
    { name: "git", required: true, status: "ok", detail: "git version 2.55.0" },
    { name: "api_token", required: false, status: "ok", detail: "LUUNA_API_TOKEN is configured (value not shown)" },
    { name: "provider_credentials", required: false, status: "warning", detail: "set but empty: ANTHROPIC_API_KEY (an empty variable configures nothing); no provider credential carries a value (model runs fail until one does)" },
    { name: "port", required: false, status: "ok", detail: "this runtime is the one listening on http://127.0.0.1:4242" },
    { name: "pi", required: true, status: "missing", detail: "unsupported Pi version; expected 1.3.0" },
  ] };
  const requests = [];
  const fetcher = async (url, init = {}) => { requests.push(`${init.method ?? "GET"} ${new URL(url).pathname}`); return new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } }); };
  const client = new LuunaClient("http://127.0.0.1:4242", "test-token-never-printed", fetcher);
  const { io: context, out } = io({ json: false });
  assert.equal(await runCommand(commandsByName.get("doctor"), { args: [], flags: {} }, client, context), 0);
  assert.deepEqual(requests, ["GET /api/v1/doctor"]);
  assert.equal(out(), [
    "ok       git                  git version 2.55.0 (required)",
    "ok       api_token            LUUNA_API_TOKEN is configured (value not shown)",
    "warning  provider_credentials set but empty: ANTHROPIC_API_KEY (an empty variable configures nothing); no provider credential carries a value (model runs fail until one does)",
    "ok       port                 this runtime is the one listening on http://127.0.0.1:4242",
    "missing  pi                   unsupported Pi version; expected 1.3.0 (required)",
    "doctor: FAILED",
    "",
  ].join("\n"));
  assert.ok(!out().includes("test-token-never-printed"));
  const asJson = io({ json: true });
  assert.equal(await runCommand(commandsByName.get("doctor"), { args: [], flags: {} }, client, asJson.io), 0);
  assert.deepEqual(JSON.parse(asJson.out()), report, "--json prints the runtime's report unchanged");
  const command = commandsByName.get("doctor");
  assert.equal(command.context, "runtime", "doctor is listed in the runtime menu of the interactive workbench");
});
