#!/usr/bin/env node
// Luuna M1 smoke harness: drives a real `luuna-runtime` binary through its
// authenticated loopback API and records sanitized evidence for the M1 exits
// (streamed completion after agent_settled, in-flight cancellation with child
// reaping, provider failure, crash/restart interruption, exclusive ownership).
//
//   node scripts/m1-smoke.mjs --mode fixture      # synthetic protocol fixture; never provider evidence
//   node scripts/m1-smoke.mjs --mode real --provider anthropic --model claude-sonnet-4-5
//
// Real mode needs the pinned Pi executable (LUUNA_PI_COMMAND or --pi) and the
// provider credential in this process environment; the runtime forwards only
// the supported names (or their LUUNA_PI_ aliases) to the isolated Pi child.
// The report never contains the service token or any environment value.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir, platform, release, arch } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { execFileSync } from "node:child_process";

const options = parseArguments(process.argv.slice(2));
const mode = options.mode ?? "real";
if (!["fixture", "real"].includes(mode)) fail("--mode must be fixture or real");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const started = new Date();
const out = path.resolve(options.out ?? path.join(tmpdir(), `luuna-m1-smoke-${started.toISOString().replace(/[:.]/g, "-")}`));
mkdirSync(out, { recursive: true, mode: 0o700 });
const dataDir = path.join(out, "data");
const port = Number(options.port ?? 4247);
const runtimeBinary = path.resolve(options.runtime ?? path.join(repository, "target", "debug", process.platform === "win32" ? "luuna-runtime.exe" : "luuna-runtime"));
const token = randomBytes(36).toString("base64url");
const runTimeoutSeconds = Number(options["run-timeout"] ?? process.env.LUUNA_RUN_TIMEOUT_SECONDS ?? 300);

const profile = mode === "fixture"
  ? {
    pi: process.platform === "win32" ? "python" : "python3",
    piArgs: [path.join(repository, "fixtures", "pi-rpc", "mock_pi.py")],
    provider: "test",
    model: "synthetic",
    failureModel: "synthetic",
    prompts: { success: "success", cancel: "slow", failure: "provider_error", restart: "slow" },
  }
  : {
    pi: options.pi ?? process.env.LUUNA_PI_COMMAND ?? "pi",
    piArgs: JSON.parse(options["pi-args-json"] ?? process.env.LUUNA_PI_ARGS_JSON ?? "[]"),
    provider: options.provider ?? process.env.LUUNA_PI_PROVIDER,
    model: options.model ?? process.env.LUUNA_PI_MODEL,
    failureModel: "luuna-no-such-model-0000",
    prompts: {
      success: "Reply with exactly the text LUUNA-M1-OK followed by one short sentence about the Moon.",
      cancel: "Count slowly from 1 to 500, writing one number per line and nothing else.",
      failure: "Reply with the single word pong.",
      restart: "Count slowly from 1 to 500, writing one number per line and nothing else.",
    },
  };
if (!profile.provider || !profile.model) fail("real mode requires --provider and --model (or LUUNA_PI_PROVIDER / LUUNA_PI_MODEL)");

const checks = [];
const evidence = { mode, started_at: started.toISOString(), out, runtime_binary: runtimeBinary, port, runs: {} };
const base = `http://127.0.0.1:${port}`;
let runtime = null;

try {
  evidence.environment = environment();
  runtime = await startRuntime("initial");
  await publicHealthAndAuthentication();
  await successfulStreamedRun();
  await cancelledRun();
  await providerFailureRun();
  await crashRestartRecovery();
  await exclusiveOwnership();
  await gracefulShutdown();
} catch (error) {
  record("harness", false, `unexpected harness failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  if (runtime && runtime.exitCode === null) runtime.kill("SIGKILL");
}

evidence.finished_at = new Date().toISOString();
evidence.checks = checks;
const passed = checks.every((check) => check.ok);
evidence.verdict = mode === "fixture"
  ? `SYNTHETIC fixture run ${passed ? "passed" : "FAILED"}: harness/protocol evidence only, never provider or M1 success`
  : `Real provider run ${passed ? "passed every M1 smoke check" : "did NOT pass every M1 smoke check"}`;
writeFileSync(path.join(out, "report.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
writeFileSync(path.join(out, "report.md"), markdown(evidence), { mode: 0o600 });
console.log(markdown(evidence));
console.log(`Report written to ${path.join(out, "report.md")} and report.json`);
process.exit(passed ? 0 : 1);

// ---------------------------------------------------------------------------

async function startRuntime(label) {
  const env = { ...process.env };
  delete env.LUUNA_PI_PROVIDER;
  delete env.LUUNA_PI_MODEL;
  Object.assign(env, {
    LUUNA_API_TOKEN: token,
    LUUNA_DATA_DIR: dataDir,
    LUUNA_PORT: String(port),
    LUUNA_PI_COMMAND: profile.pi,
    LUUNA_PI_ARGS_JSON: JSON.stringify(profile.piArgs),
    LUUNA_RUN_TIMEOUT_SECONDS: String(runTimeoutSeconds),
  });
  const log = path.join(out, `runtime-${label}.log`);
  const child = spawn(runtimeBinary, [], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; writeFileSync(log, stderr, { mode: 0o600 }); });
  child.stderrText = () => stderr;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`runtime exited early (${child.exitCode}): ${stderr.trim()}`);
    try {
      const response = await fetch(`${base}/api/v1/health`);
      if (response.ok) {
        const health = await response.json();
        record(`runtime ${label} start`, health.status === "ok" && health.demo_only === true, `health ${JSON.stringify(health)}`);
        return child;
      }
    } catch { /* not yet listening */ }
    await sleep(100);
  }
  throw new Error(`runtime did not become healthy: ${stderr.trim()}`);
}

async function publicHealthAndAuthentication() {
  const anonymous = await fetch(`${base}/api/v1/runs`);
  const wrong = await fetch(`${base}/api/v1/runs`, { headers: { Authorization: `Bearer ${randomBytes(36).toString("base64url")}` } });
  record("protected routes reject missing and wrong tokens", anonymous.status === 401 && wrong.status === 401, `missing=${anonymous.status} wrong=${wrong.status}`);
  const slash = await api("POST", "/runs", { prompt: "/bash whoami", provider: profile.provider, model: profile.model });
  record("slash-command prompts are rejected", slash.status === 400, `status ${slash.status}`);
}

async function successfulStreamedRun() {
  const run = await startRun(profile.prompts.success, profile.provider, profile.model);
  const streamed = await streamUntilTerminal(run.id);
  const events = streamed.events;
  const types = events.map((event) => event.type);
  const settled = types.indexOf("pi.agent_settled");
  const completed = types.indexOf("run.completed");
  const text = assistantText(events);
  const final = await api("GET", `/runs/${run.id}`);
  const replay = await api("GET", `/runs/${run.id}/events?after=0`);
  const replayIds = replay.body.map((event) => event.event_id);
  const streamIds = events.map((event) => event.event_id);
  const sequential = events.every((event, index) => event.sequence === index + 1);
  const modelInfo = events.find((event) => event.type === "pi.response" && event.payload?.command === "get_state")?.payload?.data?.model;
  evidence.runs.success = {
    run_id: run.id,
    terminal_state: final.body.state,
    event_count: events.length,
    last_sequence: events.at(-1)?.sequence,
    event_types: types,
    text_delta_count: events.filter((event) => event.type === "pi.message_update" && event.payload?.assistantMessageEvent?.type === "text_delta").length,
    assistant_text: text,
    model: modelInfo ? { provider: modelInfo.provider, id: modelInfo.id, api: modelInfo.api, base_url: modelInfo.baseUrl } : null,
    failure_reason: final.body.state === "failed" ? events.find((event) => event.type === "run.failed")?.payload?.reason : undefined,
  };
  record("SSE stream delivers sequential durable events and closes at terminal", streamed.closed && sequential && events.length > 0, `${events.length} events, closed=${streamed.closed}`);
  record("run completed only after agent_settled", final.body.state === "completed" && settled !== -1 && completed !== -1 && settled < completed, `state=${final.body.state} settled@${settled} completed@${completed}${evidence.runs.success.failure_reason ? ` reason=${truncate(evidence.runs.success.failure_reason)}` : ""}`);
  record("model text was streamed and recorded", text.length > 0 && evidence.runs.success.text_delta_count > 0, `${evidence.runs.success.text_delta_count} text deltas, final text ${JSON.stringify(truncate(text, 160))}`);
  record("cursor replay reproduces the exact streamed event identities", replayIds.length === streamIds.length && replayIds.every((id, index) => id === streamIds[index]), `${replayIds.length} replayed`);
  if (mode === "real") record("success text matches the requested marker", text.includes("LUUNA-M1-OK"), JSON.stringify(truncate(text, 120)));
}

async function cancelledRun() {
  const run = await startRun(profile.prompts.cancel, profile.provider, profile.model);
  const inFlight = await waitForEvent(run.id, (event) => event.type === "pi.agent_start" || event.type === "pi.message_update", 60_000);
  const pid = (await api("GET", `/runs/${run.id}/events?after=0`)).body.find((event) => event.type === "pi.spawned")?.payload?.pid;
  const aliveBefore = typeof pid === "number" && processAlive(pid);
  const cancel = await api("POST", `/runs/${run.id}/cancel`);
  const final = await waitForTerminal(run.id, 60_000);
  const events = (await api("GET", `/runs/${run.id}/events?after=0`)).body;
  const aliveAfter = typeof pid === "number" && processAlive(pid);
  const again = await api("POST", `/runs/${run.id}/cancel`);
  evidence.runs.cancelled = { run_id: run.id, pid, terminal_state: final.state, event_types: events.map((event) => event.type), in_flight_event: inFlight?.type ?? null, text_before_cancel: truncate(assistantText(events), 200) };
  record("cancellation reached a genuinely in-flight run", Boolean(inFlight) && cancel.status === 202, `in-flight evidence ${inFlight?.type ?? "none"}, cancel status ${cancel.status}`);
  record("cancelled run terminates as cancelled, never completed", final.state === "cancelled" && !events.some((event) => event.type === "run.completed"), `state=${final.state}`);
  record("owned Pi child was alive before cancel and reaped before run.cancelled", aliveBefore && !aliveAfter, `pid=${pid} alive_before=${aliveBefore} alive_after=${aliveAfter}`);
  record("cancel is idempotent on a terminal run", again.status === 200 && again.body.state === "cancelled", `status ${again.status}`);
}

async function providerFailureRun() {
  const run = await startRun(profile.prompts.failure, profile.provider, profile.failureModel);
  const final = await waitForTerminal(run.id, 120_000);
  const events = (await api("GET", `/runs/${run.id}/events?after=0`)).body;
  const reason = events.find((event) => event.type === "run.failed")?.payload?.reason;
  evidence.runs.failure = { run_id: run.id, model: profile.failureModel, terminal_state: final.state, event_types: events.map((event) => event.type), reason: truncate(reason ?? "", 300) };
  record("provider/model failure persists a failed run without partial success", final.state === "failed" && !events.some((event) => event.type === "run.completed") && Boolean(reason), `state=${final.state} reason=${truncate(reason ?? "", 120)}`);
}

async function crashRestartRecovery() {
  const before = await api("GET", "/runs");
  const snapshot = {};
  for (const existing of before.body) snapshot[existing.id] = (await api("GET", `/runs/${existing.id}/events?after=0`)).body.map((event) => event.event_id);
  const run = await startRun(profile.prompts.restart, profile.provider, profile.model);
  await waitForEvent(run.id, (event) => event.type === "pi.agent_start" || event.type === "pi.message_update", 60_000);
  const pid = (await api("GET", `/runs/${run.id}/events?after=0`)).body.find((event) => event.type === "pi.spawned")?.payload?.pid;
  const runningBefore = (await api("GET", `/runs/${run.id}`)).body.state;
  runtime.kill("SIGKILL");
  await waitForExit(runtime, 10_000);
  const childExit = await waitUntil(() => typeof pid !== "number" || !processAlive(pid), 20_000);
  const orphaned = typeof pid === "number" && processAlive(pid);
  if (orphaned) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  runtime = await startRuntime("restarted");
  const after = await api("GET", `/runs/${run.id}`);
  const events = (await api("GET", `/runs/${run.id}/events?after=0`)).body;
  let preserved = true;
  for (const [id, ids] of Object.entries(snapshot)) {
    const replay = (await api("GET", `/runs/${id}/events?after=0`)).body.map((event) => event.event_id);
    preserved &&= replay.length === ids.length && replay.every((value, index) => value === ids[index]);
  }
  evidence.runs.interrupted = { run_id: run.id, pid, state_before_crash: runningBefore, state_after_restart: after.body.state, child_exited_after_crash_ms: childExit.elapsed, child_orphaned: orphaned, event_types: events.map((event) => event.type), earlier_runs_checked: Object.keys(snapshot).length };
  record("abandoned active attempt is marked interrupted after restart", runningBefore === "running" && after.body.state === "interrupted" && events.some((event) => event.type === "run.interrupted") && !events.some((event) => event.type === "run.completed"), `before=${runningBefore} after=${after.body.state}`);
  record("earlier run histories survive the restart byte-for-byte by event identity", preserved && Object.keys(snapshot).length >= 3, `${Object.keys(snapshot).length} earlier runs compared`);
  record("Pi child exits after the runtime is hard-killed (stdin closed)", !orphaned, `pid=${pid} exited_after_ms=${childExit.elapsed} orphaned=${orphaned}`);
}

async function exclusiveOwnership() {
  const env = { ...process.env, LUUNA_API_TOKEN: token, LUUNA_DATA_DIR: dataDir, LUUNA_PORT: String(port + 1), LUUNA_PI_COMMAND: profile.pi, LUUNA_PI_ARGS_JSON: JSON.stringify(profile.piArgs) };
  const second = spawn(runtimeBinary, [], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  second.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = await waitForExit(second, 15_000);
  if (!exit.exited) second.kill("SIGKILL");
  record("a second runtime cannot take over an owned data directory", exit.exited && second.exitCode !== 0 && /already owns/.test(stderr), `exit=${second.exitCode} stderr=${truncate(stderr.trim(), 120)}`);
}

async function gracefulShutdown() {
  const signal = process.platform === "win32" ? "SIGINT" : "SIGTERM";
  runtime.kill(signal);
  const exit = await waitForExit(runtime, 15_000);
  record(`${signal} performs an orderly shutdown`, exit.exited && runtime.exitCode === 0, `exited=${exit.exited} code=${runtime.exitCode} after ${exit.elapsed}ms`);
  if (!exit.exited) runtime.kill("SIGKILL");
}

// ---------------------------------------------------------------------------

async function api(method, route, body) {
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

async function startRun(prompt, provider, model) {
  const response = await api("POST", "/runs", { prompt, provider, model });
  if (response.status !== 202) throw new Error(`run not accepted (${response.status}): ${JSON.stringify(response.body)}`);
  return response.body;
}

async function waitForTerminal(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api("GET", `/runs/${id}`);
    if (["completed", "failed", "cancelled", "interrupted"].includes(body.state)) return body;
    await sleep(150);
  }
  throw new Error(`run ${id} did not reach a terminal state within ${timeoutMs}ms`);
}

async function waitForEvent(id, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api("GET", `/runs/${id}/events?after=0`);
    const found = body.find(predicate);
    if (found) return found;
    if (body.some((event) => ["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(event.type))) return null;
    await sleep(100);
  }
  return null;
}

/** Consume the SSE stream until the server closes it at the terminal event. */
async function streamUntilTerminal(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (runTimeoutSeconds + 60) * 1000);
  const response = await fetch(`${base}/api/v1/runs/${id}/stream?after=0`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" }, signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`stream rejected: ${response.status}`);
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let closed = false;
  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let separator;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (data) events.push(JSON.parse(data));
      }
    }
    closed = true;
  } finally {
    clearTimeout(timer);
  }
  return { events, closed };
}

function assistantText(events) {
  let deltas = "";
  let finalText = "";
  for (const event of events) {
    const update = event.payload?.assistantMessageEvent;
    if (event.type === "pi.message_update" && update?.type === "text_delta" && typeof update.delta === "string") deltas += update.delta;
    const message = event.payload?.message;
    if (event.type === "pi.message_end" && message?.role === "assistant" && Array.isArray(message.content)) {
      finalText = message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
    }
  }
  return finalText || deltas;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

async function waitForExit(child, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return { exited: true, elapsed: Date.now() - startedAt };
    await sleep(50);
  }
  return { exited: false, elapsed: Date.now() - startedAt };
}

async function waitUntil(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return { satisfied: true, elapsed: Date.now() - startedAt };
    await sleep(50);
  }
  return { satisfied: false, elapsed: Date.now() - startedAt };
}

function environment() {
  const info = { platform: `${platform()} ${release()} ${arch()}`, node: process.version, pi_launcher: profile.pi, pi_launcher_args: profile.piArgs, provider: profile.provider, model: profile.model };
  try { info.git_revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(); } catch { info.git_revision = "unknown"; }
  try { info.git_dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repository, encoding: "utf8" }).trim().length > 0; } catch { info.git_dirty = null; }
  if (mode === "real") {
    try { info.pi_version = execFileSync(profile.pi, [...profile.piArgs, "--version"], { encoding: "utf8" }).trim(); } catch (error) { info.pi_version = `unavailable: ${error.message}`; }
  } else {
    info.pi_version = "synthetic fixture reporting 1.3.0";
  }
  const names = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY"];
  info.provider_credentials_present = names.filter((name) => process.env[name] !== undefined || process.env[`LUUNA_PI_${name}`] !== undefined).map((name) => process.env[`LUUNA_PI_${name}`] !== undefined ? `LUUNA_PI_${name} (alias)` : name);
  try { info.runtime_binary_mtime = statSync(runtimeBinary).mtime.toISOString(); } catch { info.runtime_binary_mtime = "unknown"; }
  return info;
}

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function truncate(value, length = 200) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function markdown(report) {
  const lines = [
    `# Luuna M1 smoke report (${report.mode} mode)`,
    "",
    `Verdict: **${report.verdict}**`,
    "",
    `Started ${report.started_at}, finished ${report.finished_at}. Runtime binary \`${report.runtime_binary}\`, port ${report.port}.`,
    "",
    "## Environment",
    "",
    ...Object.entries(report.environment ?? {}).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`),
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${check.ok ? "pass" : "FAIL"} | ${check.name} | ${escape(check.detail ?? "")} |`),
    "",
    "## Runs",
    "",
  ];
  for (const [label, run] of Object.entries(report.runs ?? {})) {
    lines.push(`### ${label}`, "", "```json", JSON.stringify(run, null, 2), "```", "");
  }
  return lines.join("\n");
}

function escape(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) fail(`unexpected argument ${argument}`);
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) { parsed[key] = true; } else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

function fail(message) {
  console.error(`m1-smoke: ${message}`);
  process.exit(2);
}
