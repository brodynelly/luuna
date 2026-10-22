// Actual bundled Windows WebView2: warm reuse, refused foreign listener, cold start,
// retry, reload, concurrent windows and independent lifetime. No model calls.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

if (process.platform !== "win32") throw new Error("This smoke requires native Windows.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "apps/desktop/src-tauri/target/debug/luuna-desktop.exe");
const home = path.join(os.homedir(), ".luuna");
const out = path.join(home, "verification", `native-startup-${randomUUID().slice(0, 8)}`);
mkdirSync(out, { recursive: true });
const metadata = () => JSON.parse(readFileSync(path.join(home, "credentials/connection.json"), "utf8").replace(/^\uFEFF/, ""));
const providerHash = () => createHash("sha256").update(readFileSync(path.join(home, "credentials/provider.json"))).digest("hex");
const healthy = () => fetch("http://127.0.0.1:4242/health").then(r => r.ok).catch(() => false);
const checks = [];
const timings = {};
const clients = [];
let foreign;
function check(name, passed) {
  checks.push({ name, passed: Boolean(passed) });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) throw new Error(name);
}
async function until(fn, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 200)); }
  throw new Error("Timed out waiting for native startup state.");
}
async function ps(script, args = []) {
  const child = spawn(path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", ...script, ...args], { cwd: root, windowsHide: true, stdio: "ignore" });
  const timer = setTimeout(() => child.kill(), 40_000);
  try { await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("Windows lifecycle command failed."))); }); }
  finally { clearTimeout(timer); }
}
async function freePort() {
  const server = net.createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}
async function launch() {
  const port = await freePort();
  const child = spawn(binary, [], { cwd: os.tmpdir(), env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: path.join(out, `profile-${port}`) }, stdio: "ignore" });
  const client = { child, browser: null, page: null };
  clients.push(client);
  child.on("error", () => {});
  await until(() => fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok).catch(() => false), 30_000);
  client.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  client.page = await until(() => client.browser.contexts().flatMap(c => c.pages()).find(p => /^https?:\/\/tauri\.localhost\//.test(p.url())));
  return client;
}
async function connected(client) {
  await client.page.getByText("Local runtime connected", { exact: true }).waitFor({ timeout: 65_000 });
  check("native view connects without token entry", (await client.page.getByLabel("Service token", { exact: true }).count()) === 0);
}
async function close(client) {
  if (client.child.exitCode !== null || client.child.signalCode !== null) return;
  // WM_CLOSE exercises normal desktop exit, rather than terminating it.
  await ps(["-Command", `$p=Get-Process -Id ${client.child.pid} -ErrorAction Stop; if (!$p.CloseMainWindow()) { exit 1 }; if (!$p.WaitForExit(10000)) { exit 2 }`]);
  if (client.browser) await client.browser.close().catch(() => {});
}
let failure;
try {
  const saved = metadata();
  const keyHash = providerHash();
  check("test starts against an already healthy development runtime", await healthy());
  await ps(["-Command", "$c = & ./scripts/ensure-windows-runtime.ps1; $h = @{Authorization = 'Bearer '+$c.token}; $runs = Invoke-RestMethod ($c.url+'/api/v1/runs') -Headers $h -MaximumRedirection 0 -TimeoutSec 5; if (@($runs | Where-Object { $_.state -in @('queued','running','exploring','implementing','validating','reviewing') }).Count) { exit 3 }; $c=$null; $h=$null"]);
  const warmStarted = performance.now();
  const warm = await launch();
  await connected(warm);
  timings.warm_launch_to_connected_ms = performance.now() - warmStarted;
  check("warm launch reuses the authenticated runtime PID", metadata().runtime_pid === saved.runtime_pid);
  const history = await warm.page.locator(".run-card").count();
  await close(warm);
  check("normal window close leaves runtime answering", await healthy());
  await ps(["-File", path.join(root, "scripts/stop-windows.ps1")]);
  await until(async () => !await healthy(), 15_000);

  let foreignRequests = 0;
  foreign = http.createServer((_request, response) => { foreignRequests++; response.end("foreign service"); });
  await new Promise((resolve, reject) => { foreign.once("error", reject); foreign.listen(4242, "127.0.0.1", resolve); });
  const cold = await launch();
  await cold.page.getByRole("alert").filter({ hasText: "Local runtime startup failed" }).waitFor({ timeout: 65_000 });
  check("foreign listener is refused before any HTTP request or token transmission", foreignRequests === 0);
  await new Promise(r => foreign.close(r));
  foreign = null;
  const coldStarted = performance.now();
  await cold.page.getByRole("button", { name: "Connect automatically", exact: true }).click();
  const second = await launch();
  await Promise.all([connected(cold), connected(second)]);
  timings.cold_retry_and_concurrent_launch_to_connected_ms = performance.now() - coldStarted;
  const restarted = metadata();
  check("retry starts a new independent runtime after cold stop", restarted.runtime_pid !== saved.runtime_pid && await healthy());
  check("cold startup preserves the existing data directory and visible history", restarted.data_directory === saved.data_directory && await cold.page.locator(".run-card").count() === history);
  check("provider credential bytes are unchanged", providerHash() === keyHash);
  const storage = await cold.page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  check("automatic connection writes no browser storage", storage.local.length === 0 && storage.session.length === 0);
  await cold.page.reload();
  await connected(cold);
  check("reload reauthenticates without spawning a duplicate runtime", metadata().runtime_pid === restarted.runtime_pid);
  check("concurrent desktop windows reuse one runtime", metadata().runtime_pid === restarted.runtime_pid);
  // The desktop shows one view at a time (ADR 0028): Disconnect lives in Settings.
  await cold.page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: /^Settings/ }).click();
  await cold.page.getByRole("button", { name: "Disconnect", exact: true }).click();
  check("explicit disconnect stays disconnected and leaves runtime running", await cold.page.getByLabel("Service token", { exact: true }).count() === 1 && await healthy());
  await cold.page.getByRole("button", { name: "Connect automatically", exact: true }).click();
  await connected(cold);
  await cold.page.screenshot({ path: path.join(out, "native-connected.png"), fullPage: true });
  await close(second);
  await close(cold);
  check("closing all desktop windows leaves the runtime healthy", await healthy());
} catch (error) {
  failure = error;
  console.error(error.message);
  for (const [index, client] of clients.entries()) {
    if (!client.page || client.page.isClosed()) continue;
    const alert = await client.page.getByRole("alert").allTextContents().catch(() => []);
    console.error(`Native window ${index}: ${alert.join("; ")}`);
    await client.page.screenshot({ path: path.join(out, `failure-${index}.png`) }).catch(() => {});
  }
}
finally {
  if (foreign) await new Promise(r => foreign.close(r));
  for (const client of clients) await close(client).catch(() => { client.child.kill(); });
  writeFileSync(path.join(out, "report.json"), JSON.stringify({ surface: "native Tauri WebView2", binary, sha256: createHash("sha256").update(readFileSync(binary)).digest("hex"), checks, timings, passed: !failure && checks.every(c => c.passed) }, null, 2));
  console.log(`Evidence: ${out}`);
}
if (failure) process.exitCode = 1;
