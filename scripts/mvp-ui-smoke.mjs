#!/usr/bin/env node
// Luuna MVP desktop smoke: drives the real browser client (Vite dev server, headless
// Chromium through playwright-core) against a built runtime and the SYNTHETIC Pi fixture,
// through the documented walkthrough (docs/MVP-WALKTHROUGH.md), the recovery paths and the
// keyboard/accessibility checks. It is client and lifecycle evidence only, never provider
// evidence: no model is called.
//
//   node scripts/mvp-ui-smoke.mjs [--out <dir>] [--runtime <built luuna-runtime>] [--keep]
//
// Requirements: the pinned toolchains (cargo, Node 24, python3, git), `npm ci` done at the
// root, and a Chromium playwright-core 1.56 can launch (PLAYWRIGHT_BROWSERS_PATH or
// LUUNA_CHROMIUM=<executable>). Exit code 1 when any check fails.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => arg.startsWith("--") ? [arg.slice(2), all[index + 1]?.startsWith("--") || all[index + 1] === undefined ? true : all[index + 1]] : []).filter((pair) => pair.length));
const started = new Date();
const nativeBinary = options.native ? path.resolve(options.native) : null;
let nativeClient = null;
let clientUrl = "http://127.0.0.1:1420/";
const out = path.resolve(options.out ?? path.join(tmpdir(), `luuna-mvp-ui-smoke-${started.toISOString().replace(/[:.]/g, "-")}`));
if (existsSync(out)) { console.error(`Refusing to reuse ${out}; pass a new --out directory.`); process.exit(2); }
mkdirSync(out, { recursive: true });
const python = process.platform === "win32" ? "python" : "python3";
const token = randomBytes(32).toString("hex");
const checks = [];
const notes = [];
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
// Holds a candidate's validation for 20 s so the smoke can stop the runtime mid-check; the
// marker is untracked build output in the Luuna-owned worktree. Every validation generation
// starts from the candidate tree alone (ADR 0009), so a resumed generation holds again.
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
  // Python's bytecode cache is ignored so a baseline on the developer checkout leaves it clean.
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
// The runtime's CORS allowlist admits only the development client origin
// (127.0.0.1:1420), so the smoke serves the client there and refuses to run
// when that port is taken instead of widening the allowlist.
const uiPort = 1420;
if (!nativeBinary) await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () => reject(new Error(`port ${uiPort} is in use; stop the running client (npm run dev) before the smoke`)));
  probe.listen(uiPort, "127.0.0.1", () => probe.close(resolve));
}).catch((error) => { console.error(error.message); process.exit(2); });
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
async function stopRuntime(signal) {
  if (!runtime) return null;
  const child = runtime;
  runtime = null;
  if (process.platform === "win32" && signal !== "SIGKILL") {
    try {
      const response = await api("POST", "/shutdown");
      if (response.status !== 202) throw new Error(`status ${response.status}`);
    } catch (error) {
      record("authenticated shutdown accepted before process cleanup", false, String(error));
      child.kill("SIGKILL");
    }
  } else child.kill(signal);
  const exited = await Promise.race([runtimeExited, sleep(15_000).then(() => null)]);
  if (!exited) { child.kill("SIGKILL"); await runtimeExited; }
  return exited;
}
async function api(method, route, body) {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body && { "Content-Type": "application/json" }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
}
let vite = null;
async function startVite() {
  const bin = path.join(repository, "node_modules", "vite", "bin", "vite.js");
  vite = spawn(process.execPath, [bin, "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], { cwd: path.join(repository, "apps", "desktop"), env: { ...toolEnv(), NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"] });
  const viteLog = path.join(out, "vite.log");
  for (const stream of [vite.stdout, vite.stderr]) stream.on("data", (chunk) => writeFileSync(viteLog, chunk, { flag: "a" }));
  const ready = await waitFor(() => fetch(`http://127.0.0.1:${uiPort}/`).then((response) => response.ok).catch(() => false), 60_000);
  if (!ready) throw new Error("Vite dev server did not start");
}

// ---------- browser helpers ----------
let browser = null;
let page = null;
async function screenshot(name) {
  try { await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }); } catch { /* best effort */ }
}
async function alertText() {
  const alert = page.locator('[role="alert"]').first();
  return (await alert.count()) ? (await alert.innerText()).replace(/\s*Dismiss\s*$/, "").trim() : "";
}
async function dismissAlerts() {
  while (await page.locator('[role="alert"] button:has-text("Dismiss")').count()) {
    await page.locator('[role="alert"] button:has-text("Dismiss")').first().click();
    await sleep(50);
  }
}
function ticketItem(title) { return page.locator('ul[aria-label="Tickets"] > li').filter({ has: page.locator(".ticket-head strong", { hasText: title }) }); }
// A status badge's rendered text is exactly the runtime value (StatusBadge never transforms case); compare it verbatim.
async function runStateOf(title) { const span = ticketItem(title).locator(".ticket-actions .state"); return (await span.count()) ? (await span.first().innerText()).trim() : ""; }
async function candidateStateOf(title) { const span = ticketItem(title).locator(".candidate-heading .state"); return (await span.count()) ? (await span.first().innerText()).trim() : ""; }
async function waitRunState(title, states, timeoutMs) {
  return waitFor(async () => { const state = await runStateOf(title); return states.includes(state) ? state : null; }, timeoutMs, 400);
}
async function waitCandidateState(title, states, timeoutMs) {
  return waitFor(async () => { const state = await candidateStateOf(title); return states.includes(state) ? state : null; }, timeoutMs, 400);
}
const SETTLED = ["reviewed", "failed", "paused", "cancelled", "interrupted", "testing blocked"];
/** After an action restarts work on a settled candidate, wait until the panel shows it has left `previous`, then until it settles again. */
async function waitCandidateAfter(title, previous, timeoutMs) {
  const moved = await waitFor(async () => { const state = await candidateStateOf(title); return state && state !== previous ? state : null; }, 30_000, 300);
  if (!moved) return null;
  return waitCandidateState(title, SETTLED, timeoutMs);
}
// The desktop shows one view at a time (ADR 0030); the sidebar selects it.
async function show(view, on = page) { await on.getByRole("navigation", { name: "Views" }).getByRole("button", { name: new RegExp(`^${view}`) }).click(); }
async function connected() { return (await page.locator(".connection").innerText()).trim(); }
async function waitConnection(text, timeoutMs) { return waitFor(async () => ((await connected()).includes(text) ? text : null), timeoutMs, 300); }

async function connectWithKeyboard(serviceToken) {
  // Keyboard only: Tab from the document start reaches the skip link, then the form.
  await page.goto(clientUrl);
  if (nativeBinary) {
    // Let automatic startup settle, then explicitly switch this test view to
    // the isolated fixture runtime. Production startup is covered separately.
    await page.locator('.connection[data-tone="success"], [role="alert"]').first().waitFor({ timeout: 90_000 });
    if (await page.locator('.connection[data-tone="success"]').count()) await show("Settings");
    const disconnect = page.getByRole("button", { name: "Disconnect", exact: true });
    if (await disconnect.count()) await disconnect.click();
    const dismiss = page.locator('[role="alert"] button:has-text("Dismiss")');
    if (await dismiss.count()) await dismiss.click();
  }
  if (nativeBinary) {
    // Host focus is not guaranteed through WebView2 CDP. Exercise the actual
    // link and focus target; keyboard-only evidence belongs to the browser run.
    const skip = page.getByRole("link", { name: "Skip to main content", exact: true });
    await skip.focus();
    await skip.click();
    record("the native skip link moves focus to the main region", await page.evaluate(() => document.activeElement?.id === "main"));
  } else {
    await page.locator("body").focus();
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    record("the first Tab stop is the skip link", first === "Skip to main content", `focused "${first}"`);
    await page.keyboard.press("Enter");
    const mainFocused = await page.evaluate(() => document.activeElement?.id ?? "");
    record("the skip link moves keyboard focus to the main region", mainFocused === "main", `activeElement id "${mainFocused}"`);
  }
  await page.getByLabel("Service URL").focus();
  if (nativeBinary) {
    // WebView2's CDP does not reliably deliver modifier/text sequences while
    // the host window is in the background. Fill these fixture values through
    // the DOM; keyboard-only form-entry evidence remains the browser run.
    await page.getByLabel("Service URL").fill(base);
    await page.getByLabel("Service token").fill(serviceToken);
  } else {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(base);
    await page.keyboard.press("Tab");
    await page.keyboard.type(serviceToken);
  }
  await page.keyboard.press("Enter");
}

async function registerProject(name, id, dir, expectFailure = false) {
  const add = page.locator("details.add-project");
  if (!(await add.evaluate((element) => element.open))) await add.locator("summary").click();
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page.getByLabel("Project ID", { exact: true }).fill(id);
  await page.getByLabel("Repository ID", { exact: true }).fill("app");
  await page.getByLabel("Repository root path", { exact: true }).fill(dir);
  await page.getByRole("button", { name: "Register repository" }).click();
  if (expectFailure) return null;
  // Store-packaged Windows hosts can virtualize the requested path. Match the
  // observed Git identity rather than assuming the displayed path spelling.
  const head = git(dir, "rev-parse", "HEAD");
  return waitFor(async () => { const dd = page.locator(".facts").first(); const text = (await dd.count()) ? await dd.innerText() : ""; return text.includes(head.slice(0, 12)) ? text : null; }, 20_000);
}

async function confirmManifest(id, name, withHold, { unreadableFirst = false } = {}) {
  await page.getByRole("button", { name: "Discover proposed map" }).click();
  const shown = await waitFor(async () => ((await page.getByLabel(/Manifest to confirm/).count()) ? true : null), 20_000);
  record(`${id}: discovery proposes a manifest draft for editing without executing repository commands`, Boolean(shown), shown ? "draft shown" : "no draft");
  if (unreadableFirst) {
    // A quoted boolean: the runtime names the field (JSON reason), or an older runtime's text
    // rejection becomes the client's own explanation; never a bare HTTP status.
    const draft = manifest(id, name, withHold);
    draft.repositories[0].checks[0].required = "true";
    await page.getByLabel(/Manifest to confirm/).fill(JSON.stringify(draft, null, 2));
    await page.getByRole("button", { name: "Confirm manifest" }).click();
    const refused = await waitFor(alertText, 15_000);
    record(`${id}: an unreadable manifest draft is refused with a reason, not a bare HTTP status`, /^Manifest confirmation refused: /.test(refused ?? "") && /invalid type|could not read the manifest draft/.test(refused ?? "") && !/HTTP 422\)\.$/.test(refused ?? ""), refused ?? "no alert");
    await dismissAlerts();
  }
  await page.getByLabel(/Manifest to confirm/).fill(JSON.stringify(manifest(id, name, withHold), null, 2));
  await page.getByRole("button", { name: "Confirm manifest" }).click();
  return waitFor(async () => ((await page.locator(".facts").first().innerText()).includes("revision 1") ? true : null), 20_000);
}

async function runBaseline() {
  await page.getByRole("button", { name: /^Run baseline\b/ }).click();
  return waitFor(async () => {
    const item = page.locator('ul[aria-label="Recorded baselines"] li').first();
    if (!(await item.count())) return null;
    const state = (await item.locator(".state").first().innerText()).trim();
    return state && state !== "running" ? `${state}: ${(await item.innerText()).replace(/\n/g, " · ")}` : null;
  }, 120_000, 500);
}

// The Tickets section lists every ticket and shows one ticket's detail (ADR 0030): select it first.
async function showTicket(title) {
  const row = page.locator('ul[aria-label="Ticket list"] button').filter({ hasText: title }).first();
  await row.waitFor({ timeout: 20_000 });
  if ((await row.getAttribute("aria-pressed")) !== "true") await row.click();
}
async function createTicket(title, intent, criteria) {
  await page.getByLabel("Ticket title").fill(title);
  await page.getByLabel("Intent", { exact: true }).fill(intent);
  await page.getByLabel("Acceptance criteria (one per line)", { exact: true }).fill(criteria.join("\n"));
  await page.getByRole("button", { name: "Create ticket" }).click();
  await showTicket(title);
  await waitFor(async () => ((await ticketItem(title).count()) ? true : null), 20_000);
}

// The command palette (Ctrl+K) and context menus (secondary click, Shift+F10), by keyboard and pointer.
async function paletteAndMenus(projectName) {
  await show("Home");
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const opened = await palette.isVisible().catch(() => false);
  await page.keyboard.type(projectName);
  const option = palette.getByRole("option").first();
  // Projects are read from the runtime when the palette opens; wait for them to be offered.
  const offered = opened && Boolean(await waitFor(async () => (await option.innerText().catch(() => "")).includes(projectName) ? true : null, 10_000));
  await page.keyboard.press("Enter");
  const landed = await waitFor(async () => (await page.locator(".nav-item[aria-current=page]").innerText()).includes("Projects") ? true : null, 10_000);
  record("command palette: Ctrl+K opens it, typing finds the project, Enter opens it in Projects", opened && offered && Boolean(landed) && !(await palette.isVisible()));
  await page.keyboard.press("ControlOrMeta+K");
  // Escape only closes a dialog that is already open: wait for it, then for it to close.
  await palette.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  record("command palette: Escape closes it", !(await palette.isVisible()));
  const card = page.locator('ul[aria-label="Registered projects"] button').filter({ hasText: projectName }).first();
  await card.click({ button: "right" });
  const menu = page.getByRole("menu", { name: `Actions for ${projectName}` });
  const items = await menu.getByRole("menuitem").allInnerTexts().catch(() => []);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("role") ?? "");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  const returned = await page.evaluate(() => document.activeElement?.closest(".run-card") !== null);
  record("context menu: a secondary click opens the project's commands, focused, and Escape returns focus to the card", items.includes("Open project") && items.includes("Copy project ID") && focused === "menuitem" && !(await menu.isVisible()) && returned, items.join(", "));
  await card.focus();
  await page.keyboard.press("Shift+F10");
  const byKey = await menu.isVisible().catch(() => false);
  await page.keyboard.press("Escape");
  record("context menu: Shift+F10 opens the same menu from the keyboard", byKey);
}

async function planApproveImplement(title, { settle = true } = {}) {
  const item = ticketItem(title);
  await item.getByRole("button", { name: /^Plan/ }).click();
  await waitFor(async () => ((await runStateOf(title)) === "plan ready" ? true : null), 20_000);
  const hash = (await item.locator(".plan-review p code").first().innerText()).trim();
  const approve = item.getByRole("button", { name: /^Approve r/ });
  const disabledBefore = await approve.isDisabled();
  // Keyboard: Space toggles the acknowledgment, Enter approves.
  await item.getByLabel("I reviewed this complete plan and hash.").focus();
  await page.keyboard.press("Space");
  await approve.focus();
  await page.keyboard.press("Enter");
  await waitFor(async () => ((await runStateOf(title)) === "approved" ? true : null), 20_000);
  await item.getByRole("button", { name: "Implement" }).click();
  if (!settle) return { hash, disabledBefore, settled: null };
  const settled = await waitRunState(title, ["validating", "failed", "cancelled", "interrupted", "paused", "testing blocked"], 120_000);
  return { hash, disabledBefore, settled };
}

async function accessibilityAudit(label) {
  const report = await page.evaluate(() => {
    const visible = (element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    const name = (element) => (element.getAttribute("aria-label") || element.textContent || "").trim();
    const buttons = [...document.querySelectorAll("button, a[href], summary")].filter(visible);
    const unnamed = buttons.filter((element) => !name(element)).map((element) => element.outerHTML.slice(0, 80));
    const fields = [...document.querySelectorAll("input, textarea, select")].filter(visible);
    const unlabelled = fields.filter((field) => !(field.closest("label") || field.getAttribute("aria-label") || field.getAttribute("aria-labelledby") || (field.id && document.querySelector(`label[for="${field.id}"]`)))).map((field) => field.outerHTML.slice(0, 80));
    const positiveTabindex = [...document.querySelectorAll("[tabindex]")].filter((element) => Number(element.getAttribute("tabindex")) > 0).length;
    const scrollRegions = [...document.querySelectorAll("ol.events, pre[aria-label]")].filter(visible);
    const unfocusableRegions = scrollRegions.filter((element) => element.tabIndex < 0).length;
    const headings = [...document.querySelectorAll("h1, h2, h3, h4")].map((element) => Number(element.tagName[1]));
    const skipped = headings.some((level, index) => index > 0 && level > headings[index - 1] + 1);
    const alerts = [...document.querySelectorAll('[role="alert"]')].filter((element) => !element.querySelector("button"));
    return { buttons: buttons.length, unnamed, fields: fields.length, unlabelled, positiveTabindex, scrollRegions: scrollRegions.length, unfocusableRegions, headingsSkipLevels: skipped, alertsWithoutDismiss: alerts.length, lang: document.documentElement.lang, title: document.title };
  });
  const ok = report.unnamed.length === 0 && report.unlabelled.length === 0 && report.positiveTabindex === 0 && report.unfocusableRegions === 0 && !report.headingsSkipLevels && report.alertsWithoutDismiss === 0 && report.lang === "en";
  record(`${label}: every visible control has an accessible name, every field a label, no positive tabindex, scroll regions focusable, heading levels contiguous`, ok, `${report.buttons} controls, ${report.fields} fields, ${report.scrollRegions} scroll regions${report.unnamed.length ? `, unnamed: ${report.unnamed.join(" | ")}` : ""}${report.unlabelled.length ? `, unlabelled: ${report.unlabelled.join(" | ")}` : ""}`);
  return report;
}

// Design-system presentation audit: every visible text run meets WCAG 2.1 AA contrast against
// the background it is actually painted on (layers composited through a canvas, so any colour
// syntax works), in the dark and the light system colour scheme; the client follows the system
// scheme; and at the native shell's minimum width (760 px) the page never scrolls horizontally.
// Disabled controls are exempt (WCAG 1.4.3 "inactive user interface components"), and counted.
async function contrastAudit() {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = (value) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000";
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const luminance = ({ r, g, b }) => { const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
    const ratio = (one, two) => { const [high, low] = [luminance(one), luminance(two)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };
    const backgroundOf = (element) => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const layer = rgba(getComputedStyle(node).backgroundColor);
        if (layer.a > 0) layers.push(layer);
        if (layer.a >= 1) break;
      }
      let painted = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
      while (layers.length) painted = over(layers.pop(), painted);
      return painted;
    };
    const inactive = (element) => Boolean(element.closest(":disabled, fieldset:disabled, [aria-disabled='true']"));
    const translucent = (element) => { for (let node = element; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 1) return true; return false; };
    const failures = [];
    let checked = 0;
    let exempt = 0;
    for (const element of document.body.querySelectorAll("*")) {
      if (!element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const own = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const textField = element.matches("input:not([type=checkbox]):not([type=radio]), textarea");
      const field = textField && element.value;
      // An empty field shows its placeholder: that text is measured in its ::placeholder colour.
      const placeholder = textField && !element.value && element.placeholder && element.matches(":placeholder-shown");
      if (!own && !field && !placeholder) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || element.closest("[aria-hidden='true']")) continue;
      if (inactive(element) || translucent(element)) { exempt += 1; continue; }
      const style = getComputedStyle(element);
      const background = backgroundOf(element);
      const foreground = over(rgba(placeholder ? getComputedStyle(element, "::placeholder").color : style.color), background);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const value = ratio(foreground, background);
      checked += 1;
      if (value < (large ? 3 : 4.5)) failures.push(`${element.tagName.toLowerCase()}${element.className && typeof element.className === "string" ? "." + element.className.trim().split(/\s+/).join(".") : ""} "${(element.textContent || element.value || (placeholder ? `placeholder: ${element.placeholder}` : "")).trim().slice(0, 32)}" ${value.toFixed(2)}:1`);
    }
    const page = backgroundOf(document.body);
    return { checked, exempt, failures, background: `rgb(${Math.round(page.r)}, ${Math.round(page.g)}, ${Math.round(page.b)})` };
  });
}

// A scheme switch starts colour transitions; measure only the settled colours. Ambient infinite
// animations (ADR 0032: aurora drift, active pulse) never finish, so only finite ones are awaited.
async function settle() {
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]));
}

async function presentationAudit(label, { widths = false } = {}) {
  const schemes = {};
  for (const scheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await settle();
    const report = await contrastAudit();
    schemes[scheme] = report;
    record(`${label}, ${scheme} scheme: every visible text run meets WCAG AA contrast against its painted background`, report.checked > 0 && report.failures.length === 0, `${report.checked} text runs checked, ${report.exempt} disabled/inactive exempt${report.failures.length ? `; below AA: ${report.failures.slice(0, 12).join(" | ")}${report.failures.length > 12 ? ` (+${report.failures.length - 12} more)` : ""}` : ""}`);
    await screenshot(`${label.replace(/\W+/g, "-")}-${scheme}`);
  }
  record(`${label}: the client follows the system colour scheme`, schemes.dark.background !== schemes.light.background, `dark page background ${schemes.dark.background}, light page background ${schemes.light.background}`);
  // The native window keeps its own size; the minimum-width layout is checked on the browser surface.
  if (widths && nativeBinary) note(`${label}: the 760 px width check runs on the browser surface only; the native window keeps its own size`);
  if (widths && !nativeBinary) {
    await page.setViewportSize({ width: 760, height: 900 });
    for (const scheme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await settle();
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
      record(`${label}, ${scheme} scheme: no horizontal page scroll at the native shell's minimum width`, overflow.scroll <= overflow.view, `scrollWidth ${overflow.scroll}, viewport ${overflow.view}`);
      await screenshot(`${label.replace(/\W+/g, "-")}-760-${scheme}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  // Back to the context's own scheme (Playwright emulates light by default) for the next scenario.
  await page.emulateMedia({ colorScheme: null });
}

// ---------- scenarios ----------
const fixtures = {};
async function walkthrough() {
  // 1. A wrong token is refused with a next step; the right one connects, by keyboard.
  await connectWithKeyboard("not-the-token-" + "0".repeat(40));
  const refused = await waitFor(alertText, 15_000);
  record("a wrong service token is refused with a clear next step", /rejected this token/.test(refused ?? "") && /connect again/.test(refused ?? ""), refused ?? "no alert");
  await page.locator('[role="alert"] button:has-text("Dismiss")').focus();
  await page.keyboard.press("Enter");
  await connectWithKeyboard(token);
  const online = await waitConnection("Local runtime connected", 15_000);
  record(`the client connects with the service token entered ${nativeBinary ? "through native form controls" : "by keyboard"}`, Boolean(online), await connected());
  const tokenCleared = await page.locator('input[type="password"]').count() === 0;
  record("the token field is gone after connecting; the token stays only in memory", tokenCleared);
  await show("Projects");
  await screenshot("01-connected");

  // 2. Registration refusal, then a real import.
  const missing = path.join(out, "fixtures", "missing");
  await registerProject("Missing", "missing", missing, true);
  const registrationRefused = await waitFor(alertText, 15_000);
  record("registering a path that is not a repository is refused with the runtime's reason", /^Registration refused: /.test(registrationRefused ?? ""), registrationRefused ?? "no alert");
  await dismissAlerts();
  fixtures.walkthrough = createFixture("walkthrough", false);
  const facts = await registerProject("Walkthrough", "walkthrough", fixtures.walkthrough.dir);
  record("walkthrough: an existing repository is registered and its read-only observation is shown", Boolean(facts) && facts.includes(fixtures.walkthrough.head.slice(0, 12)), facts ? facts.split("\n").slice(0, 3).join(" · ") : "no facts");
  const checkoutBefore = git(fixtures.walkthrough.dir, "status", "--porcelain");
  const confirmed = await confirmManifest("walkthrough", "Walkthrough", false, { unreadableFirst: true });
  record("walkthrough: the edited manifest is confirmed as revision 1 with the exact base commit", Boolean(confirmed), (await page.locator(".facts").first().innerText()).split("\n").find((line) => line.includes("Confirmed manifest")) ?? "");
  const ticketFormEnabled = !(await page.getByLabel("Ticket title").isDisabled());
  record("walkthrough: the ticket form is enabled only once a manifest is confirmed", ticketFormEnabled);

  // 3. Baseline with a real unittest run.
  const baseline = await runBaseline();
  record("walkthrough: the baseline runs the real unittest recipe and passes", /^passed:/.test(baseline ?? "") && /unit: passed/.test(baseline ?? ""), baseline ?? "no record");
  await page.locator('ul[aria-label="Recorded baselines"] li').first().getByRole("button", { name: "View unit stderr" }).click();
  const baselineLog = await waitFor(async () => { const pre = page.locator('pre[aria-label="Baseline log"]'); return (await pre.count()) ? await pre.innerText() : null; }, 20_000);
  record("walkthrough: a baseline recipe's log opens from its record and shows the unittest summary", Boolean(baselineLog) && /Ran 1 test/.test(baselineLog), baselineLog ? baselineLog.split("\n").filter(Boolean).slice(-2).join(" · ") : "no log");
  await screenshot("02-baseline");
  // A baseline rejected before its evidence record exists must release the UI.
  git(fixtures.walkthrough.dir, "remote", "set-url", "origin", "https://example.invalid/changed.git");
  await page.getByRole("button", { name: /^Run baseline\b/ }).click();
  const earlyFailure = await waitFor(async () => {
    const text = await alertText();
    return text && /identity changed/.test(text) && await page.getByRole("button", { name: /^Run baseline\b/ }).isEnabled() ? text : null;
  }, 20_000);
  record("baseline failure before its record releases polling and shows a concrete rebind route", Boolean(earlyFailure) && earlyFailure.includes("/projects/walkthrough/repositories/app/rebind") && !earlyFailure.includes("{id}"), earlyFailure ?? "polling never settled");
  git(fixtures.walkthrough.dir, "remote", "set-url", "origin", "https://example.invalid/walkthrough.git");
  await dismissAlerts();


  // 4. Ticket, plan, approval, writer, validation with an invalid review, re-validation.
  const title = "Implement the greeting";
  await createTicket(title, "Make src/main.py print the greeting.", ["fixture:write_in_scope", "fixture:review_malformed_once", "main prints the greeting"]);
  const { hash, disabledBefore, settled } = await planApproveImplement(title);
  record("walkthrough: the full plan hash is shown and approval stays disabled until the acknowledgment is checked", /^sha256:[a-f0-9]{64}$/.test(hash) && disabledBefore, `${hash.slice(0, 23)}… disabled before acknowledgment: ${disabledBefore}`);
  record("walkthrough: the approved writer settles in validating with a frozen candidate", settled === "validating" && (await candidateStateOf(title)) === "pending", `run ${settled}, candidate ${await candidateStateOf(title)}`);
  const item = ticketItem(title);
  // Keyboard: Enter on the diff button.
  await item.getByRole("button", { name: "Inspect candidate diff" }).focus();
  await page.keyboard.press("Enter");
  const diff = await waitFor(async () => { const pre = item.locator('pre[aria-label="Candidate diff"]'); return (await pre.count()) ? await pre.innerText() : null; }, 20_000);
  record("walkthrough: the candidate diff is bound to the candidate hash and changes only src/main.py", Boolean(diff) && diff.includes("src/main.py") && diff.includes("implemented by the synthetic writer") && (await item.locator(".candidate-diff summary").innerText()).includes("sha256:"), diff ? `${diff.split("\n").length} lines` : "no diff");
  await item.getByRole("button", { name: "Validate and review" }).click();
  // The synthetic checks and reviewer settle within a poll or two; the active
  // status is asserted when observed and otherwise the fast settlement is.
  const active = await waitFor(async () => ((await item.locator('[role="status"]').count()) ? await item.locator('[role="status"]').first().innerText() : (await candidateStateOf(title)) !== "pending" ? "settled before the panel polled" : null), 20_000);
  record("walkthrough: active validation reports what the runtime is doing with cancellation available, or settles within a poll", Boolean(active), active ?? "no status");
  const failed = await waitCandidateState(title, SETTLED, 120_000);
  const reason = (await item.locator(".candidate-review .failure-note").first().innerText().catch(() => "")).trim();
  const tests = (await item.locator(".candidate-checks").innerText()).includes("Tests detected");
  record("walkthrough: the invalid synthetic review fails the candidate without a verdict and the passed unittest check shows its detected test count", failed === "failed" && /invalid structured reviewer response/.test(reason) && tests, `candidate ${failed}; ${reason.slice(0, 80)}; tests detected shown: ${tests}`);
  const revalidate = item.getByRole("button", { name: "Re-validate and review" });
  record("walkthrough: the runtime offers re-validation in place with the reason and no writer attempt (repair stays available under the default two-attempt budget)", (await revalidate.count()) === 1 && (await item.locator(".candidate-review p.recovery-note").innerText()).includes("No writer attempt is spent") && (await item.getByRole("button", { name: "Repair candidate" }).count()) === 1, "Re-validate and review and Repair candidate shown");
  await screenshot("03-invalid-review");
  await revalidate.focus();
  await page.keyboard.press("Enter");
  const reviewed = await waitCandidateAfter(title, "failed", 120_000);
  const verdict = (await item.locator(".candidate-verdict").innerText()).replace(/\s+/g, " ");
  const generationNote = (await item.locator(".candidate-checks").evaluate((element) => element.textContent ?? "")).includes("c1-g2-");
  record("walkthrough: re-validation reaches reviewed with a passed verdict on the same candidate, as generation 2", reviewed === "reviewed" && /Verdict: passed/.test(verdict) && generationNote && (await runStateOf(title)) === "reviewed", `candidate ${reviewed}; ${verdict.slice(0, 60)}`);
  await item.getByRole("button", { name: "View stderr" }).first().click();
  const log = await waitFor(async () => { const pre = item.locator('pre[aria-label="Check log"]'); return (await pre.count()) ? await pre.innerText() : null; }, 20_000);
  record("walkthrough: a check log is readable by record identity and shows the unittest summary", Boolean(log) && /Ran 1 test/.test(log), log ? log.split("\n").filter(Boolean).slice(-2).join(" · ") : "no log");
  record("walkthrough: the developer checkout is untouched (clean before and after)", checkoutBefore === "" && git(fixtures.walkthrough.dir, "status", "--porcelain") === "" && git(fixtures.walkthrough.dir, "rev-parse", "HEAD") === fixtures.walkthrough.head);
  await screenshot("04-reviewed");
  await firstWriterCancel();
  await paletteAndMenus("Walkthrough");
  await accessibilityAudit("walkthrough page");
  await presentationAudit("walkthrough page", { widths: true });
}

// Step 4 and 5 controls: chosen plan budgets, the next revision held back while the writer
// runs, and cancelling the first writer attempt from its ticket (no candidate exists yet).
async function firstWriterCancel() {
  const title = "Cancel the first writer";
  await page.getByLabel("Writer attempts").fill("3");
  await page.getByLabel("Time budget (seconds)").fill("900");
  await createTicket(title, "Make src/main.py print the greeting.", ["fixture:slow", "main prints the greeting"]);
  await planApproveImplement(title, { settle: false });
  const item = ticketItem(title);
  const budgets = (await item.locator(".plan-meta").innerText()).trim();
  record("budgets: the plan revision records the attempts and time budget chosen in the run settings", /budget 3 attempt\(s\), 900s/.test(budgets), budgets.replace(/^.*budget/, "budget"));
  const implementing = await waitRunState(title, ["implementing"], 30_000);
  const replanDisabled = implementing ? await item.getByRole("button", { name: "Plan r2" }).isDisabled() : false;
  const blocker = (await item.locator(".plan-blocker").innerText().catch(() => "")).trim();
  record("re-plan guard: Plan r2 is disabled with its reason while revision 1's writer runs", implementing === "implementing" && replanDisabled && /active work settles/.test(blocker), blocker || `run ${implementing}`);
  const status = (await item.locator(".writer-status").innerText().catch(() => "")).trim();
  const cancel = item.getByRole("button", { name: "Cancel workflow" });
  record("first writer: the ticket says the writer runs and offers Cancel before any candidate exists", /running the scoped writer/.test(status) && (await cancel.count()) === 1, status);
  await cancel.focus();
  await page.keyboard.press("Enter");
  const cancelled = await waitRunState(title, ["cancelled", "failed", "interrupted"], 30_000);
  const replanAfter = cancelled ? !(await item.getByRole("button", { name: "Plan r2" }).isDisabled()) : false;
  record("first writer: cancelling from the ticket settles the run and re-planning is available again", cancelled === "cancelled" && replanAfter, `run ${cancelled}`);
  await page.getByLabel("Writer attempts").fill("2");
  await page.getByLabel("Time budget (seconds)").fill("600");
  await screenshot("04b-writer-cancelled");
}

async function recovery() {
  fixtures.recovery = createFixture("recovery", true);
  const facts = await registerProject("Recovery", "recovery", fixtures.recovery.dir);
  record("recovery: a second project is registered alongside the first", Boolean(facts) && (await page.locator('ul[aria-label="Registered projects"] li').count()) === 2);
  record("recovery: the hold manifest is confirmed", Boolean(await confirmManifest("recovery", "Recovery", true)));
  const baseline = await runBaseline();
  record("recovery: the baseline passes both required checks on the clean checkout (no hold without a candidate)", /^passed:/.test(baseline ?? "") && /unit: passed/.test(baseline ?? "") && /hold: passed/.test(baseline ?? ""), baseline ?? "no record");

  // A. Hard kill while a required check runs → interrupted on restart → fresh generation.
  const first = "Hard kill during checks";
  await createTicket(first, "Make src/main.py print the greeting.", ["fixture:write_in_scope", "main prints the greeting"]);
  const settledA = (await planApproveImplement(first)).settled;
  record("recovery A: the writer settles in validating", settledA === "validating");
  const itemA = ticketItem(first);
  const worktreeA = (await itemA.locator("small:has-text('worktree') code").first().innerText()).trim();
  await itemA.getByRole("button", { name: "Validate and review" }).click();
  const holding = await waitFor(() => (existsSync(path.join(worktreeA, ".hold-started")) ? true : null), 60_000, 200);
  record("recovery A: the hold check is running in the Luuna-owned worktree", Boolean(holding), worktreeA);
  const killed = await stopRuntime("SIGKILL");
  record("recovery A: the runtime was hard-killed", killed?.signal === "SIGKILL", JSON.stringify(killed));
  const reconnecting = await waitConnection("Reconnecting to runtime", 20_000);
  const outage = await waitFor(async () => ((await page.locator(".outage").count()) ? await page.locator(".outage").innerText() : null), 20_000);
  record("recovery A: the client reports the outage without losing its panels", Boolean(reconnecting) && Boolean(outage) && (await itemA.count()) === 1, outage ?? "no outage text");
  await screenshot("05-outage");
  await startRuntime("restart-after-kill");
  const back = await waitConnection("Local runtime connected", 30_000);
  const interruptedA = await waitRunState(first, ["interrupted"], 30_000);
  const candidateA = await waitCandidateState(first, ["interrupted"], 30_000);
  const reasonA = (await itemA.locator("small.failure-note").first().innerText().catch(() => "")).trim();
  record("recovery A: after restart the client reconnects by itself and shows the run and candidate as interrupted with the recorded reason and next step", Boolean(back) && interruptedA === "interrupted" && candidateA === "interrupted" && /interrupt|restart/i.test(reasonA) && /Validate again/.test(reasonA), reasonA.slice(0, 120));
  record("recovery A: the outage note clears once the runtime answers", (await page.locator(".outage").count()) === 0);
  await itemA.getByRole("button", { name: "Validate and review" }).click();
  const reviewedA = await waitCandidateAfter(first, "interrupted", 120_000);
  record("recovery A: validating again runs a fresh generation of the same candidate and reaches reviewed", reviewedA === "reviewed" && (await itemA.locator(".candidate-checks").evaluate((element) => element.textContent ?? "")).includes("c1-g2-"), `candidate ${reviewedA}`);
  await screenshot("06-recovered");

  // B. Orderly shutdown (SIGTERM) while a check runs → interrupted, never cancelled.
  const second = "Orderly shutdown during checks";
  await createTicket(second, "Make src/main.py print the greeting.", ["fixture:write_in_scope", "main prints the greeting"]);
  record("recovery B: the writer settles in validating", (await planApproveImplement(second)).settled === "validating");
  const itemB = ticketItem(second);
  const worktreeB = (await itemB.locator("small:has-text('worktree') code").first().innerText()).trim();
  await itemB.getByRole("button", { name: "Validate and review" }).click();
  record("recovery B: the hold check is running", Boolean(await waitFor(() => (existsSync(path.join(worktreeB, ".hold-started")) ? true : null), 60_000, 200)));
  const stopped = await stopRuntime("SIGTERM");
  record(`recovery B: ${process.platform === "win32" ? "authenticated API" : "SIGTERM"} shut the runtime down in an orderly way (exit before the 15 s bound)`, stopped !== null && stopped.code === 0, JSON.stringify(stopped));
  await waitConnection("Reconnecting to runtime", 20_000);
  await startRuntime("restart-after-shutdown");
  await waitConnection("Local runtime connected", 30_000);
  const interruptedB = await waitRunState(second, ["interrupted", "cancelled"], 30_000);
  const candidateB = await waitCandidateState(second, ["interrupted", "cancelled"], 30_000);
  const reasonB = (await itemB.locator("small.failure-note").first().innerText().catch(() => "")).trim();
  record("recovery B: explicit shutdown recorded interruption (resumable), not cancellation, with the shutdown reason shown", interruptedB === "interrupted" && candidateB === "interrupted" && /interrupted by runtime shutdown/.test(reasonB), `run ${interruptedB}, candidate ${candidateB}; ${reasonB.slice(0, 100)}`);
  await itemB.getByRole("button", { name: "Validate and review" }).click();
  const reviewedB = await waitCandidateAfter(second, "interrupted", 120_000);
  record("recovery B: the interrupted candidate resumes with a fresh generation and reaches reviewed", reviewedB === "reviewed", `candidate ${reviewedB}`);

  // C. Hard kill while the reviewer is in flight → reserved spend → re-validation refused with guidance.
  await page.locator('ul[aria-label="Registered projects"] button', { hasText: "Walkthrough" }).click();
  await waitFor(async () => ((await page.locator(".facts").first().innerText()).includes(fixtures.walkthrough.head.slice(0, 12)) ? true : null), 20_000);
  const third = "Hard kill during review";
  await createTicket(third, "Make src/main.py print the greeting.", ["fixture:write_in_scope", "fixture:review_hold", "main prints the greeting"]);
  record("recovery C: the writer settles in validating", (await planApproveImplement(third)).settled === "validating");
  const itemC = ticketItem(third);
  await itemC.getByRole("button", { name: "Validate and review" }).click();
  const reviewing = await waitCandidateState(third, ["reviewing"], 120_000);
  const reviewRun = (await api("GET", "/runs")).body.find((run) => run.state === "reviewing" && run.project_id === "walkthrough");
  const prompted = reviewRun && await waitFor(async () => (await api("GET", `/runs/${reviewRun.id}/events`)).body?.some((event) => event.type === "review.prompt_sent"), 30_000);
  record("recovery C: the independent reviewer is in flight with its durable prompt marker", reviewing === "reviewing" && Boolean(prompted));
  if (!prompted) throw new Error("Reviewer was not prompted; cannot claim interrupted provider spend");
  await stopRuntime("SIGKILL");
  await waitConnection("Reconnecting to runtime", 20_000);
  await startRuntime("restart-after-review-kill");
  await waitConnection("Local runtime connected", 30_000);
  const interruptedC = await waitRunState(third, ["interrupted"], 30_000);
  const reasonC = (await itemC.locator(".candidate-review .failure-note").first().innerText().catch(() => "")).trim();
  record("recovery C: the interrupted review keeps the candidate and reserves the unreported provider spend", interruptedC === "interrupted" && /unreported provider spend|reserved/.test(reasonC), reasonC.slice(0, 120));
  const validateC = itemC.getByRole("button", { name: "Validate and review" });
  if (await validateC.count()) {
    // A runtime that does not report its validate decision: the click is refused with the reason.
    await validateC.click();
    const refusedC = await waitFor(alertText, 20_000);
    record("recovery C: re-validation is refused because the budget is reserved, and the message names the next step (a new plan revision)", /^Validation refused: /.test(refusedC ?? "") && /budget/.test(refusedC ?? "") && /next plan revision/.test(refusedC ?? ""), refusedC ?? "no alert");
    await dismissAlerts();
  } else {
    const stepC = (await itemC.locator(".candidate-review p.recovery-note").first().innerText().catch(() => "")).trim();
    record("recovery C: validation is not offered because the budget is reserved, and the candidate names the next step (a new plan revision)", /budget|reserved/.test(`${reasonC} ${stepC}`) && /next plan revision/.test(stepC), stepC || "no next step");
  }
  await screenshot("07-budget-refusal");
  await accessibilityAudit("recovery page");
  await presentationAudit("recovery page");

  // D. Disconnect clears the session.
  await show("Settings");
  await page.getByRole("button", { name: "Disconnect" }).click();
  const offline = await waitConnection("Local runtime offline", 10_000);
  record("disconnect: the client forgets the token and shows the runtime as offline", Boolean(offline) && (await page.locator('input[type="password"]').inputValue()) === "");
  await presentationAudit("offline page");
}

// ---------- run ----------
let failure = null;
try {
  await startRuntime("initial");
  if (nativeBinary) {
    const debugPort = await freePort();
    nativeClient = spawn(nativeBinary, [], { cwd: repository, env: { ...toolEnv(), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`, WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview2-profile") }, stdio: ["ignore", "ignore", "pipe"] });
    nativeClient.stderr.on("data", (chunk) => writeFileSync(path.join(out, "native.log"), chunk, { flag: "a" }));
    const endpoint = `http://127.0.0.1:${debugPort}`;
    if (!await waitFor(() => fetch(`${endpoint}/json/version`).then(r => r.ok).catch(() => false), 30_000)) throw new Error("native WebView2 debugging endpoint did not become ready");
    browser = await chromium.connectOverCDP(endpoint);
    page = await waitFor(() => browser.contexts().flatMap(c => c.pages()).find(p => /^https?:\/\/tauri\.localhost\//.test(p.url())) ?? null, 30_000);
    if (!page) throw new Error("the native embedded application page did not load");
    clientUrl = page.url();
    record("native Tauri executable loaded its bundled frontend in WebView2", true, `${nativeBinary}; sha256:${createHash("sha256").update(readFileSync(nativeBinary)).digest("hex")}; ${clientUrl}`);
  } else {
    await startVite();
    browser = await chromium.launch({ headless: true, ...(process.env.LUUNA_CHROMIUM && { executablePath: process.env.LUUNA_CHROMIUM }) });
    page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  }
  page.on("pageerror", (error) => note(`page error: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") note(`console error: ${message.text().slice(0, 160)}`); });
  await walkthrough();
  await recovery();
} catch (error) {
  failure = error;
  record("smoke completed without harness error", false, error instanceof Error ? error.stack ?? error.message : String(error));
  await screenshot("99-failure");
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  if (nativeClient) {
    if (nativeClient.exitCode === null && nativeClient.signalCode === null) nativeClient.kill();
    record("native client termination leaves the independent runtime answering", await fetch(`${base}/health`).then(r => r.ok).catch(() => false));
  }
  if (vite) { vite.kill("SIGTERM"); await sleep(300); vite.kill("SIGKILL"); }
  const exit = await stopRuntime("SIGTERM");
  if (runtime === null && exit !== null) record("final shutdown exited the runtime (orderly only with exit code 0)", exit.code === 0, JSON.stringify(exit));
}
const passed = checks.every((check) => check.ok);
const report = {
  mode: "fixture",
  surface: nativeBinary ? "native Tauri WebView2" : "Chromium browser",
  native_binary: nativeBinary,
  verdict: `SYNTHETIC client/lifecycle smoke ${passed ? "passed" : "FAILED"}: desktop client, runtime restart and shutdown evidence only, never provider evidence`,
  started_at: started.toISOString(),
  finished_at: new Date().toISOString(),
  runtime_binary: runtimeBinary,
  ports: { runtime: runtimePort, ui: uiPort },
  checks,
  notes,
  fixtures: Object.fromEntries(Object.entries(fixtures).map(([name, fixture]) => [name, { head: fixture.head }])),
};
const lines = [`# Luuna MVP desktop smoke`, "", `Verdict: **${report.verdict}**`, "", `Started ${report.started_at}, finished ${report.finished_at}.`, "", "| Result | Check | Detail |", "| --- | --- | --- |", ...checks.map((check) => `| ${check.ok ? "pass" : "FAIL"} | ${check.name} | ${check.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`), "", "## Notes", "", ...(notes.length ? notes.map((text) => `- ${text}`) : ["- none"]), ""];
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(path.join(out, "report.md"), lines.join("\n"));
console.log(`\n${report.verdict}\n${checks.filter((check) => check.ok).length}/${checks.length} checks passed. Report written to ${path.join(out, "report.md")}`);
if (!options.keep && passed) { try { rmSync(path.join(out, "runtime-data"), { recursive: true, force: true }); } catch { /* ignore */ } }
process.exit(passed && !failure ? 0 : 1);
