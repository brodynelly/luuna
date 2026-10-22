#!/usr/bin/env node
// Luuna TUI parity smoke: drives the terminal client's non-interactive mode
// (`node packages/tui/bin/luuna-tui.mjs <command> --json`) against a built runtime and the
// SYNTHETIC Pi fixture through the documented walkthrough (docs/MVP-WALKTHROUGH.md), exactly as
// scripts/mvp-ui-smoke.mjs drives the browser client, and asserts that the TUI reports the same
// authoritative states the runtime's API shows (R02, A19, A33). Client and lifecycle evidence
// only, never provider evidence: no model is called.
//
//   node scripts/tui-smoke.mjs [--out <dir>] [--runtime <built luuna-runtime>] [--keep]
//
// Requirements: the pinned toolchains (cargo unless --runtime is given, Node, python3, git) and
// `npm ci` done at the root. Exit code 1 when any check fails.
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => arg.startsWith("--") ? [arg.slice(2), all[index + 1]?.startsWith("--") || all[index + 1] === undefined ? true : all[index + 1]] : []).filter((pair) => pair.length));
const started = new Date();
const out = path.resolve(options.out ?? path.join(tmpdir(), `luuna-tui-smoke-${started.toISOString().replace(/[:.]/g, "-")}`));
if (existsSync(out)) { console.error(`Refusing to reuse ${out}; pass a new --out directory.`); process.exit(2); }
mkdirSync(out, { recursive: true });
// Worktree paths nest under --out; Git on Windows refuses very long ones ("$GIT_DIR too big").
if (process.platform === "win32" && out.length > 120) console.warn(`warning: --out ${out} is ${out.length} characters long; Git may refuse the runtime's worktree paths beneath it. Prefer a short directory such as %TEMP%\luuna-tui-smoke.`);
const python = process.platform === "win32" ? "python" : "python3";
const token = randomBytes(32).toString("hex");
const tuiBin = path.join(repository, "packages", "tui", "bin", "luuna-tui.mjs");
const checks = [];
const notes = [];
function record(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}
function note(text) { notes.push(text); console.log(`note  ${text}`); }

// ---------- host tools (as in scripts/mvp-ui-smoke.mjs) ----------
const devNull = process.platform === "win32" ? "NUL" : "/dev/null";
function toolEnv() {
  const keep = ["PATH", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT", "PATHEXT", "COMSPEC", "PYTHONIOENCODING"];
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => keep.includes(name)));
}
function git(cwd, ...args) {
  const noHooks = path.join(out, "no-hooks");
  mkdirSync(noHooks, { recursive: true });
  const env = { ...toolEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TEMPLATE_DIR: noHooks, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  return execFileSync("git", ["-C", cwd, "-c", `core.hooksPath=${noHooks}`, "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env, timeout: 60_000 }).trim();
}
const UNIT_TEST = `import subprocess
import sys
import unittest
from pathlib import Path


class MainTest(unittest.TestCase):
    def test_main_runs(self):
        text = Path("src/main.py").read_text()
        self.assertTrue(text.strip())
        completed = subprocess.run([sys.executable, "src/main.py"], capture_output=True, text=True, check=True)
        self.assertTrue(completed.stdout.strip())
`;
// Holds a candidate's validation for 20 s so the smoke can stop the runtime mid-check (see
// scripts/mvp-ui-smoke.mjs); the marker is untracked build output in the Luuna-owned worktree.
const HOLD_CHECK = `import time
from pathlib import Path

candidate = "implemented by" in Path("src/main.py").read_text()
marker = Path(".hold-started")
if candidate and not marker.exists():
    marker.touch()
    time.sleep(20)
print("hold check finished")
`;
function createFixture(name, withHold) {
  const dir = path.join(out, "fixtures", name);
  mkdirSync(dir, { recursive: true });
  const files = { ".gitignore": "__pycache__/\n", "README.md": `# ${name} fixture\n`, "pyproject.toml": `[project]\nname = "${name}"\n`, "src/__init__.py": "", "src/main.py": "print('fixture')\n", "test_main.py": UNIT_TEST };
  if (withHold) files["checks/hold.py"] = HOLD_CHECK;
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    writeFileSync(path.join(dir, relative), content);
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", `https://example.invalid/${name}.git`);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  return { dir, head: git(dir, "rev-parse", "HEAD") };
}
function manifest(id, name, withHold) {
  const checks = [{ id: "unit", executable: python, args: ["-m", "unittest", "-v"], required: true, timeout_seconds: 120, capabilities: ["python"], cwd: "." }];
  if (withHold) checks.push({ id: "hold", executable: python, args: ["checks/hold.py"], required: true, timeout_seconds: 120, capabilities: ["python"], cwd: "." });
  return { schema_version: "0.1", id, name, revision: 1, repositories: [{ id: "app", remote: `https://example.invalid/${id}.git`, default_branch: "main", profiles: ["python"], execution: "native", checks }], relationships: [], policy: { approval: "plan", testing_prerequisite: true, publish: "automatic_pr", merge: "human", max_explorers: 1, max_implementers: 1, max_task_repairs: 2 } };
}

// ---------- processes ----------
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
    server.on("error", reject);
  });
}
async function waitFor(predicate, timeoutMs, every = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(every);
  }
  return null;
}
let runtimeBinary = options.runtime ? path.resolve(options.runtime) : null;
if (!runtimeBinary) {
  console.log("building luuna-runtime (cargo build --locked -p luuna-runtime)…");
  execFileSync("cargo", ["build", "--locked", "-p", "luuna-runtime"], { cwd: repository, stdio: "inherit" });
  runtimeBinary = path.join(repository, "target", "debug", process.platform === "win32" ? "luuna-runtime.exe" : "luuna-runtime");
}
const runtimePort = await freePort();
const dataDir = path.join(out, "runtime-data");
const base = `http://127.0.0.1:${runtimePort}`;
let runtime = null;
let runtimeExited = null;
const runtimeLog = path.join(out, "runtime.log");
async function startRuntime(label) {
  const env = { ...toolEnv(), LUUNA_API_TOKEN: token, LUUNA_DATA_DIR: dataDir, LUUNA_PORT: String(runtimePort), LUUNA_PI_COMMAND: python, LUUNA_PI_ARGS_JSON: JSON.stringify([path.join(repository, "fixtures", "pi-rpc", "mock_pi.py")]), LUUNA_PI_PROVIDER: "test", LUUNA_PI_MODEL: "synthetic", LUUNA_RUN_TIMEOUT_SECONDS: "600" };
  const child = spawn(runtimeBinary, [], { env, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (chunk) => writeFileSync(runtimeLog, `[${label}] ${chunk}`, { flag: "a" }));
  runtimeExited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const healthy = await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), 30_000);
  if (!healthy) throw new Error(`runtime (${label}) did not become healthy`);
  runtime = child;
  return child;
}
async function killRuntime() {
  if (!runtime) return null;
  const child = runtime;
  runtime = null;
  child.kill("SIGKILL");
  const exited = await Promise.race([runtimeExited, sleep(15_000).then(() => null)]);
  return exited;
}
async function api(method, route, body) {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body && { "Content-Type": "application/json" }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// ---------- the TUI, non-interactive ----------
const invocations = [];
/** Runs one TUI command; `json` parses the last stdout line. The token travels only in the environment. */
function tui(args, { json = true, serviceToken = token, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const argv = json ? [...args, "--json"] : args;
    execFile(process.execPath, [tuiBin, ...argv], { env: { ...toolEnv(), LUUNA_URL: base, LUUNA_API_TOKEN: serviceToken }, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      let value = null;
      if (json) { const last = stdout.trim().split("\n").at(-1); try { value = last ? JSON.parse(last) : null; } catch { value = null; } }
      invocations.push({ args: argv, code, stderr: stderr.trim() });
      resolve({ code, stdout, stderr: stderr.trim(), value });
    });
  });
}
async function tuiState(runId) { return (await tui(["run", runId])).value?.state ?? null; }
async function candidateStatus(runId) { return (await tui(["candidate", runId])).value?.evidence?.status ?? null; }
async function waitRunState(runId, states, timeoutMs) { return waitFor(async () => { const state = await tuiState(runId); return states.includes(state) ? state : null; }, timeoutMs, 500); }
const SETTLED = ["reviewed", "failed", "paused", "cancelled", "interrupted", "testing_blocked"];
async function waitCandidate(runId, states, timeoutMs) { return waitFor(async () => { const status = await candidateStatus(runId); return states.includes(status) ? status : null; }, timeoutMs, 500); }
async function waitCandidateAfter(runId, previous, timeoutMs) {
  const moved = await waitFor(async () => { const status = await candidateStatus(runId); return status && status !== previous ? status : null; }, 30_000, 300);
  if (!moved) return null;
  return waitCandidate(runId, SETTLED, timeoutMs);
}
/** The TUI's view of a run and its candidate against the runtime's own API records. */
async function agree(label, runId) {
  const [run, candidate, apiRun, apiCandidate] = await Promise.all([tui(["run", runId]), tui(["candidate", runId]), api("GET", `/runs/${runId}`), api("GET", `/runs/${runId}/candidate`)]);
  const same = run.value?.state === apiRun.body?.state && run.value?.revision === apiRun.body?.revision && (candidate.value?.evidence?.status ?? null) === (apiCandidate.body?.evidence?.status ?? null) && (candidate.value?.evidence?.candidate?.hash ?? null) === (apiCandidate.body?.evidence?.candidate?.hash ?? null) && (candidate.value?.evidence?.reason ?? null) === (apiCandidate.body?.evidence?.reason ?? null);
  record(`${label}: the TUI reports the same authoritative run and candidate state as the runtime API`, same, `run ${run.value?.state} r${run.value?.revision} (API ${apiRun.body?.state} r${apiRun.body?.revision}); candidate ${candidate.value?.evidence?.status ?? "none"} (API ${apiCandidate.body?.evidence?.status ?? "none"})`);
  return same;
}

// ---------- scenarios ----------
const fixtures = {};
async function setupProject(id, name, withHold, { refusedDraftFirst = false } = {}) {
  fixtures[id] = createFixture(id, withHold);
  const registered = await tui(["register", name, "app", fixtures[id].dir, "--id", id]);
  const apiView = await api("GET", `/projects/${id}`);
  record(`${id}: an existing repository is registered and the TUI shows the runtime's read-only observation`, registered.code === 0 && registered.value?.repositories?.[0]?.observation?.head_commit === fixtures[id].head && apiView.body?.repositories?.[0]?.observation?.head_commit === fixtures[id].head, registered.stderr || `HEAD ${fixtures[id].head.slice(0, 12)}`);
  const discovered = await tui(["discover", id]);
  record(`${id}: discovery proposes a manifest draft without executing repository commands`, discovered.code === 0 && discovered.value?.proposed_manifest?.revision === 1 && Array.isArray(discovered.value?.repositories?.[0]?.proposed_checks), discovered.stderr || `${discovered.value?.repositories?.[0]?.proposed_checks?.length ?? 0} proposed check(s)`);
  if (refusedDraftFirst) {
    const bad = manifest(id, name, withHold);
    bad.repositories[0].checks[0].required = "true";
    const badPath = path.join(out, `${id}-unreadable-manifest.json`);
    writeFileSync(badPath, JSON.stringify(bad, null, 2));
    const refused = await tui(["confirm", id, badPath, "--revision", "0"]);
    record(`${id}: an unreadable manifest draft is refused with a reason, not a bare HTTP status`, refused.code === 1 && /^Manifest confirmation refused: /.test(refused.stderr) && /invalid type|could not read|deserialize/i.test(refused.stderr) && !/HTTP 422\)\.$/.test(refused.stderr), refused.stderr);
  }
  const manifestPath = path.join(out, `${id}-manifest.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest(id, name, withHold), null, 2));
  const confirmed = await tui(["confirm", id, manifestPath]);
  record(`${id}: the edited manifest is confirmed as revision 1 with the exact base commit`, confirmed.code === 0 && confirmed.value?.manifest?.revision === 1 && Object.values(confirmed.value?.manifest?.base_commits ?? {})[0] === fixtures[id].head, confirmed.stderr || `manifest ${confirmed.value?.manifest?.hash}`);
  const baselineRun = await tui(["baseline", id, "app"]);
  const settled = await waitFor(async () => { const list = (await tui(["baselines", id])).value; const mine = Array.isArray(list) ? list.find((baseline) => baseline.run_id === baselineRun.value?.id) : null; return mine && mine.status !== "running" ? mine : null; }, 120_000, 500);
  const apiBaseline = (await api("GET", `/projects/${id}/baselines`)).body?.find((baseline) => baseline.run_id === baselineRun.value?.id);
  record(`${id}: the baseline runs the real recipe(s) on the clean checkout and passes, as the API records`, baselineRun.code === 0 && settled?.status === "passed" && settled.results.every((result) => result.status === "passed") && apiBaseline?.status === "passed", settled ? settled.results.map((result) => `${result.recipe_id}: ${result.status}`).join(" · ") : baselineRun.stderr || "no record");
  return { baselineRun: baselineRun.value?.id };
}

async function ticketWorkflow(projectId, title, criteria) {
  const ticket = await tui(["create-ticket", projectId, "--title", title, "--intent", "Make src/main.py print the greeting.", ...criteria.flatMap((criterion) => ["--criterion", criterion])]);
  if (ticket.code !== 0) throw new Error(`ticket creation failed: ${ticket.stderr}`);
  const listed = (await tui(["tickets", projectId])).value;
  record(`${title}: the ticket is created and listed with its revision`, Array.isArray(listed) && listed.some((item) => item.id === ticket.value.id && item.revision === ticket.value.revision), ticket.value.id);
  const planned = await tui(["plan", ticket.value.id, "--repository", "app", "--path", "src"]);
  if (planned.code !== 0) throw new Error(`planning failed: ${planned.stderr}`);
  const plan = planned.value.plan;
  const run = planned.value.run;
  const shown = await tui(["show-plan", plan.id]);
  record(`${title}: the plan revision is immutable and shows its complete hash`, shown.code === 0 && /^sha256:[a-f0-9]{64}$/.test(shown.value?.hash) && shown.value.hash === plan.hash && run.state === "plan_ready", `${plan.id} r${plan.revision} ${plan.hash.slice(0, 23)}…`);
  return { ticket: ticket.value, plan, run };
}

async function approveAndImplement(title, plan, run) {
  const missing = await tui(["approve", plan.id]);
  const wrong = await tui(["approve", plan.id, "--acknowledge-hash", `sha256:${"0".repeat(64)}`]);
  const stillPlanReady = (await api("GET", `/runs/${run.id}`)).body?.state === "plan_ready";
  record(`${title}: approval without the full plan hash is a usage error naming the hash, and a wrong hash is refused before anything is sent`, missing.code === 2 && missing.stderr.includes(plan.hash) && wrong.code === 1 && /^Approval refused: The acknowledged hash does not match/.test(wrong.stderr) && stillPlanReady, wrong.stderr.slice(0, 120));
  const approved = await tui(["approve", plan.id, "--acknowledge-hash", plan.hash, "--approved-by", "developer"]);
  record(`${title}: approval with the acknowledged exact hash binds to that hash and the workflow is approved`, approved.code === 0 && approved.value?.approval?.plan_hash === plan.hash && approved.value?.run?.state === "approved", approved.stderr || approved.value?.approval?.id);
  const implemented = await tui(["implement", run.id]);
  record(`${title}: implementation is scheduled under the approval`, implemented.code === 0 && ["implementing", "approved"].includes(implemented.value?.state), implemented.stderr || implemented.value?.state);
  const settled = await waitRunState(run.id, ["validating", "failed", "cancelled", "interrupted", "paused", "testing_blocked"], 120_000);
  return settled;
}

async function walkthrough() {
  // 1. A wrong token is refused with the next step; the right one answers.
  const refused = await tui(["projects"], { serviceToken: `not-the-token-${"0".repeat(40)}` });
  record("a wrong service token is refused with a clear next step, and the token is never echoed", refused.code === 1 && /^Project listing refused: The service rejected this token/.test(refused.stderr) && /LUUNA_API_TOKEN/.test(refused.stderr) && !refused.stderr.includes("not-the-token"), refused.stderr);
  const health = await tui(["health"]);
  record("the TUI connects from LUUNA_URL and LUUNA_API_TOKEN and reports the runtime's health", health.code === 0 && health.value?.status === "ok", health.stderr || `Pi ${health.value?.pi_version}`);
  // 2. Registration refusal, then the real import, discovery, confirmation and baseline.
  const missing = await tui(["register", "Missing", "app", path.join(out, "fixtures", "missing"), "--id", "missing"]);
  record("registering a path that is not a repository is refused with the runtime's reason", missing.code === 1 && /^Registration refused: /.test(missing.stderr) && !/HTTP \d{3}\)\.$/.test(missing.stderr), missing.stderr);
  const { baselineRun } = await setupProject("walkthrough", "Walkthrough", false, { refusedDraftFirst: true });
  const log = await tui(["artifact", baselineRun, "unit.stderr"]);
  record("walkthrough: a baseline recipe's log is readable by record identity and shows the unittest summary", log.code === 0 && /Ran 1 test/.test(String(log.value)), log.stderr || String(log.value).split("\n").filter(Boolean).slice(-2).join(" · "));
  const checkoutBefore = git(fixtures.walkthrough.dir, "status", "--porcelain");
  // 3. Ticket, plan, exact approval, writer, validation with an invalid review, re-validation.
  const title = "Implement the greeting";
  const { plan, run } = await ticketWorkflow("walkthrough", title, ["fixture:write_in_scope", "fixture:review_malformed_once", "main prints the greeting"]);
  const settled = await approveAndImplement(title, plan, run);
  record("walkthrough: the approved writer settles in validating with a frozen candidate", settled === "validating" && (await candidateStatus(run.id)) === "pending", `run ${settled}`);
  await agree("walkthrough after the writer", run.id);
  const worktrees = await tui(["worktrees", run.id]);
  const attempts = await tui(["attempts", run.id]);
  const apiAttempts = (await api("GET", `/runs/${run.id}/attempts`)).body;
  record("walkthrough: worktree leases and writer attempts are listed as the API records them", worktrees.code === 0 && worktrees.value?.length === 1 && attempts.code === 0 && JSON.stringify(attempts.value) === JSON.stringify(apiAttempts) && apiAttempts.length === 1, `${worktrees.value?.[0]?.path ?? "no lease"} · ${attempts.value?.length ?? 0} attempt(s)`);
  const diff = await tui(["diff", run.id]);
  record("walkthrough: the candidate diff is bound to the candidate hash and changes only src/main.py", diff.code === 0 && diff.value?.candidate_hash === (await api("GET", `/runs/${run.id}/candidate`)).body?.evidence?.candidate?.hash && diff.value.diff.includes("src/main.py") && diff.value.diff.includes("implemented by the synthetic writer"), `${diff.value?.diff?.split("\n").length ?? 0} lines`);
  const validated = await tui(["validate", run.id]);
  record("walkthrough: validation starts for the candidate hash the TUI showed", validated.code === 0, validated.stderr || validated.value?.state);
  const failed = await waitCandidate(run.id, SETTLED, 120_000);
  const view = (await tui(["candidate", run.id])).value;
  const human = await tui(["candidate", run.id], { json: false });
  record("walkthrough: the invalid synthetic review fails the candidate without a verdict and the passed unittest check shows its detected test count", failed === "failed" && /invalid structured reviewer response/.test(view?.evidence?.reason ?? "") && view.evidence.results.some((result) => result.recipe_id === "unit" && result.status === "passed" && result.tests_detected !== undefined), `${view?.evidence?.reason?.slice(0, 80)}`);
  record("walkthrough: the TUI names the next allowed step (re-validation) from the shared explanation and the runtime's decisions", /next: .*Re-validate/.test(human.stdout) && /revalidate is available/.test(human.stdout) && view?.revalidate_allowed === true, human.stdout.split("\n").find((line) => line.startsWith("next:")) ?? "no next step");
  await agree("walkthrough after the invalid review", run.id);
  const revalidated = await tui(["validate", run.id]);
  record("walkthrough: re-validation is admitted in place with the same candidate hash", revalidated.code === 0, revalidated.stderr || revalidated.value?.state);
  const reviewed = await waitCandidateAfter(run.id, "failed", 120_000);
  const reviewedView = (await tui(["candidate", run.id])).value;
  record("walkthrough: re-validation reaches reviewed with a passed verdict on the same candidate, as generation 2", reviewed === "reviewed" && reviewedView?.evidence?.review?.verdict === "passed" && reviewedView.evidence.validation_generation === 2 && (await tuiState(run.id)) === "reviewed", `candidate ${reviewed}; verdict ${reviewedView?.evidence?.review?.verdict}; generation ${reviewedView?.evidence?.validation_generation}`);
  await agree("walkthrough after the review", run.id);
  const checkLog = await tui(["artifact", run.id, reviewedView.evidence.results.find((result) => result.recipe_id === "unit").artifact_refs.find((id) => id.endsWith(".stderr"))]);
  record("walkthrough: a check log is readable by record identity and shows the unittest summary", checkLog.code === 0 && /Ran 1 test/.test(String(checkLog.value)), String(checkLog.value).split("\n").filter(Boolean).slice(-1).join(" · "));
  const events = await tui(["events", run.id]);
  const apiEvents = (await api("GET", `/runs/${run.id}/events?after=0`)).body;
  record("walkthrough: the durable event replay through the TUI matches the API's record", events.code === 0 && Array.isArray(events.value) && events.value.length === apiEvents.length && events.value.every((event, index) => event.event_id === apiEvents[index].event_id), `${events.value?.length ?? 0} events`);
  record("walkthrough: the developer checkout is untouched (clean before and after)", checkoutBefore === "" && git(fixtures.walkthrough.dir, "status", "--porcelain") === "" && git(fixtures.walkthrough.dir, "rev-parse", "HEAD") === fixtures.walkthrough.head);
  // 4. Components, memory and prompts through the TUI (the components slice of M6).
  const components = await tui(["components", "walkthrough"]);
  const enabled = components.value?.enabled ? components : await tui(["enable-components", "walkthrough"]);
  if (enabled.code === 0 && enabled.value?.enabled) {
    const memory = await tui(["remember", "walkthrough", "project", "The unit recipe is python -m unittest -v", "manifest revision 1"]);
    const listed = await tui(["memory", "walkthrough"]);
    const forgotten = memory.code === 0 ? await tui(["forget", "walkthrough", memory.value.id, memory.value.hash]) : { code: 1 };
    const after = await tui(["memory", "walkthrough"]);
    record("components: memory is recorded with scope and provenance, listed, and deleted by its exact hash", memory.code === 0 && listed.value?.some((item) => item.id === memory.value.id) && forgotten.code === 0 && forgotten.value?.deleted === true && !after.value?.some((item) => item.id === memory.value.id), memory.stderr || forgotten.stderr || memory.value?.id);
    const bodyPath = path.join(out, "prompt-body.md");
    writeFileSync(bodyPath, "Keep changes within the approved paths.\n");
    const prompt = await tui(["save-prompt", "walkthrough", "guidance", bodyPath]);
    const rendered = prompt.code === 0 ? await tui(["render-prompt", "walkthrough", "guidance", String(prompt.value.version)]) : { code: 1 };
    const prompts = await tui(["prompts", "walkthrough"]);
    record("components: a prompt version is saved, listed and rendered with its exact hash", prompt.code === 0 && rendered.code === 0 && rendered.value?.hash === prompt.value?.hash && prompts.value?.some((item) => item.name === "guidance"), prompt.stderr || rendered.stderr || prompt.value?.hash);
  } else {
    note(`components: not enabled on this host (${enabled.stderr || enabled.value?.reason || "no reason"}); memory and prompt commands were exercised against the mocked client only`);
  }
}

async function recovery() {
  // A hold check keeps validation busy for 20 s; the runtime is hard-killed meanwhile.
  await setupProject("recovery", "Recovery", true);
  const title = "Hard kill during checks";
  const { plan, run } = await ticketWorkflow("recovery", title, ["fixture:write_in_scope", "main prints the greeting"]);
  const settled = await approveAndImplement(title, plan, run);
  record("recovery: the writer settles in validating", settled === "validating");
  const worktree = (await tui(["worktrees", run.id])).value?.[0]?.path;
  // A live follower on the workflow's events, through the SSE stream, started before the outage.
  let followOut = "";
  let followErr = "";
  const follower = spawn(process.execPath, [tuiBin, "follow", run.id], { env: { ...toolEnv(), LUUNA_URL: base, LUUNA_API_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] });
  follower.stdout.on("data", (chunk) => { followOut += chunk; });
  follower.stderr.on("data", (chunk) => { followErr += chunk; });
  const followerExit = new Promise((resolve) => follower.once("exit", (code) => resolve(code)));
  const validated = await tui(["validate", run.id]);
  record("recovery: validation starts", validated.code === 0, validated.stderr || validated.value?.state);
  const holding = await waitFor(() => (worktree && existsSync(path.join(worktree, ".hold-started")) ? true : null), 60_000, 200);
  record("recovery: the hold check is running in the Luuna-owned worktree", Boolean(holding), worktree ?? "no worktree");
  const killed = await killRuntime();
  record("recovery: the runtime was hard-killed during the held check", killed?.signal === "SIGKILL" || killed?.code !== 0, JSON.stringify(killed));
  const outageSeen = await waitFor(() => (/Runtime outage while following/.test(followErr) ? followErr : null), 20_000, 200);
  record("recovery: the live follower reports the outage and keeps reconnecting from its last sequence", Boolean(outageSeen) && /Reconnecting; replay resumes after sequence \d+/.test(followErr) && follower.exitCode === null, followErr.split("\n").find((line) => line.includes("outage")) ?? "no outage line");
  const during = await tui(["candidate", run.id]);
  record("recovery: a command during the outage is refused with a plain sentence, never a server body", during.code === 1 && /^Candidate inspection refused: The runtime did not answer\./.test(during.stderr), during.stderr);
  await startRuntime("restart-after-kill");
  const reconnected = await waitFor(() => (/Reconnected to the runtime/.test(followErr) ? true : null), 30_000, 200);
  record("recovery: the follower reconnects by itself once the runtime answers", Boolean(reconnected), followErr.split("\n").find((line) => line.includes("Reconnected")) ?? "no reconnection line");
  const interrupted = await waitRunState(run.id, ["interrupted"], 30_000);
  const view = (await tui(["candidate", run.id])).value;
  const human = await tui(["candidate", run.id], { json: false });
  record("recovery: after restart the TUI shows the run and candidate as interrupted with the recorded reason and next step", interrupted === "interrupted" && view?.evidence?.status === "interrupted" && /interrupt|restart/i.test(view.evidence.reason ?? "") && /Validate again/.test(human.stdout), `${view?.evidence?.reason?.slice(0, 100)}`);
  await agree("recovery after restart", run.id);
  const revalidated = await tui(["validate", run.id]);
  record("recovery: validating again runs a fresh generation of the same candidate", revalidated.code === 0, revalidated.stderr || revalidated.value?.state);
  const reviewed = await waitCandidateAfter(run.id, "interrupted", 120_000);
  const reviewedView = (await tui(["candidate", run.id])).value;
  record("recovery: the interrupted candidate reaches reviewed as generation 2", reviewed === "reviewed" && reviewedView?.evidence?.validation_generation === 2 && reviewedView.evidence.review?.verdict === "passed", `candidate ${reviewed}; generation ${reviewedView?.evidence?.validation_generation}`);
  await agree("recovery after the review", run.id);
  // A reviewed workflow can still change (publication, invalidation after the
  // review; ADR 0018 amendment), so its stream stays open: the follower keeps
  // following after `run reviewed` rather than exiting, and is stopped here.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !/candidate\.review_finished\s+reviewed/.test(followOut)) await sleep(250);
  const followerCode = await Promise.race([followerExit, sleep(2_000).then(() => null)]);
  if (followerCode === null) follower.kill();
  const followed = followOut.trim().split("\n");
  const sequences = followed.filter((line) => /^\s*\d+\s/.test(line)).map((line) => Number(line.trim().split(/\s+/)[0]));
  const apiEvents = (await api("GET", `/runs/${run.id}/events?after=0`)).body;
  record("recovery: the follower stays attached through the reviewed run, having received every event in order across the restart, as the API records", followerCode === null && /candidate\.review_finished\s+reviewed\s*$/.test(followed.at(-1) ?? "") && (await tuiState(run.id)) === "reviewed" && sequences.length === apiEvents.length && sequences.every((sequence, index) => sequence === index + 1), `${sequences.length} of ${apiEvents.length} events; exit ${followerCode}; ${followed.at(-1)}`);
}

// ---------- run ----------
let failure = null;
try {
  await startRuntime("initial");
  await walkthrough();
  await recovery();
} catch (error) {
  failure = error;
  record("smoke completed without harness error", false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  if (runtime) {
    const stop = await tui(["shutdown"]);
    const exited = await Promise.race([runtimeExited, sleep(15_000).then(() => null)]);
    if (!exited) runtime.kill("SIGKILL");
    record("shutdown: the TUI's authenticated shutdown stops the runtime in an orderly way (exit code 0)", stop.code === 0 && stop.value?.status === "shutting_down" && exited?.code === 0, stop.stderr || JSON.stringify(exited));
    runtime = null;
  }
}
const passed = checks.every((check) => check.ok);
const report = {
  mode: "fixture",
  surface: "terminal client (non-interactive mode)",
  verdict: `SYNTHETIC TUI parity smoke ${passed ? "passed" : "FAILED"}: terminal client, runtime restart and shutdown evidence only, never provider evidence`,
  started_at: started.toISOString(),
  finished_at: new Date().toISOString(),
  runtime_binary: runtimeBinary,
  ports: { runtime: runtimePort },
  checks,
  notes,
  invocations,
  fixtures: Object.fromEntries(Object.entries(fixtures).map(([name, fixture]) => [name, { head: fixture.head }])),
};
const lines = ["# Luuna TUI parity smoke", "", `Verdict: **${report.verdict}**`, "", `Started ${report.started_at}, finished ${report.finished_at}.`, "", "| Result | Check | Detail |", "| --- | --- | --- |", ...checks.map((check) => `| ${check.ok ? "pass" : "FAIL"} | ${check.name} | ${check.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`), "", "## Notes", "", ...(notes.length ? notes.map((text) => `- ${text}`) : ["- none"]), "", `## TUI invocations (${invocations.length})`, "", ...invocations.map((call) => `- \`luuna-tui ${call.args.join(" ")}\` → exit ${call.code}${call.stderr ? ` · ${call.stderr.split("\n")[0].slice(0, 160)}` : ""}`), ""];
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(path.join(out, "report.md"), lines.join("\n"));
console.log(`\n${report.verdict}\n${checks.filter((check) => check.ok).length}/${checks.length} checks passed. Report written to ${path.join(out, "report.md")}`);
if (!options.keep && passed) { try { rmSync(path.join(out, "runtime-data"), { recursive: true, force: true }); } catch { /* ignore */ } }
process.exit(passed && !failure ? 0 : 1);
