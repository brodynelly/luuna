#!/usr/bin/env node
// Backup, loss, restore and schema-compatibility recovery drill for the MVP
// gate (ADR 0016). It uses the real runtime executable and its documented
// maintenance commands against a disposable data directory, never the
// developer's own `.luuna`. No model is called: the synthetic Pi fixture
// answers the one demo run that gives the database run history.
//
//   node scripts/backup-recovery-drill.mjs [--out <dir>] [--runtime <built luuna-runtime>] [--skip-migration-tests]
//
// Exit code 1 when any check fails. The report (report.md, report.json,
// runtime.log, command transcripts) is written under --out, outside Git.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, closeSync, writeSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => arg.startsWith("--") ? [arg.slice(2), all[index + 1]?.startsWith("--") || all[index + 1] === undefined ? true : all[index + 1]] : []).filter((pair) => pair.length));
const started = new Date();
const out = path.resolve(options.out ?? path.join(tmpdir(), `luuna-backup-drill-${started.toISOString().replace(/[:.]/g, "-")}`));
if (existsSync(out)) { console.error(`Refusing to reuse ${out}; pass a new --out directory.`); process.exit(2); }
mkdirSync(out, { recursive: true });
const python = process.platform === "win32" ? "python" : "python3";
const token = randomBytes(32).toString("hex");
const checks = [];
const notes = [];
const transcripts = [];
function record(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}
function note(text) { notes.push(text); console.log(`note  ${text}`); }

// ---------- host tools ----------
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
function sha256(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }

// ---------- runtime ----------
let runtimeBinary = options.runtime ? path.resolve(options.runtime) : null;
if (!runtimeBinary) {
  console.log("building luuna-runtime (cargo build --locked -p luuna-runtime)…");
  execFileSync("cargo", ["build", "--locked", "-p", "luuna-runtime"], { cwd: repository, stdio: "inherit" });
  runtimeBinary = path.join(repository, "target", "debug", process.platform === "win32" ? "luuna-runtime.exe" : "luuna-runtime");
}
// The drill runs against a private copy so a concurrent rebuild cannot swap the
// executable under it; the report records the copy's digest.
const builtBinary = runtimeBinary;
runtimeBinary = path.join(out, path.basename(builtBinary));
copyFileSync(builtBinary, runtimeBinary);
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
const runtimePort = await freePort();
const dataDir = path.join(out, "runtime-data");
const database = path.join(dataDir, "luuna.sqlite3");
const base = `http://127.0.0.1:${runtimePort}`;
const runtimeLog = path.join(out, "runtime.log");
let runtime = null;
let runtimeExited = null;
function runtimeEnv() {
  return { ...toolEnv(), LUUNA_API_TOKEN: token, LUUNA_DATA_DIR: dataDir, LUUNA_PORT: String(runtimePort), LUUNA_PI_COMMAND: python, LUUNA_PI_ARGS_JSON: JSON.stringify([path.join(repository, "fixtures", "pi-rpc", "mock_pi.py")]), LUUNA_PI_PROVIDER: "test", LUUNA_PI_MODEL: "synthetic", LUUNA_RUN_TIMEOUT_SECONDS: "120" };
}
async function startRuntime(label) {
  const child = spawn(runtimeBinary, [], { env: runtimeEnv(), stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  let exited = null;
  child.stderr.on("data", (chunk) => { stderr += chunk; writeFileSync(runtimeLog, `[${label}] ${chunk}`, { flag: "a" }); });
  runtimeExited = new Promise((resolve) => child.once("exit", (code, signal) => { exited = { code, signal, stderr }; resolve(exited); }));
  const healthy = await waitFor(async () => {
    if (exited) return { exited };
    return fetch(`${base}/health`).then((response) => response.ok).catch(() => false);
  }, 30_000);
  if (healthy?.exited) return { exited: healthy.exited };
  if (!healthy) throw new Error(`runtime (${label}) did not become healthy`);
  runtime = child;
  return { child };
}
async function stopRuntime() {
  if (!runtime) return null;
  const child = runtime;
  runtime = null;
  const response = await api("POST", "/shutdown");
  if (response.status !== 202) { child.kill("SIGKILL"); throw new Error(`shutdown refused with status ${response.status}`); }
  const exited = await Promise.race([runtimeExited, sleep(20_000).then(() => null)]);
  if (!exited) { child.kill("SIGKILL"); await runtimeExited; throw new Error("runtime did not exit after an orderly shutdown"); }
  return exited;
}
async function api(method, route, body) {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body && { "Content-Type": "application/json" }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function maintenance(name, ...args) {
  const result = spawnSync(runtimeBinary, [name, ...args, "--data-dir", dataDir], { encoding: "utf8", env: toolEnv(), timeout: 120_000 });
  const transcript = { command: [name, ...args, "--data-dir", "<data-dir>"], status: result.status, stdout: result.stdout, stderr: result.stderr };
  transcripts.push(transcript);
  writeFileSync(path.join(out, `${name}-${transcripts.length}.txt`), `$ luuna-runtime ${transcript.command.join(" ")}\nexit ${result.status}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`);
  return transcript;
}

// ---------- fixture ----------
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
function createFixture(name) {
  const dir = path.join(out, "fixtures", name);
  mkdirSync(dir, { recursive: true });
  const files = { ".gitignore": "__pycache__/\n", "README.md": `# ${name} fixture\n`, "pyproject.toml": `[project]\nname = "${name}"\n`, "src/__init__.py": "", "src/main.py": "print('fixture')\n", "test_main.py": UNIT_TEST };
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
function manifest(id, name) {
  const checks = [{ id: "unit", executable: python, args: ["-m", "unittest", "-v"], required: true, timeout_seconds: 120, capabilities: ["python"], cwd: "." }];
  return { schema_version: "0.1", id, name, revision: 1, repositories: [{ id: "app", remote: `https://example.invalid/${id}.git`, default_branch: "main", profiles: ["python"], execution: "native", checks }], relationships: [], policy: { approval: "plan", testing_prerequisite: true, publish: "automatic_pr", merge: "human", max_explorers: 1, max_implementers: 1, max_task_repairs: 2 } };
}

/// The authoritative view a client would reload: projects, their events,
/// tickets, runs and every run's durable event stream.
async function snapshot() {
  const projects = (await api("GET", "/projects")).body ?? [];
  const view = { projects, project_events: {}, tickets: {}, runs: (await api("GET", "/runs")).body ?? [], run_events: {} };
  for (const project of projects) {
    view.project_events[project.id] = (await api("GET", `/projects/${project.id}/events`)).body;
    view.tickets[project.id] = (await api("GET", `/projects/${project.id}/tickets`)).body;
  }
  for (const run of view.runs) view.run_events[run.id] = (await api("GET", `/runs/${run.id}/events`)).body;
  return view;
}
let failed = false;
try {
  // 1. Durable state worth losing: a confirmed project, a ticket and a completed demo run.
  const fixture = createFixture("drill");
  const startup = await startRuntime("initial");
  record("runtime starts on an empty data directory", Boolean(startup.child), startup.exited ? startup.exited.stderr.trim() : "");
  const project = await api("POST", "/projects", { id: "drill", name: "Backup drill", repositories: [{ id: "app", path: fixture.dir }] });
  record("project registered", project.status === 201, `status ${project.status}`);
  const discovery = await api("POST", "/projects/drill/discover");
  record("discovery proposed without executing repository commands", discovery.status === 200 || discovery.status === 201, `status ${discovery.status}`);
  const confirmed = await api("PUT", "/projects/drill/manifest", { expected_revision: 0, manifest: manifest("drill", "Backup drill") });
  record("manifest revision 1 confirmed", confirmed.status === 200 || confirmed.status === 201, `status ${confirmed.status}`);
  const ticket = await api("POST", "/projects/drill/tickets", { idempotency_key: `drill-${randomBytes(6).toString("hex")}`, title: "Recovery drill ticket", intent: "Exist before the backup so the restore can be checked.", acceptance_criteria: ["The ticket survives restore byte-for-byte."], repository_ids: ["app"] });
  record("ticket created", ticket.status === 201, `status ${ticket.status}`);
  const demo = await api("POST", "/runs", { prompt: "success", provider: "test", model: "synthetic" });
  record("synthetic demo run accepted", demo.status === 202 || demo.status === 201, `status ${demo.status}`);
  const settled = await waitFor(async () => { const run = (await api("GET", `/runs/${demo.body?.id}`)).body; return run && ["completed", "failed", "cancelled", "interrupted"].includes(run.state) ? run : null; }, 60_000);
  record("demo run settled before the backup", settled?.state === "completed", settled ? settled.state : "never settled");
  const before = await snapshot();
  writeFileSync(path.join(out, "state-before.json"), JSON.stringify(before, null, 2));
  record("authoritative state captured", before.projects.length === 1 && before.runs.length >= 1 && (before.project_events.drill?.length ?? 0) > 0, `${before.projects.length} project, ${before.runs.length} run(s), ${before.project_events.drill?.length ?? 0} project events`);

  // 2. Online backup while the runtime is running; restore refused while it owns the directory.
  const snapshotFile = path.join(out, "snapshot.sqlite3");
  const backup = maintenance("backup", "--output", snapshotFile);
  const schemaLine = /schema_version: (\d+)/.exec(backup.stdout);
  const digestLine = /sha256: ([0-9a-f]{64})/.exec(backup.stdout);
  record("online backup written while the runtime runs", backup.status === 0 && existsSync(snapshotFile), backup.status === 0 ? `schema ${schemaLine?.[1]}, ${statSync(snapshotFile).size} bytes` : backup.stderr.trim());
  record("backup reports the snapshot digest", Boolean(digestLine) && digestLine[1] === sha256(snapshotFile), digestLine ? "digest matches the file" : "no digest printed");
  const liveRestore = maintenance("restore", "--input", snapshotFile);
  record("restore refused while a runtime owns the data directory", liveRestore.status !== 0 && /owns|stop it/.test(liveRestore.stderr + liveRestore.stdout), (liveRestore.stderr || liveRestore.stdout).trim().split("\n")[0]);
  const stillHealthy = await fetch(`${base}/health`).then((r) => r.ok).catch(() => false);
  record("runtime unaffected by the refused restore", stillHealthy);

  // 3. Orderly stop, then the database is lost or corrupted.
  const stopped = await stopRuntime();
  record("orderly authenticated shutdown exits", stopped?.code === 0, `exit ${stopped?.code ?? stopped?.signal}`);
  const healthyBefore = maintenance("check");
  record("check reports a usable database after the stop", healthyBefore.status === 0 && /integrity: ok/.test(healthyBefore.stdout), healthyBefore.stdout.trim().split("\n").find((l) => l.startsWith("schema_version")) ?? "");
  copyFileSync(database, path.join(out, "database-before-corruption.sqlite3"));
  // Overwrite the body of the file (past the 100-byte header and the first page) so
  // SQLite's quick check, not merely the header magic, finds the damage.
  const size = statSync(database).size;
  const fd = openSync(database, "r+");
  const garbage = randomBytes(Math.min(size - 4096, 64 * 1024));
  writeSync(fd, garbage, 0, garbage.length, 4096);
  closeSync(fd);
  const damaged = maintenance("check");
  record("check reports the damaged database", damaged.status !== 0, (damaged.stderr || damaged.stdout).trim().split("\n").filter(Boolean).pop() ?? "");
  const refused = await startRuntime("damaged");
  record("runtime refuses to start on the damaged database before writing", Boolean(refused.exited) && refused.exited.code !== 0, refused.exited ? refused.exited.stderr.trim().split("\n")[0] : "runtime became healthy on a damaged database");
  if (refused.child) await stopRuntime();

  // 4. Restore the verified snapshot and come back with the same authoritative state.
  const restore = maintenance("restore", "--input", snapshotFile);
  record("restore installs the verified snapshot", restore.status === 0 && /restored:/.test(restore.stdout), restore.status === 0 ? restore.stdout.trim().split("\n").find((l) => l.startsWith("previous database")) ?? "" : restore.stderr.trim());
  const movedAside = /previous database moved to: (.+)/.exec(restore.stdout)?.[1]?.trim();
  record("the damaged database was moved aside, not deleted", Boolean(movedAside) && existsSync(movedAside), movedAside ?? "no path printed");
  const restoredCheck = maintenance("check");
  record("check passes after the restore", restoredCheck.status === 0 && /integrity: ok/.test(restoredCheck.stdout));
  const restarted = await startRuntime("restored");
  record("runtime starts on the restored database", Boolean(restarted.child), restarted.exited ? restarted.exited.stderr.trim() : "");
  const after = await snapshot();
  writeFileSync(path.join(out, "state-after-restore.json"), JSON.stringify(after, null, 2));
  record("projects, manifest events, tickets, runs and run events are identical after the restore", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after) === JSON.stringify(before) ? `${after.runs.length} run(s), ${Object.values(after.run_events).flat().length} run events` : "state differs (see state-before.json and state-after-restore.json)");
  const newWork = await api("POST", "/runs", { prompt: "success", provider: "test", model: "synthetic" });
  const newSettled = await waitFor(async () => { const run = (await api("GET", `/runs/${newWork.body?.id}`)).body; return run && ["completed", "failed", "cancelled", "interrupted"].includes(run.state) ? run : null; }, 60_000);
  record("new work completes on the restored database", newSettled?.state === "completed", newSettled?.state ?? "never settled");
  const stoppedAgain = await stopRuntime();
  record("second orderly shutdown exits", stoppedAgain?.code === 0, `exit ${stoppedAgain?.code ?? stoppedAgain?.signal}`);

  // 5. A database written by a newer Luuna is refused, then recovered from the snapshot.
  const current = Number(schemaLine?.[1] ?? 0);
  const bump = spawnSync(python, ["-c", "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nc.execute('INSERT INTO schema_migrations(version) VALUES (?)',(int(sys.argv[2]),))\nc.commit()\nc.close()", database, String(current + 1)], { encoding: "utf8", env: toolEnv(), timeout: 60_000 });
  record("drill marks the database as written by a newer schema", bump.status === 0, bump.stderr.trim());
  const newer = maintenance("check");
  record("check names the newer schema version and the restore step", newer.status !== 0 && /newer/.test(newer.stderr + newer.stdout) && /restore/.test(newer.stderr + newer.stdout), (newer.stderr || newer.stdout).trim().split("\n").filter(Boolean).pop() ?? "");
  const refusedNewer = await startRuntime("newer-schema");
  record("runtime refuses a newer database before writing to it", Boolean(refusedNewer.exited) && refusedNewer.exited.code !== 0 && /newer/.test(refusedNewer.exited.stderr), refusedNewer.exited ? refusedNewer.exited.stderr.trim().split("\n")[0] : "runtime became healthy on a newer database");
  if (refusedNewer.child) await stopRuntime();
  const restoreAgain = maintenance("restore", "--input", snapshotFile);
  record("restore recovers from the newer database", restoreAgain.status === 0);
  const final = await startRuntime("final");
  record("runtime starts again after the second restore", Boolean(final.child), final.exited ? final.exited.stderr.trim() : "");
  const finalState = await snapshot();
  record("state after the second restore equals the backup again", JSON.stringify(finalState) === JSON.stringify(before));
  const finalStop = await stopRuntime();
  record("final orderly shutdown exits", finalStop?.code === 0);

  // 6. Pre-migration snapshots and every earlier schema version: the storage suite's upgrade drill.
  if (options["skip-migration-tests"]) note("migration upgrade tests skipped by request (--skip-migration-tests)");
  else {
    console.log("running cargo test --locked -p luuna-storage --test migrations …");
    const tests = spawnSync("cargo", ["test", "--locked", "-p", "luuna-storage", "--test", "migrations"], { cwd: repository, encoding: "utf8", env: process.env, timeout: 900_000 });
    writeFileSync(path.join(out, "migrations-test.txt"), `${tests.stdout}\n${tests.stderr}`);
    const summary = /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/.exec(tests.stdout);
    record("every earlier schema version upgrades with rows intact under an automatic pre-migration snapshot (luuna-storage migrations suite)", tests.status === 0 && summary?.[1] === "ok", summary ? `${summary[2]} passed, ${summary[3]} failed, ${summary[4]} ignored` : "no test summary");
  }
} catch (error) {
  failed = true;
  record("drill completed without an unexpected error", false, error?.stack ?? String(error));
} finally {
  if (runtime) { runtime.kill("SIGKILL"); runtime = null; }
}

const passed = checks.filter((c) => c.ok).length;
const report = { started: started.toISOString(), finished: new Date().toISOString(), platform: `${process.platform} ${process.arch}`, node: process.version, runtime_binary: builtBinary, runtime_sha256: sha256(runtimeBinary), out, checks, notes, maintenance_commands: transcripts.map((t) => ({ command: t.command, status: t.status })), summary: `${passed}/${checks.length} checks passed` };
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(path.join(out, "report.md"), `# Backup and recovery drill\n\n${report.started} on ${report.platform}, Node ${report.node}. Runtime executable sha256 \`${report.runtime_sha256}\`.\n\n| Check | Result | Detail |\n| --- | --- | --- |\n${checks.map((c) => `| ${c.name} | ${c.ok ? "pass" : "FAIL"} | ${c.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`).join("\n")}\n\n${notes.map((n) => `- ${n}`).join("\n")}\n\n**${report.summary}.** This drill is lifecycle evidence for ADR 0016 on this host only; it exercised the synthetic Pi fixture, never a provider.\n`);
console.log(`\n${report.summary}; report in ${out}`);
process.exit(failed || passed !== checks.length ? 1 : 0);
