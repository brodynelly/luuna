// Large synthetic history through the real React client. All runtime requests
// are intercepted; this never connects to the developer's service or provider.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserIndex = process.argv.indexOf("--browser");
const executablePath = browserIndex < 0 ? undefined : process.argv[browserIndex + 1];
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "apps/desktop", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", windowsHide: true });
const viteExit = once(vite, "exit");
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    ready = await fetch(`http://127.0.0.1:${port}`).then((r) => r.ok).catch(() => false);
    if (ready) break;
    await sleep(100);
  }
  assert(ready, "test-owned Vite server must start");
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  // The desktop shows one view at a time (ADR 0030); the sidebar selects it.
  const show = (view) => page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: new RegExp(`^${view}`) }).click();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const run = { id: "history", project_id: "demo", state: "completed", revision: 3, metadata: { prompt: "Synthetic performance history" }, created_at: "2026-10-21T00:00:00Z", updated_at: "2026-10-21T00:00:01Z" };
  const recent = [run, ...Array.from({ length: 199 }, (_, index) => ({ ...run, id: `recent-${index}`, metadata: { prompt: `Recent session ${index}` } }))];
  const older = { ...run, id: "older", state: "running", metadata: { prompt: "Older active session" } };
  const events = Array.from({ length: 10_000 }, (_, index) => ({ schema_version: "0.1", run_id: run.id, project_id: "demo", event_id: `event-${index + 1}`, sequence: index + 1, type: "pi.message_update", timestamp: run.created_at, payload: { marker: `payload-${index + 1}`, text: "x".repeat(1024) } }));
  const cursors = [];
  await page.route("http://127.0.0.1:4243/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let body;
    if (url.pathname === "/api/v1/health") body = { pi_version: "synthetic" };
    else if (url.pathname === "/api/v1/runs") body = url.searchParams.has("before") ? [older] : recent;
    else if (url.pathname === "/api/v1/projects") body = [];
    // Settings reads the doctor report on connect; an empty passing report keeps this fixture to run paging.
    else if (url.pathname === "/api/v1/doctor") body = { ok: true, items: [] };
    else if (url.pathname === "/api/v1/runs/history/events") {
      const cursor = Number(url.searchParams.get("after"));
      cursors.push(cursor);
      const before = Number(url.searchParams.get("before"));
      body = before ? events.slice(Math.max(0, before - 201), before - 1) : events.slice(cursor, cursor + 200);
    } else if (url.pathname === "/api/v1/runs/older/events") body = [];
    else throw new Error(`Unexpected fixture route: ${url.pathname}`);
    await route.fulfill({ json: body, headers });
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel("Service URL").fill("http://127.0.0.1:4243");
  await page.getByLabel("Service token").fill("synthetic-test-token");
  const start = performance.now();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("ol.events > li").length === 200);
  const initialRenderMs = performance.now() - start;
  assert.equal(await page.locator("ol.events pre").count(), 0, "collapsed payloads must not populate the DOM");
  await show("Sessions");
  await page.waitForFunction(() => document.querySelector(".run-detail").textContent.includes("10000"));
  const fullReplayMs = performance.now() - start;
  await page.evaluate(() => {
    window.performanceMutations = 0;
    new MutationObserver((records) => { window.performanceMutations += records.length; }).observe(document.querySelector("ol.events"), { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await page.waitForFunction(() => document.querySelector(".run-detail").textContent.includes("10000"));
  const pollDeadline = Date.now() + 15_000;
  while (!(cursors.length >= 2 && cursors.slice(-2).every((cursor) => cursor === 10_000)) && Date.now() < pollDeadline) await sleep(100);
  const idleMutations = await page.evaluate(() => window.performanceMutations);
  assert.equal(idleMutations, 0, "idle history polling must not change the event DOM");
  assert(cursors.slice(-2).every((cursor) => cursor === 10_000), "empty polls must resume after history");
  await page.locator("ol.events summary").first().click();
  await page.waitForFunction(() => document.querySelector("ol.events pre")?.textContent.includes("payload-9801"));
  assert.equal(await page.locator("ol.events pre").count(), 1);
  await page.locator("ol.events summary").first().click();
  await page.waitForFunction(() => document.querySelectorAll("ol.events pre").length === 0);
  await page.getByRole("button", { name: "Earlier events", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("ol.events .event-number")?.textContent === "9601");
  assert.equal(await page.locator("ol.events > li").count(), 200);
  events.push({ ...events[0], event_id: "event-10001", sequence: 10001 });
  await page.waitForFunction(() => document.querySelector(".run-detail").textContent.includes("10001"));
  assert.equal(await page.locator("ol.events .event-number").first().textContent(), "9601", "new output must not move an earlier page");
  await page.getByRole("button", { name: "Later events", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("ol.events .event-number")?.textContent === "9801");
  await page.getByRole("button", { name: "Earlier events", exact: true }).click();
  await page.getByRole("button", { name: "Latest events", exact: true }).click();
  assert.equal(await page.locator("ol.events .event-number").last().textContent(), "10001");
  await page.setViewportSize({ width: 760, height: 900 });
  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${colorScheme}: paging must fit the minimum window width`);
  }
  await page.getByRole("button", { name: "Older sessions", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".run-detail code")?.textContent === "older");
  assert(await page.getByRole("button", { name: "Cancel session", exact: true }).isEnabled(), "paging must keep selected run controls accessible");
  assert.equal(await page.locator(".run-card[aria-pressed=true]").count(), 1);
  await page.getByRole("button", { name: "Newer sessions", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".run-detail code")?.textContent === "history");
  assert.equal(await page.getByRole("button", { name: "Cancel session", exact: true }).count(), 0);
  await show("Settings");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  assert.equal(await page.locator("ol.events").count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), initial_events: 10_000, visible_rows: 200, initial_render_ms: initialRenderMs, full_replay_ms: fullReplayMs, idle_event_dom_mutations: idleMutations, cursor_polls: cursors.length, payload_open_close: "passed", history_paging_during_append: "passed", session_paging_controls: "passed", minimum_width_both_schemes: "passed", disconnect: "passed" }, null, 2));
} finally {
  await browser?.close();
  vite.kill();
  await viteExit;
}
