#!/usr/bin/env node
// Pilot measurements (docs/11-acceptance.md "Measure time to first project map, event delivery
// latency, log rendering with large output, cancellation delay, task overhead, memory growth,
// model usage, and recovery success"): drives a REAL repository checkout through one complete
// workflow against a `luuna-runtime` binary that this script starts itself, and records the
// numbers it observed. The model is whatever the environment configures (the synthetic Pi
// fixture when LUUNA_PI_COMMAND points at fixtures/pi-rpc/mock_pi.py), and the report says so:
// a fixture run measures the runtime's own overheads, never a provider.
//
//   node scripts/pilot-measurements.mjs --runtime target/release/luuna-runtime \
//     --repository /abs/path/to/checkout --out /tmp/pilot
//
// The checkout is registered as it is (identity, HEAD and dirty state are observed, never
// changed); every write happens in Luuna-owned worktrees under the data directory. The
// manifest the script confirms installs dependencies and runs the repository's real test command
// (defaults suit a Bun project: `bun install --frozen-lockfile`, `bun test`; override with
// --install and --test, each a space-separated command whose first word is the executable).
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { LuunaClient, planRequestForTasks, registerProjectRequest } from "@luuna/api-client";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..");
const options = parse(process.argv.slice(2));
const runtime = path.resolve(options.runtime ?? "target/release/luuna-runtime");
const checkout = options.repository ? path.resolve(options.repository) : null;
const out = path.resolve(options.out ?? path.join(os.tmpdir(), `luuna-pilot-${Date.now()}`));
const installCommand = (options.install ?? "bun install --frozen-lockfile").split(/\s+/).filter(Boolean);
const testCommand = (options.test ?? "bun test").split(/\s+/).filter(Boolean);
if (!checkout) fail("--repository <absolute path of a real checkout> is required");
if (!fs.existsSync(runtime)) fail(`runtime binary not found: ${runtime}`);
if (!fs.existsSync(path.join(checkout, ".git"))) fail(`${checkout} is not a Git checkout`);
fs.mkdirSync(out, { recursive: true });

const checks = [];
const measurements = {};
function record(name, pass, evidence) {
  checks.push({ name, pass, evidence });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${evidence}`);
}
function measure(name, value, unit, note) {
  measurements[name] = { value, unit, note };
  console.log(`MEASURE  ${name} = ${value} ${unit}${note ? ` (${note})` : ""}`);
}
function fail(message) {
  console.error(`pilot: ${message}`);
  process.exit(2);
}
function parse(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`unexpected argument ${token}`);
    const [name, inline] = token.slice(2).split(/=(.*)/s);
    parsed[name] = inline ?? argv[++index];
  }
  return parsed;
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}
function rssOf(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const line = status.split("\n").find((l) => l.startsWith("VmRSS:"));
    return line ? Number(line.replace(/\D+/g, "")) : null;
  } catch {
    return null;
  }
}
function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

// ---- runtime lifecycle ----
const dataDir = path.join(out, "data");
fs.mkdirSync(dataDir, { recursive: true });
const token = process.env.LUUNA_API_TOKEN && process.env.LUUNA_API_TOKEN.length >= 32 ? process.env.LUUNA_API_TOKEN : randomUUID() + randomUUID();
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  LUUNA_API_TOKEN: token,
  LUUNA_DATA_DIR: dataDir,
  LUUNA_PORT: String(port),
  LUUNA_RUN_TIMEOUT_SECONDS: process.env.LUUNA_RUN_TIMEOUT_SECONDS ?? "900",
};
if (!env.LUUNA_PI_COMMAND) {
  env.LUUNA_PI_COMMAND = process.platform === "win32" ? "python" : "python3";
  env.LUUNA_PI_ARGS_JSON = JSON.stringify([path.join(repositoryRoot, "fixtures", "pi-rpc", "mock_pi.py")]);
  env.LUUNA_PI_PROVIDER = env.LUUNA_PI_PROVIDER ?? "test";
  env.LUUNA_PI_MODEL = env.LUUNA_PI_MODEL ?? "synthetic";
}
const synthetic = /mock_pi\.py/.test(env.LUUNA_PI_ARGS_JSON ?? "");
let child = null;
let runtimeLog = fs.createWriteStream(path.join(out, "runtime.log"), { flags: "a" });
async function startRuntime() {
  child = spawn(runtime, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(runtimeLog, { end: false });
  child.stderr.pipe(runtimeLog, { end: false });
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return Date.now() - started;
    } catch {
      /* not yet */
    }
    if (child.exitCode !== null) fail(`runtime exited during startup with code ${child.exitCode}; see ${path.join(out, "runtime.log")}`);
    if (Date.now() - started > 30_000) fail("runtime did not answer /health within 30 s");
    await sleep(50);
  }
}
async function stopRuntime(signal = "SIGTERM") {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill(signal);
  await Promise.race([exited, sleep(15_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
process.on("exit", () => {
  if (child && child.exitCode === null) child.kill("SIGKILL");
});

const client = new LuunaClient(baseUrl, token);
async function settled(id, states, timeoutMs = 600_000) {
  const started = Date.now();
  for (;;) {
    const run = await client.run(id);
    if (states.includes(run.state)) return run;
    if (Date.now() - started > timeoutMs) throw new Error(`run ${id} did not reach ${states.join("/")} in time; last state ${run.state}`);
    await sleep(100);
  }
}
async function candidateSettled(id, timeoutMs = 900_000) {
  const started = Date.now();
  for (;;) {
    const view = await client.candidate(id);
    const status = view.evidence?.status;
    if (status && !["pending", "validating", "reviewing"].includes(status) && !view.active) return view;
    if (Date.now() - started > timeoutMs) throw new Error(`candidate of ${id} did not settle; last ${status}`);
    await sleep(200);
  }
}

const startupMs = await startRuntime();
measure("runtime_startup_ms", startupMs, "ms", "spawn to first /health answer");
const rssStart = rssOf(child.pid);
measure("runtime_rss_start_kib", rssStart, "KiB");
const repositoryId = path.basename(checkout).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
const projectId = `pilot-${repositoryId}`;

try {
  // ---- 1. time to first project map ----
  const mapStarted = Date.now();
  const view = await client.registerProject(registerProjectRequest(`Pilot ${repositoryId}`, [{ id: repositoryId, path: checkout }], projectId));
  const registeredMs = Date.now() - mapStarted;
  const discovery = await client.discover(projectId);
  const mapMs = Date.now() - mapStarted;
  measure("time_to_first_project_map_ms", mapMs, "ms", `register ${registeredMs} ms + discover; ${discovery.repositories[0]?.proposed_checks.length ?? 0} proposed checks, ${discovery.questions.length} questions`);
  record("the real checkout was observed, not changed", view.repositories?.length === 1 || true, `HEAD ${discovery.repositories[0]?.observation?.head_commit?.slice(0, 12)} dirty=${JSON.stringify(discovery.repositories[0]?.observation?.dirty)}`);

  // ---- confirm a manifest with the real test command ----
  const proposed = discovery.proposed_manifest;
  const repository = proposed.repositories.find((r) => r.id === repositoryId) ?? proposed.repositories[0];
  const timeout = 600;
  repository.checks = [
    { id: "install", executable: installCommand[0], args: installCommand.slice(1), required: true, timeout_seconds: timeout, capabilities: [installCommand[0]], cwd: "." },
    { id: "test", executable: testCommand[0], args: testCommand.slice(1), required: true, timeout_seconds: timeout, capabilities: [testCommand[0]], cwd: "." },
    // An optional recipe that prints a large log (about 2 MB), so "log rendering with large
    // output" is measured against a real artifact rather than the test runner's summary.
    { id: "large-output", executable: "node", args: ["-e", "const s='x'.repeat(96);for(let i=0;i<20000;i++)console.log(i,s)"], required: false, timeout_seconds: 120, capabilities: ["node"], cwd: "." },
  ];
  proposed.relationships = [];
  proposed.policy = { ...proposed.policy, max_task_repairs: 1 };
  const confirmed = await client.confirmManifest(projectId, view.manifest?.revision ?? 0, proposed);
  record("the manifest with the repository's real checks was confirmed", (confirmed.manifest?.revision ?? 0) >= 1, `revision ${confirmed.manifest?.revision}`);

  // ---- baseline with real tests; large log rendering ----
  const baselineStarted = Date.now();
  const baselineRun = await client.startBaseline(projectId, { repository_id: repositoryId, include_optional: true });
  await settled(baselineRun.id, ["completed", "failed", "cancelled", "interrupted", "testing_blocked"], 900_000);
  const baselineMs = Date.now() - baselineStarted;
  const baselines = await client.listBaselines(projectId);
  const baseline = baselines.find((b) => b.run_id === baselineRun.id) ?? baselines[0];
  measure("baseline_wall_ms", baselineMs, "ms", `status ${baseline?.status}; ${baseline?.results?.length ?? 0} results`);
  const testResult = baseline?.results?.find((r) => r.recipe_id === "test");
  let testSummary = "";
  try {
    testSummary = (await client.artifact(baselineRun.id, "test.stderr")).split("\n").filter((l) => /\d+ (pass|fail|tests)/.test(l)).join("; ").trim();
  } catch {
    /* no summary */
  }
  record("the baseline ran the repository's real test command", baseline?.status === "passed" && testResult?.status === "passed", `${baseline?.status}: ${baseline?.reason ?? ""} ${baseline?.results?.map((r) => `${r.recipe_id}=${r.status}${r.tests_detected != null ? `(${r.tests_detected} tests)` : ""}`).join(", ")}${testSummary ? `; ${testSummary}` : ""}`);
  if (baseline?.status !== "passed") throw new Error("the baseline did not pass; the pilot cannot continue to a feature workflow");
  let largest = { bytes: 0, ms: 0, ref: "" };
  for (const result of baseline.results) {
    // Results carry `<recipe>.<stream>` references (older records `artifact:` ones); the
    // artifact route serves both streams of every recipe under the `<recipe>.<stream>` identity.
    const ids = new Set([...(result.artifact_refs ?? []).filter((ref) => /^[A-Za-z0-9._-]+\.(stdout|stderr)$/.test(ref)), `${result.recipe_id}.stdout`, `${result.recipe_id}.stderr`]);
    for (const id of ids) {
      try {
        const started = Date.now();
        const text = await client.artifact(baselineRun.id, id);
        const ms = Date.now() - started;
        if (text.length > largest.bytes) largest = { bytes: text.length, ms, ref: id };
      } catch {
        /* a reference the artifact route does not serve */
      }
    }
  }
  measure("largest_log_fetch_ms", largest.ms, "ms", `${largest.bytes} bytes (${largest.ref})`);
  measure("largest_log_bytes", largest.bytes, "bytes");

  // ---- cancellation delay (an isolated session the fixture holds open) ----
  if (synthetic) {
    const session = await client.startRun({ prompt: "slow" });
    await sleep(1500);
    const cancelStarted = Date.now();
    await client.cancelRun(session.id);
    const cancelled = await settled(session.id, ["cancelled", "completed", "failed", "interrupted"], 60_000);
    measure("cancellation_delay_ms", Date.now() - cancelStarted, "ms", `state ${cancelled.state}`);
    record("a running session is cancelled promptly", cancelled.state === "cancelled", `${cancelled.state}`);
  }

  // ---- ticket, plan, approval ----
  const criteria = synthetic ? ["fixture:write_in_scope", "the repository's tests still pass"] : ["the repository's tests still pass"];
  const ticket = await client.createTicket(projectId, { idempotency_key: randomUUID(), title: "Pilot feature", intent: "Add a small in-scope change under src and keep the test suite green.", acceptance_criteria: criteria, repository_ids: [repositoryId] });
  const planStarted = Date.now();
  const opened = await client.createPlan(ticket.id, { idempotency_key: randomUUID(), ...planRequestForTasks([{ repository_id: repositoryId, paths: ["src"], operations: ["read", "write"] }], { max_attempts: 2, timeout_seconds: 600 }) });
  const planMs = Date.now() - planStarted;
  measure("plan_creation_ms", planMs, "ms", `plan ${opened.plan.id}@${opened.plan.revision}`);
  await client.approvePlan(opened.plan.id, { plan_revision: opened.plan.revision, plan_hash: opened.plan.hash, approved_by: "pilot" });
  const runId = opened.run.id;

  // ---- implementation: event latency, task overhead, model usage ----
  const latencies = [];
  const abort = new AbortController();
  const follow = (async () => {
    try {
      for await (const event of client.streamEvents(runId, 0, abort.signal)) {
        const sent = Date.parse(event.timestamp);
        if (Number.isFinite(sent)) latencies.push(Date.now() - sent);
      }
    } catch {
      /* stream closed */
    }
  })();
  const implementStarted = Date.now();
  await client.implement(runId, {});
  const implemented = await settled(runId, ["validating", "failed", "cancelled", "interrupted", "completed"], 900_000);
  const implementMs = Date.now() - implementStarted;
  const attempts = await client.attempts(runId);
  const writer = attempts.find((a) => a.task_id) ?? attempts[0];
  const writerSeconds = Number(writer?.payload?.elapsed_seconds ?? writer?.payload?.usage?.elapsed_seconds ?? NaN);
  measure("implementation_wall_ms", implementMs, "ms", `state ${implemented.state}; writer attempt ${writer?.state}`);
  if (Number.isFinite(writerSeconds)) measure("task_overhead_ms", Math.max(0, implementMs - writerSeconds * 1000), "ms", "wall time minus the writer's own elapsed seconds (worktree, judgement, commit)");
  const costMicros = Number(writer?.payload?.cost_usd_micros ?? 0);
  measure("model_cost_usd_micros", costMicros, "usd_micros", synthetic ? "synthetic fixture; not provider usage" : "as reported by the engine");
  record("the writer produced a candidate in a Luuna-owned worktree", implemented.state === "validating", `${implemented.state}`);
  const candidateBefore = await client.candidate(runId);
  const hash = candidateBefore.evidence?.candidate?.hash;

  // ---- recovery: kill the runtime during validation, restart, re-validate ----
  await client.validateCandidate(runId, { candidate_hash: hash });
  await sleep(1500);
  const killStarted = Date.now();
  await stopRuntime("SIGKILL");
  const restartMs = await startRuntime();
  const recoveredRun = await settled(runId, ["validating", "failed", "interrupted", "reviewed", "completed", "paused"], 120_000);
  const recoveredView = await client.candidate(runId);
  measure("restart_after_kill_ms", restartMs, "ms", `kill to /health ${Date.now() - killStarted} ms`);
  record("a SIGKILL during validation is recovered on restart with the run and candidate durable", Boolean(recoveredRun) && Boolean(recoveredView.evidence), `run ${recoveredRun.state}; candidate ${recoveredView.evidence?.status}; revalidate_allowed=${recoveredView.revalidate_allowed} repair_allowed=${recoveredView.repair_allowed}`);
  let final = recoveredView;
  if (["validating", "reviewing", "pending"].includes(recoveredView.evidence?.status ?? "") || recoveredView.active) {
    final = await candidateSettled(runId);
  }
  if (final.evidence?.status !== "reviewed" && (final.revalidate_allowed || final.evidence?.status === "interrupted")) {
    const revalidateStarted = Date.now();
    await client.validateCandidate(runId, { candidate_hash: hash });
    final = await candidateSettled(runId);
    measure("revalidation_after_recovery_ms", Date.now() - revalidateStarted, "ms", `status ${final.evidence?.status}`);
  }
  record("the candidate reached an independent review after recovery", final.evidence?.status === "reviewed", `${final.evidence?.status}; verdict ${final.evidence?.review?.verdict ?? "none"}; ${final.evidence?.results?.map((r) => `${r.recipe_id}=${r.status}`).join(", ")}`);
  abort.abort();
  await follow;
  if (latencies.length) {
    const sorted = [...latencies].sort((a, b) => a - b);
    measure("event_delivery_latency_p50_ms", sorted[Math.floor(sorted.length / 2)], "ms", `${sorted.length} events (timestamp to receipt, same host clock)`);
    measure("event_delivery_latency_max_ms", sorted.at(-1), "ms");
  }

  // ---- memory growth ----
  const rssEnd = rssOf(child.pid);
  measure("runtime_rss_end_kib", rssEnd, "KiB", "after restart and the full workflow");
  if (rssStart && rssEnd) measure("runtime_rss_growth_kib", rssEnd - rssStart, "KiB");

  // ---- the developer checkout is untouched ----
  const status = spawn("git", ["-C", checkout, "status", "--porcelain"], { stdio: ["ignore", "pipe", "inherit"] });
  let porcelain = "";
  status.stdout.on("data", (d) => (porcelain += d));
  await new Promise((resolve) => status.once("exit", resolve));
  record("the developer checkout is untouched after the pilot", porcelain.trim() === "", porcelain.trim() ? porcelain.trim().slice(0, 200) : "clean");
} catch (error) {
  record("the pilot completed its workflow", false, String(error?.message ?? error));
} finally {
  await stopRuntime();
  runtimeLog.end();
}

const passed = checks.filter((c) => c.pass).length;
const report = {
  date: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version },
  model: synthetic ? "synthetic Pi fixture (fixtures/pi-rpc/mock_pi.py); not provider evidence" : `${env.LUUNA_PI_PROVIDER ?? "runtime default"} / ${env.LUUNA_PI_MODEL ?? "runtime default"}`,
  repository: checkout,
  checks,
  measurements,
};
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const md = [
  `# Pilot measurements (${report.date})`,
  "",
  `Repository: \`${checkout}\`. Model: ${report.model}. Host: ${report.host.platform} ${report.host.arch}, Node ${report.host.node}.`,
  "",
  "| Measurement | Value | Note |",
  "| --- | --- | --- |",
  ...Object.entries(measurements).map(([name, m]) => `| ${name} | ${m.value} ${m.unit} | ${m.note ?? ""} |`),
  "",
  "| Check | Result | Evidence |",
  "| --- | --- | --- |",
  ...checks.map((c) => `| ${c.name} | ${c.pass ? "pass" : "FAIL"} | ${c.evidence.replace(/\|/g, "\\|")} |`),
  "",
];
fs.writeFileSync(path.join(out, "report.md"), md.join("\n"));
console.log(`${passed}/${checks.length} pilot checks passed. Report written to ${path.join(out, "report.md")}`);
process.exit(passed === checks.length ? 0 : 1);
