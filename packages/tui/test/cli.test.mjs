// The non-interactive mode's contract: connection from the environment, one refusal sentence per
// failed action (never a server body), usage errors, and the full-hash approval acknowledgment.
import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../src/cli.mjs";

const HASH = `sha256:${"b".repeat(64)}`;
const PLAN = { id: "plan-1", revision: 2, ticket_id: "t", ticket_revision: 1, hash: HASH, base_commits: {}, tasks: [{ paths: ["src"], operations: ["read"] }], budgets: { max_attempts: 1, timeout_seconds: 1, cost_usd_micros: 1 } };

function streams() {
  let out = "";
  let err = "";
  return {
    stdin: { isTTY: false, setEncoding() {}, on() {}, resume() {} },
    stdout: { write: (text) => { out += text; return true; } },
    stderr: { write: (text) => { err += text; return true; } },
    out: () => out,
    err: () => err,
  };
}

async function run(argv, fetcher, env = { LUUNA_URL: "http://127.0.0.1:4242", LUUNA_API_TOKEN: "secret-token" }) {
  const io = streams();
  const code = await main(argv, { env, fetcher, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr });
  return { code, out: io.out(), err: io.err() };
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("a missing token is a usage error; the token itself is never printed", async () => {
  const result = await run(["health"], async () => json({}), { LUUNA_URL: "http://127.0.0.1:4242" });
  assert.equal(result.code, 2);
  assert.match(result.err, /LUUNA_API_TOKEN/);
  const ok = await run(["health"], async (_url, init) => { assert.equal(new Headers(init.headers).get("Authorization"), "Bearer secret-token"); return json({ status: "ok", pi_version: "1.3.0" }); });
  assert.equal(ok.code, 0);
  assert.ok(!ok.out.includes("secret-token") && !ok.err.includes("secret-token"));
});

test("transport failures and 5xx are plain sentences without server bodies", async () => {
  const down = await run(["health"], async () => { throw new TypeError("fetch failed"); });
  assert.equal(down.code, 1);
  assert.match(down.err, /^Connection refused: The runtime did not answer\./);
  const internal = await run(["projects"], async () => new Response("<html>stack trace with /secret/path</html>", { status: 500 }));
  assert.equal(internal.code, 1);
  assert.match(internal.err, /^Project listing refused: The runtime reported an internal error \(HTTP 500\)\./);
  assert.ok(!internal.err.includes("stack trace"));
  const rejected = await run(["projects"], async () => new Response("", { status: 401 }));
  assert.match(rejected.err, /rejected this token/);
  assert.match(rejected.err, /LUUNA_API_TOKEN/);
});

test("a runtime refusal shows the action, the runtime's reason and the shared next step", async () => {
  const refused = await run(["implement", "run-1"], async () => json({ error: "repository app already has an active writer; one writer per repository" }, 409));
  assert.equal(refused.code, 1);
  assert.match(refused.err, /^Implementation refused: repository app already has an active writer; one writer per repository Another workflow.s writer holds this repository. Wait for it to settle/);
  const withJson = await run(["implement", "run-1", "--json"], async () => json({ error: "workflow already has active work" }, 409));
  assert.deepEqual(JSON.parse(withJson.out), { error: "Implementation refused: workflow already has active work Wait for the active work to finish, or cancel it, then act on the settled state." });
});

test("approval needs the complete plan hash: missing is a usage error naming the hash, a wrong hash is refused, the exact hash is sent", async () => {
  const requests = [];
  const fetcher = async (url, init = {}) => { requests.push({ url: String(url), method: init.method ?? "GET", body: init.body }); return String(url).endsWith("/approvals") ? json({ approval: { plan_id: "plan-1", plan_revision: 2, plan_hash: HASH, approved_by: "developer" }, run: { id: "run-1", state: "approved", metadata: {} } }) : json(PLAN); };
  const missing = await run(["approve", "plan-1"], fetcher);
  assert.equal(missing.code, 2);
  assert.ok(missing.err.includes(`--acknowledge-hash ${HASH}`), missing.err);
  const wrong = await run(["approve", "plan-1", "--acknowledge-hash", `sha256:${"c".repeat(64)}`], fetcher);
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /^Approval refused: The acknowledged hash does not match plan plan-1 r2/);
  assert.ok(!requests.some((request) => request.url.endsWith("/approvals")), "no approval was sent for a mismatched hash");
  const right = await run(["approve", "plan-1", "--acknowledge-hash", HASH, "--approved-by", "dev"], fetcher);
  assert.equal(right.code, 0, right.err);
  const sent = requests.find((request) => request.url.endsWith("/approvals"));
  assert.deepEqual(JSON.parse(sent.body), { plan_revision: 2, plan_hash: HASH, approved_by: "dev" });
  assert.match(right.out, /Approved plan plan-1 r2 by developer/);
});

test("usage errors name the command's usage; unknown commands point at help", async () => {
  const few = await run(["artifact", "run-1"], async () => json({}));
  assert.equal(few.code, 2);
  assert.match(few.err, /artifact needs 2 argument\(s\)\. Usage: artifact <run> <artifact-id>/);
  const unknown = await run(["frobnicate"], async () => json({}));
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /Unknown command frobnicate/);
  const nothing = await run([], async () => json({}));
  assert.equal(nothing.code, 2);
  assert.match(nothing.out, /luuna-tui <command>/);
});

test("the service URL must be a loopback address", async () => {
  const remote = await run(["health"], async () => json({}), { LUUNA_URL: "http://example.com", LUUNA_API_TOKEN: "t" });
  assert.equal(remote.code, 1);
  assert.match(remote.err, /loopback/);
});
