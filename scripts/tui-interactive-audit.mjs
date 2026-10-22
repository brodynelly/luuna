#!/usr/bin/env node
// Luuna interactive TUI audit (ADR 0027 point 5, ADR 0020 "What remains"): drives the terminal
// client's INTERACTIVE mode (`luuna-tui` with no command) inside real pseudo-terminals provided
// by tmux, against a built runtime and the SYNTHETIC Pi fixture, and audits what the command-mode
// smoke (scripts/tui-smoke.mjs) cannot: the menus and their keyboard handling (arrows, Enter,
// Esc, r, q), prompts, text-screen scrolling, the outage header and its recovery, the six status
// tones and their plain-text degradation (NO_COLOR, no TTY), and rendering at 40, 60 and 80
// columns and 12 rows without horizontal overflow, with the help footer always visible.
// Client evidence only, never provider evidence: no model is called.
//
//   node scripts/tui-interactive-audit.mjs [--out <dir>] [--runtime <built luuna-runtime>] [--keep] [--tmux <tmux binary>] [--socket <tmux socket name>]
//
// Requirements: tmux (3.2 or later, for `new-session -e`), the pinned toolchains (cargo unless
// --runtime is given, Node 22, python3, git) and `npm ci` done at the root. The tmux server runs
// on its own socket (`-L luuna-audit` by default) and is killed at the end, so no other tmux
// session is touched. Exit code 1 when any check fails.
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
const out = path.resolve(options.out ?? path.join(tmpdir(), `luuna-tui-interactive-audit-${started.toISOString().replace(/[:.]/g, "-")}`));
if (existsSync(out)) { console.error(`Refusing to reuse ${out}; pass a new --out directory.`); process.exit(2); }
mkdirSync(path.join(out, "captures"), { recursive: true });
const python = process.platform === "win32" ? "python" : "python3";
const token = randomBytes(32).toString("hex");
const tuiBin = path.join(repository, "packages", "tui", "bin", "luuna-tui.mjs");
const tmuxBin = typeof options.tmux === "string" ? options.tmux : existsSync("/usr/bin/tmux") ? "/usr/bin/tmux" : "tmux";
const socket = typeof options.socket === "string" ? options.socket : "luuna-audit";
const checks = [];
const notes = [];
let captureCount = 0;
function record(name, ok, detail = "", evidence = "") {
  checks.push({ name, ok: Boolean(ok), detail, evidence: trimEvidence(evidence) });
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}
function note(text) { notes.push(text); console.log(`note  ${text}`); }
/** Evidence is captured pane text, trimmed to its non-empty rows (at most 12) with escape bytes made visible. */
function trimEvidence(text) {
  const rows = String(text ?? "").replace(/\u001b/g, "ESC").split("\n").map((row) => row.trimEnd()).filter((row) => row.length);
  return rows.length > 12 ? [...rows.slice(0, 10), `… (${rows.length - 10} more rows)`, rows.at(-1)].join("\n") : rows.join("\n");
}
function saveCapture(label, text) {
  captureCount += 1;
  const file = path.join(out, "captures", `${String(captureCount).padStart(3, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`);
  writeFileSync(file, text);
  return file;
}

// ---------- host tools (as in scripts/tui-smoke.mjs) ----------
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

// ---------- processes ----------
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
    server.on("error", reject);
  });
}
async function waitFor(predicate, timeoutMs, every = 150) {
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
  return Promise.race([runtimeExited, sleep(15_000).then(() => null)]);
}
async function api(method, route, body) {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body && { "Content-Type": "application/json" }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
}
/** One non-interactive TUI command (as scripts/tui-smoke.mjs runs them); the token travels only in the environment. */
function tui(args, { json = true, env = {}, stdin = "ignore" } = {}) {
  return new Promise((resolve) => {
    const argv = json ? [...args, "--json"] : args;
    const child = execFile(process.execPath, [tuiBin, ...argv], { env: { ...toolEnv(), LUUNA_URL: base, LUUNA_API_TOKEN: token, ...env }, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      let value = null;
      if (json) { const last = stdout.trim().split("\n").at(-1); try { value = last ? JSON.parse(last) : null; } catch { value = null; } }
      resolve({ code, stdout, stderr: stderr.trim(), value });
    });
    if (stdin !== "ignore") { child.stdin.end(stdin); }
  });
}

// ---------- tmux: real pseudo-terminals ----------
const sessions = new Set();
function tmux(...args) {
  return execFileSync(tmuxBin, ["-L", socket, ...args], { encoding: "utf8", env: toolEnv(), timeout: 30_000 }).replace(/\n$/, "");
}
const shellQuote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
/**
 * Opens a detached tmux session of `columns` x `rows` running `command` in a shell; after the
 * command exits the pane prints its exit code and the terminal's line discipline (stty) and stays
 * open so the audit can inspect what the client left behind. Environment goes through tmux's
 * `-e` (never through the command line, so the token is not in any process list).
 */
function open(name, { columns, rows, command, env = {} }) {
  const environment = { LUUNA_URL: base, LUUNA_API_TOKEN: token, ...env };
  const flags = Object.entries(environment).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const script = `${command}; code=$?; printf '\\n@@EXIT=%s@@\\n' "$code"; stty -a | tr -s '\\n' ' '; printf '\\n@@STTY@@\\n'; sleep 900`;
  tmux("new-session", "-d", "-s", name, "-x", String(columns), "-y", String(rows), ...flags, script);
  sessions.add(name);
  return name;
}
const openTui = (name, size, env) => open(name, { ...size, command: `${shellQuote(process.execPath)} ${shellQuote(tuiBin)}`, env });
/** The pane's text; `escapes` keeps SGR attributes, `join` joins wrapped rows, `history` starts at the top of the scrollback. */
function capture(name, { escapes = false, join = false, history = false } = {}) {
  return tmux("capture-pane", "-p", "-t", name, ...(escapes ? ["-e"] : []), ...(join ? ["-J"] : []), ...(history ? ["-S", "-"] : []));
}
function pane(name) {
  const [columns, rows, cursorX, cursorY, alternate, cursorVisible, history] = tmux("display-message", "-p", "-t", name, "#{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{alternate_on} #{cursor_flag} #{history_size}").split(" ").map(Number);
  return { columns, rows, cursorX, cursorY, alternate: alternate === 1, cursorVisible: cursorVisible === 1, history };
}
function keys(name, ...names) { tmux("send-keys", "-t", name, ...names); }
function type(name, text) { tmux("send-keys", "-t", name, "-l", text); keys(name, "Enter"); }
/** Waits until the pane shows `pattern`; returns the capture or null. */
async function waitPane(name, pattern, timeoutMs = 10_000) {
  return waitFor(() => { const text = capture(name); return pattern.test(text) ? text : null; }, timeoutMs);
}
/** The menu item labels of a rendered screen: the rows between the blank row under the title and the footer. */
function menuRows(text) {
  const rows = text.split("\n");
  const items = [];
  for (let index = 4; index < rows.length - 1; index += 1) {
    if (!rows[index].trim()) break;
    items.push(rows[index]);
  }
  return items;
}
const cursorRow = (text) => menuRows(text).findIndex((row) => row.startsWith(">"));
/** Moves to the menu item matching `pattern` (Home, then Down through the viewport) and presses Enter; returns the item's index. */
async function choose(name, pattern) {
  keys(name, "Home");
  await sleep(150);
  let index = 0;
  for (let page = 0; page < 10; page += 1) {
    const items = menuRows(capture(name));
    const cursor = items.findIndex((row) => row.startsWith(">"));
    const match = items.findIndex((row) => pattern.test(row));
    if (match !== -1) {
      for (let step = cursor; step < match; step += 1) keys(name, "Down");
      index += match - cursor;
      keys(name, "Enter");
      return index;
    }
    const steps = Math.max(1, items.length - cursor);
    for (let step = 0; step < steps; step += 1) keys(name, "Down");
    index += steps;
    await sleep(200);
  }
  throw new Error(`no menu item matches ${pattern} in:\n${capture(name)}`);
}
/** Esc, then a pause: the client reads a lone escape byte after readline's escape timeout. */
async function escape(name) { keys(name, "Escape"); await sleep(600); }
/**
 * Every SGR parameter in effect at the first match of `word` (a string or a RegExp over the plain
 * text) on the first row that holds it. tmux re-encodes attributes when it captures with -e, so
 * parameters are compared, never byte sequences.
 */
function attributesBefore(text, word) {
  const strip = (line) => line.replace(/\u001b\[[0-9;]*m/g, "");
  const row = text.split("\n").find((line) => (word instanceof RegExp ? word.test(strip(line)) : strip(line).includes(word)));
  if (!row) return null;
  const plain = strip(row);
  const target = word instanceof RegExp ? plain.search(word) : plain.indexOf(word);
  const active = new Set();
  let index = 0;
  let column = 0;
  while (index < row.length) {
    const sgr = /^\u001b\[([0-9;]*)m/.exec(row.slice(index));
    if (sgr) {
      const params = sgr[1] === "" ? ["0"] : sgr[1].split(";");
      for (const param of params) { if (param === "0") active.clear(); else active.add(param); }
      index += sgr[0].length;
      continue;
    }
    if (column === target) return [...active];
    index += 1;
    column += 1;
  }
  return null;
}
const HAS_ESCAPE = /\u001b/;
/** Layout checks shared by every size: header on the first row, footer on the last, no row wider than the pane, cursor inside it. */
function layout(name, footerPattern) {
  const info = pane(name);
  const plain = capture(name);
  const joined = capture(name, { join: true }).split("\n");
  const rows = plain.split("\n");
  const widest = Math.max(...joined.map((row) => [...row].length));
  const footerRow = rows.findLastIndex((row) => footerPattern.test(row));
  return { info, plain, widest, footerRow, headerFirst: /^luuna · /.test(rows[0] ?? ""), footerLast: footerRow === info.rows - 1, noOverflow: widest <= info.columns, cursorInside: info.cursorY < info.rows && info.cursorX < info.columns, ok: /^luuna · /.test(rows[0] ?? "") && footerRow === info.rows - 1 && widest <= info.columns && info.cursorY < info.rows && info.cursorX < info.columns && info.history === 0 };
}
const layoutDetail = (result) => `${result.info.columns}x${result.info.rows}: widest row ${result.widest}, footer on row ${result.footerRow + 1}, cursor (${result.info.cursorX},${result.info.cursorY}), history ${result.info.history}`;

// ---------- scenarios ----------
const fixture = {};
let projectId = "audit";
const MENU = /q quit|Esc q/;
const TEXT_FOOTER = /lines \d+–\d+ of \d+|\d+–\d+ of \d+ · ↑↓ Esc q/;

async function mainFlow() {
  const name = "main";
  openTui(name, { columns: 80, rows: 24 });
  // 1. The main menu and its header.
  let text = await waitPane(name, /Workbench/);
  let info = pane(name);
  const headerPattern = new RegExp(`^luuna · connected · ${base.replace(/[.]/g, "\\.")}`);
  record("main menu: renders with the connection header, the Workbench title, the cursor on the first item and the help footer on the last row", text && headerPattern.test(text.split("\n")[0]) && cursorRow(text) === 0 && /^> Home summary/.test(menuRows(text)[0] ?? "") && layout(name, MENU).ok && info.alternate && !info.cursorVisible, text ? `${menuRows(text).length} items; alternate screen ${info.alternate}; cursor hidden ${!info.cursorVisible}` : "no Workbench", text ?? capture(name));
  const escaped = capture(name, { escapes: true });
  record("main menu: the connected header carries the success tone on a colour terminal", (attributesBefore(escaped, "connected") ?? []).includes("32"), `SGR before "connected": ${JSON.stringify(attributesBefore(escaped, "connected"))}`, escaped.split("\n")[0]);
  // 2. Arrow keys move the cursor; Enter opens a submenu; Esc goes back.
  keys(name, "Down", "Down");
  text = await waitPane(name, /^> Projects ›/m, 3_000);
  keys(name, "Up");
  const afterUp = await waitPane(name, /^> Kanban projection/m, 3_000);
  record("keys: Down moves the cursor two items down and Up moves it back", text && cursorRow(text) === 2 && afterUp && cursorRow(afterUp) === 1, `cursor rows 2 then 1`, text);
  keys(name, "Down", "Enter");
  text = await waitPane(name, /^Projects$/m);
  record("keys: Enter opens the Projects submenu, which is empty before any registration", text && /\(nothing here\)/.test(text) && layout(name, MENU).ok, "title Projects; (nothing here)", text);
  await escape(name);
  text = await waitPane(name, /^Workbench$/m);
  record("keys: Esc returns to the Workbench", Boolean(text) && cursorRow(text) === 2, "title Workbench; the cursor stays on Projects ›", text);
  // 3. Registration through the prompts (a real flow).
  fixture.audit = createFixture("audit");
  await choose(name, /^..Registration /);
  text = await waitPane(name, /Project name:/);
  info = pane(name);
  record("prompt: choosing Registration asks for the project name inside the frame, with the key hint above it and the cursor shown", text && info.cursorVisible && /Enter submits/.test(text.split("\n")[1] ?? "") && /^Project name:/m.test(text), `cursor visible ${info.cursorVisible} at (${info.cursorX},${info.cursorY})`, text);
  type(name, "Audit");
  await waitPane(name, /Repository id:/);
  type(name, "app");
  await waitPane(name, /Repository root path:/);
  type(name, fixture.audit.dir);
  text = await waitPane(name, /Further repositories/);
  record("prompt: each answer is echoed on its own row and a list prompt follows", text && /Project name: Audit/.test(text) && /Repository id: app/.test(text) && /\s1:/.test(text), "", text);
  keys(name, "Enter");
  text = await waitPane(name, /\(register\)$/m);
  projectId = /^Audit \((\S+)\)\s+unconfirmed/m.exec(text ?? "")?.[1] ?? "audit";
  const view = await api("GET", `/projects/${projectId}`);
  const registered = layout(name, TEXT_FOOTER);
  record("prompt: the registration is sent and the result screen shows the runtime's read-only observation", text && /^Audit \(\S+\)\s+unconfirmed/m.test(text) && /repository app ·/.test(text) && view.status === 200 && view.body?.repositories?.[0]?.observation?.head_commit === fixture.audit.head && registered.ok, `project ${projectId}; HEAD ${fixture.audit.head.slice(0, 12)} recorded by the API; ${layoutDetail(registered)}`, text);
  await escape(name);
  text = await waitPane(name, /^Workbench$/m);
  record("prompt: Esc from the result returns to the menu the action was chosen from", Boolean(text), "", text);
  // 4. The project appears in Projects ›, its submenu opens.
  await choose(name, /^..Projects ›/);
  text = await waitPane(name, new RegExp(`^> Audit\\s+${projectId} · unconfirmed`, "m"));
  record("menus: the registered project is listed with its id and unconfirmed state", Boolean(text), "", text);
  const unconfirmed = attributesBefore(capture(name, { escapes: true }), "unconfirmed");
  record("tones: an unconfirmed project carries the attention tone", (unconfirmed ?? []).includes("33"), `SGR before "unconfirmed": ${JSON.stringify(unconfirmed)}`);
  keys(name, "Enter");
  text = await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
  record("menus: the project screen offers tickets, runs and every project action", text && /Tickets, plans and candidates ›/.test(text) && /Discovery\s+discover/.test(text) && /Manifest confirmation\s+confirm/.test(text) && layout(name, MENU).ok, `${menuRows(text ?? "").length} items`, text);
  // 5. A text screen scrolls (discovery prints the proposed manifest).
  await choose(name, /^..Discovery /);
  text = await waitPane(name, /^Discovery \(discover\)/m);
  const footer = /lines (\d+)–(\d+) of (\d+)/.exec(text ?? "");
  const firstRow = text?.split("\n")[4];
  keys(name, "Down");
  const scrolled = await waitPane(name, /lines 2–/, 3_000);
  const scrolledFooter = /lines (\d+)–(\d+) of (\d+)/.exec(scrolled ?? "");
  keys(name, "PageDown");
  const paged = await waitPane(name, /lines (?!2–)\d+–/, 3_000);
  const pagedFooter = /lines (\d+)–(\d+) of (\d+)/.exec(paged ?? "");
  keys(name, "End");
  const ended = await waitPane(name, /lines \d+–(\d+) of \1/, 3_000);
  keys(name, "Home");
  const home = await waitPane(name, /lines 1–/, 3_000);
  const page = footer ? Number(footer[2]) - Number(footer[1]) + 1 : 0;
  const total = footer ? Number(footer[3]) : 0;
  record("text screen: the discovery result shows a 'lines x–y of n' footer, Down scrolls one row, PageDown one page, End and Home jump", footer && total > page && scrolledFooter && Number(scrolledFooter[1]) === 2 && scrolled.split("\n")[4] !== firstRow && pagedFooter && Number(pagedFooter[1]) === Math.min(2 + page, total - page + 1) && ended && home && layout(name, TEXT_FOOTER).ok, `${footer?.[0]} → ${scrolledFooter?.[0]} → ${pagedFooter?.[0]} → End → Home`, scrolled);
  await escape(name);
  await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
  // 6. Confirm the manifest (a file path prompt), start the baseline (a prompt), watch the run through r.
  const manifestPath = path.join(out, "audit-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest(projectId, "Audit"), null, 2));
  await choose(name, /^..Manifest confirmation /);
  await waitPane(name, /Manifest file path:/);
  type(name, manifestPath);
  text = await waitPane(name, /\(confirm\)$/m);
  record("flow: the manifest is confirmed from a typed file path and the result shows revision 1", text && /confirmed manifest: revision 1/.test(text) && (await api("GET", `/projects/${projectId}`)).body?.project?.revision === 1, "", text);
  await escape(name);
  await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
  await choose(name, /^..Baseline\s+baseline /);
  await waitPane(name, /Repository id:/);
  type(name, "app");
  text = await waitPane(name, /\(baseline\)$/m);
  const baselineRun = /^(\S+)\s+(queued|running|completed)\s+baseline · app/m.exec(text ?? "");
  record("flow: the baseline starts from a prompt and the result screen shows the run in the runtime's state", Boolean(baselineRun) && ["queued", "running", "completed"].includes(baselineRun[2]), baselineRun ? `${baselineRun[1]} ${baselineRun[2]}` : "no run line", text);
  await escape(name);
  await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
  await choose(name, /^..Runs of this project ›/);
  text = await waitPane(name, new RegExp(`^Runs of ${projectId}$`, "m"));
  const before = menuRows(text ?? "")[0] ?? "";
  let reloads = 0;
  const completed = await waitFor(async () => { keys(name, "r"); reloads += 1; await sleep(600); const now = capture(name); return /completed\s+baseline · app/.test(now) ? now : null; }, 90_000, 400);
  const apiRun = baselineRun ? (await api("GET", `/runs/${baselineRun[1]}`)).body : null;
  record("keys: r reloads the run list in place until the baseline run reads completed, as the API records", Boolean(completed) && apiRun?.state === "completed" && new RegExp(`^Runs of ${projectId}$`, "m").test(completed ?? ""), `${reloads} reload(s); first row before: ${before.trim().slice(0, 50)}`, completed ?? capture(name));
  const neutral = attributesBefore(capture(name, { escapes: true }), "completed");
  record("tones: a completed baseline run carries the neutral tone in the interactive run list (a finished process is not evidence)", (neutral ?? []).includes("2"), `SGR before "completed": ${JSON.stringify(neutral)}`);
  await escape(name);
  await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
  await choose(name, /^..Baseline listing /);
  text = await waitPane(name, /\(baselines\)$/m);
  const passedAttributes = attributesBefore(capture(name, { escapes: true }), "passed");
  record("tones: a passed baseline carries the success tone in a result screen", text && /\spassed\s+manifest r1/.test(text) && (passedAttributes ?? []).includes("32"), `SGR before "passed": ${JSON.stringify(passedAttributes)}`, text);
  await escape(name);
  await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
  // 7. A ticket through the prompts, then its list and its screen through the menus.
  await choose(name, /^..Ticket creation /);
  await waitPane(name, /Ticket title:/);
  type(name, "Print the greeting");
  await waitPane(name, /Intent:/);
  type(name, "Make src/main.py print the greeting.");
  await waitPane(name, /Acceptance criteria/);
  type(name, "main prints the greeting");
  await waitPane(name, /\s2:/);
  keys(name, "Enter");
  await waitPane(name, /Purpose/);
  keys(name, "Enter");
  text = await waitPane(name, /\(create-ticket\)$/m);
  const ticket = /^(\S+)\s+r1\s+\S+/m.exec(text ?? "");
  record("flow: a ticket is created from the title, intent and criteria prompts", Boolean(ticket) && /Print\s+the greeting/.test(text ?? "") && (await api("GET", `/projects/${projectId}/tickets`)).body?.some((item) => item.id === ticket[1]), ticket?.[1] ?? "no ticket line", text);
  await escape(name);
  await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
  await choose(name, /^..Tickets, plans and candidates ›/);
  text = await waitPane(name, new RegExp(`^Tickets of ${projectId}$`, "m"));
  record("flow: the ticket list of the project opens through the menus and lists the ticket with its revision", text && new RegExp(`^> Print the greeting\\s+${ticket?.[1]} r1`, "m").test(text) && layout(name, MENU).ok, layoutDetail(layout(name, MENU)), text);
  keys(name, "Enter");
  text = await waitPane(name, /^Ticket \S+ · Print the greeting/m);
  record("flow: the ticket screen offers plan revisions and every ticket action", text && /Plan revisions ›/.test(text) && /Planning\s+plan /.test(text) && /Ticket edit\s+edit-ticket/.test(text), "", text);
  await escape(name);
  await escape(name);
  await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
  return name;
}

async function outage(names) {
  const killed = await killRuntime();
  const seen = {};
  for (const name of names) seen[name] = await waitPane(name, /RUNTIME OUTAGE/, 8_000);
  const escaped = capture(names[0], { escapes: true });
  const outageAttributes = attributesBefore(escaped, "RUNTIME OUTAGE");
  record("outage: after the runtime is hard-killed every open client shows RUNTIME OUTAGE in its header within the poll interval", killed && names.every((name) => seen[name]), `${JSON.stringify(killed)}; ${names.filter((name) => seen[name]).length}/${names.length} clients`, seen[names[0]] ?? capture(names[0]));
  record("tones: the outage header carries the interrupted tone (plum), never danger", (outageAttributes ?? []).includes("35") && !(outageAttributes ?? []).includes("31"), `SGR before "RUNTIME OUTAGE": ${JSON.stringify(outageAttributes)}`, escaped.split("\n")[0]);
  const layouts = names.map((name) => [name, layout(name, MENU)]);
  record("outage: the outage header is truncated to each width and no client overflows", layouts.every(([, result]) => result.noOverflow && result.headerFirst && result.footerLast), layouts.map(([name, result]) => `${name} ${layoutDetail(result)}`).join("; "), layouts.map(([name, result]) => `${name}: ${result.plain.split("\n")[0]}`).join("\n"));
  await startRuntime("restart");
  const back = {};
  for (const name of names) back[name] = await waitPane(name, /The runtime answers again/, 15_000);
  record("outage: when the runtime answers again the header clears, the notice says so and the view reloads", names.every((name) => back[name] && /^luuna · connected · /.test(back[name])), `${names.filter((name) => back[name]).length}/${names.length} clients reconnected`, back[names[0]] ?? capture(names[0]));
}

async function sizes() {
  const opened = [];
  for (const size of [{ columns: 40, rows: 24 }, { columns: 60, rows: 24 }, { columns: 80, rows: 12 }, { columns: 40, rows: 12 }]) {
    const name = `s${size.columns}x${size.rows}`;
    openTui(name, size);
    let text = await waitPane(name, /Workbench/);
    const main = layout(name, MENU);
    record(`${size.columns}x${size.rows}: the main menu fits — header first, footer last, no row wider than ${size.columns}, cursor inside`, text && main.ok, layoutDetail(main), main.plain);
    // The viewport: moving past the visible items scrolls the list and keeps the cursor visible.
    for (let step = 0; step < 20; step += 1) keys(name, "Down");
    text = await waitPane(name, /^> User memory export/m, 4_000);
    const end = layout(name, MENU);
    record(`${size.columns}x${size.rows}: Down past the visible items scrolls the viewport, the cursor row stays visible and the footer stays last`, text && cursorRow(text) >= 0 && end.ok && (end.info.rows >= 24 || /\d+–\d+ of \d+/.test(text)), `${layoutDetail(end)}; footer ${text?.split("\n").at(-1)}`, text ?? end.plain);
    keys(name, "Home");
    await choose(name, /^..Projects ›/);
    await waitPane(name, /^> Audit/m);
    keys(name, "Enter");
    await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
    await choose(name, /^..Discovery /);
    text = await waitPane(name, /^Discovery \(discover\)/m);
    const discovery = layout(name, TEXT_FOOTER);
    const joined = capture(name, { join: true }).split("\n");
    const bodyWidest = Math.max(...joined.slice(4, -1).map((row) => [...row].length));
    record(`${size.columns}x${size.rows}: a text screen wraps its rows to the width (widest body row ${bodyWidest}) and keeps the lines footer`, Boolean(text) && discovery.ok, layoutDetail(discovery), discovery.plain);
    await escape(name);
    await waitPane(name, new RegExp(`^Project ${projectId}$`, "m"));
    opened.push(name);
  }
  return opened;
}

async function quitAll(names) {
  for (const name of names) {
    keys(name, "q");
    const text = await waitFor(() => { const all = capture(name, { history: true, join: true }); return /@@STTY@@/.test(all) ? all : null; }, 10_000);
    const info = pane(name);
    const escaped = capture(name, { escapes: true, history: true });
    const exit = /@@EXIT=(\d+)@@/.exec(text ?? "");
    const stty = /@@EXIT=\d+@@\n([\s\S]*?)\n@@STTY@@/.exec(text ?? "")?.[1] ?? "";
    const cooked = /(^|\s)icanon(\s|$)/.test(stty) && /(^|\s)echo(\s|$)/.test(stty) && /(^|\s)isig(\s|$)/.test(stty);
    const afterExit = escaped.slice(escaped.indexOf("@@EXIT="));
    record(`${name}: q quits with exit code 0, the terminal is restored (canonical mode, echo, signals, main screen, cursor shown) and nothing stray is left on screen`, exit?.[1] === "0" && cooked && !info.alternate && info.cursorVisible && !HAS_ESCAPE.test(afterExit) && !/luuna · /.test(text ?? ""), `exit ${exit?.[1] ?? "none"}; alternate ${info.alternate}; cursor visible ${info.cursorVisible}; stty ${stty.split(" ").filter((flag) => /^-?(icanon|echo|isig)$/.test(flag)).join(" ")}`, text ?? capture(name));
    tmux("kill-session", "-t", name);
    sessions.delete(name);
  }
}

async function tones() {
  // Six states through the real formatter, in a real terminal, with and without NO_COLOR; then piped.
  const script = path.join(out, "tones.mjs");
  const formatPath = path.join(repository, "packages", "tui", "src", "format.mjs");
  const runs = [["reviewed", "success"], ["implementing", "active"], ["failed", "danger"], ["plan_ready", "attention"], ["completed", "neutral"], ["interrupted", "interrupted"]];
  writeFileSync(script, `import { colourEnabled, format } from ${JSON.stringify(formatPath)};\nconst runs = ${JSON.stringify(runs.map(([state]) => ({ id: `run-${state}`, state, metadata: { kind: "workflow", plan_id: "plan", plan_revision: 1 }, created_at: "2026-10-22T00:00:00Z" })))};\nprocess.stdout.write(format("runs.list", runs, { colour: colourEnabled({ env: process.env, stdout: process.stdout }) }) + "\\n@@DONE@@\\n");\n`);
  const command = `${shellQuote(process.execPath)} ${shellQuote(script)}`;
  open("tones", { columns: 100, rows: 12, command });
  await waitPane("tones", /@@DONE@@/);
  const escaped = capture("tones", { escapes: true, history: true });
  const codes = Object.fromEntries(runs.map(([state]) => [state, attributesBefore(escaped, new RegExp(`(?<=run-${state}\\s+)${state}`))?.filter((param) => param !== "1") ?? []]));
  const expected = { reviewed: "32", implementing: "36", failed: "31", plan_ready: "33", completed: "2", interrupted: "35" };
  const distinct = new Set(Object.values(codes).map((params) => params.join(";"))).size;
  record("tones: the six tones render as six distinct SGR colours in a terminal (success green, active cyan, danger red, attention yellow, neutral dim, interrupted magenta)", distinct === 6 && runs.every(([state]) => codes[state].includes(expected[state])), Object.entries(codes).map(([state, params]) => `${state}=${params.join(";") || "plain"}`).join(" "), escaped);
  tmux("kill-session", "-t", "tones");
  sessions.delete("tones");
  open("tones-nocolor", { columns: 100, rows: 12, command, env: { NO_COLOR: "1" } });
  await waitPane("tones-nocolor", /@@DONE@@/);
  const plainText = capture("tones-nocolor", { history: true });
  const plainEscaped = capture("tones-nocolor", { escapes: true, history: true });
  record("tones: with NO_COLOR set the same output on a terminal is plain text with the runtime's unchanged state words", plainText && !HAS_ESCAPE.test(plainEscaped.split("@@DONE@@")[0]) && runs.every(([state]) => new RegExp(`run-${state}\\s+${state}\\s`).test(plainText)), "no escape byte before @@DONE@@", plainEscaped);
  tmux("kill-session", "-t", "tones-nocolor");
  sessions.delete("tones-nocolor");
  const piped = await tui(["baselines", projectId], { json: false });
  record("tones: when stdout is not a terminal the baseline listing is plain text (no escape sequences) and still reads passed", piped.code === 0 && !HAS_ESCAPE.test(piped.stdout) && /\spassed\s+manifest r1/.test(piped.stdout), piped.stdout.split("\n")[0], piped.stdout);
  open("baselines-tty", { columns: 100, rows: 12, command: `${shellQuote(process.execPath)} ${shellQuote(tuiBin)} baselines ${shellQuote(projectId)}` });
  const ttyText = await waitPane("baselines-tty", /@@STTY@@/);
  const ttyEscaped = capture("baselines-tty", { escapes: true, history: true });
  const ttyPassed = attributesBefore(ttyEscaped, "passed");
  record("tones: the same baseline listing on a terminal paints passed in the success tone", ttyText && (ttyPassed ?? []).includes("32"), `SGR before "passed": ${JSON.stringify(ttyPassed)}`, ttyEscaped);
  tmux("kill-session", "-t", "baselines-tty");
  sessions.delete("baselines-tty");
  const noTerminal = await tui([], { json: false, stdin: "" });
  record("no terminal: `luuna-tui` without a command and without a terminal prints the help and exits 2 instead of opening the workbench", noTerminal.code === 2 && /interactive workbench/.test(noTerminal.stdout) && !HAS_ESCAPE.test(noTerminal.stdout), `exit ${noTerminal.code}`);
}

// ---------- run ----------
let failure = null;
try {
  try { tmux("kill-server"); } catch { /* no server on this socket */ }
  const version = execFileSync(tmuxBin, ["-V"], { encoding: "utf8" }).trim();
  note(`tmux: ${version} on socket ${socket}; node ${process.version}`);
  await startRuntime("initial");
  const names = [];
  names.push(await mainFlow());
  names.push(...(await sizes()));
  await outage(names);
  await tones();
  await quitAll(names);
} catch (error) {
  failure = error;
  record("audit completed without harness error", false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  for (const name of sessions) { try { saveCapture(`${name}-final`, capture(name, { escapes: true })); } catch { /* gone */ } }
  try { tmux("kill-server"); } catch { /* already gone */ }
  if (runtime) {
    const stop = await tui(["shutdown"]);
    const exited = await Promise.race([runtimeExited, sleep(15_000).then(() => null)]);
    if (!exited) runtime.kill("SIGKILL");
    record("shutdown: the TUI's authenticated shutdown stops the runtime in an orderly way (exit code 0)", stop.code === 0 && stop.value?.status === "shutting_down" && exited?.code === 0, stop.stderr || JSON.stringify(exited));
    runtime = null;
  }
}
for (const [index, check] of checks.entries()) if (check.evidence) check.capture = saveCapture(`${String(index + 1).padStart(2, "0")}-${check.name.slice(0, 40)}`, check.evidence);
const passed = checks.every((check) => check.ok);
const report = {
  mode: "fixture",
  surface: "terminal client (interactive mode, real pseudo-terminals through tmux)",
  verdict: `SYNTHETIC TUI interactive audit ${passed ? "passed" : "FAILED"}: terminal client rendering, keyboard, prompt, outage and tone evidence only, never provider evidence`,
  started_at: started.toISOString(),
  finished_at: new Date().toISOString(),
  runtime_binary: runtimeBinary,
  tmux: tmuxBin,
  ports: { runtime: runtimePort },
  sizes: ["80x24", "40x24", "60x24", "80x12", "40x12"],
  checks,
  notes,
  fixtures: Object.fromEntries(Object.entries(fixture).map(([name, item]) => [name, { head: item.head }])),
};
const lines = ["# Luuna interactive TUI audit", "", `Verdict: **${report.verdict}**`, "", `Started ${report.started_at}, finished ${report.finished_at}. Runtime ${runtimeBinary}; ${notes[0] ?? ""}.`, "", "| Result | Check | Detail |", "| --- | --- | --- |", ...checks.map((check) => `| ${check.ok ? "pass" : "FAIL"} | ${check.name} | ${check.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`), "", "## Evidence (captured pane text, trimmed)", "", ...checks.filter((check) => check.evidence).flatMap((check) => [`### ${check.ok ? "pass" : "FAIL"}: ${check.name}`, "", "```text", check.evidence, "```", ""]), "## Notes", "", ...(notes.length ? notes.map((text) => `- ${text}`) : ["- none"]), ""];
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(path.join(out, "report.md"), lines.join("\n"));
console.log(`\n${report.verdict}\n${checks.filter((check) => check.ok).length}/${checks.length} checks passed. Report written to ${path.join(out, "report.md")}`);
if (!options.keep && passed) { try { rmSync(path.join(out, "runtime-data"), { recursive: true, force: true }); } catch { /* ignore */ } }
process.exit(passed && !failure ? 0 : 1);
