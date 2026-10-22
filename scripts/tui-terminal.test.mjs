import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { ConptyTerminal, TerminalScreen } from "./tui-terminal.mjs";
import { stageTerminal } from "./stage-terminal.mjs";

test("VT captures current cursor-addressed cells, colors and split UTF-8/control sequences", () => {
  const screen = new TerminalScreen(20, 5);
  screen.feed("obsolete\x1b[2J\x1b[H\x1b[32mReady\x1b[0m\x1b[2;");
  screen.feed("3H✓界\x1b[?25l");
  const snapshot = screen.snapshot();
  assert.equal(snapshot.lines[0].trim(), "Ready");
  assert.equal(snapshot.lines[1].trim(), "✓界");
  assert.match(snapshot.colors[0][0], /32/);
  assert.equal(snapshot.cursorVisible, false);
  const bytes = Buffer.from("\x1b[3;1Hé"); screen.feed(bytes.subarray(0, -1)); screen.feed(bytes.subarray(-1));
  assert.equal(screen.snapshot().lines[2].trim(), "é");
  assert.deepEqual(snapshot.unknown, []);
});

test("VT alternate screen restoration and resize discard stale screen contents", () => {
  const screen = new TerminalScreen(10, 3);
  screen.feed("main\x1b[?1049h\x1b[Htemporary");
  assert.equal(screen.snapshot().lines[0].trim(), "temporary");
  screen.resize(8, 4); screen.feed("\x1b[?1049l\x1b[?25h");
  assert.equal(screen.snapshot().lines[0].trim(), "main");
  assert.equal(screen.snapshot().alternate, false);
  assert.deepEqual(screen.snapshot().events, ["alternate-enter", "alternate-leave"]);
});

test("staging refuses incomplete payload before copying", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "luuna-stage-test-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => stageTerminal({ root, out: path.join(root, "stage"), binary: path.join(root, "missing.exe") }), /prerequisite missing/);
  assert.throws(() => stageTerminal({ root, out: root, binary: path.join(root, "missing.exe") }), /separate output/);
});

test("Windows ConPTY runs real Node terminal input, resize, screen rendering and cleanup", { skip: process.platform !== "win32", timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "luuna-conpty-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const program = path.join(dir, "probe.mjs"); const result = path.join(dir, "console-result.json");
  writeFileSync(program, `
    process.stdout.write('main\\r\\n\\x1b[?1049h\\x1b[2J\\x1b[H\\x1b[?25l\\x1b[32mREADY '+process.stdin.isTTY+' '+process.stdout.isTTY);
    process.stdin.setRawMode(true);
    process.stdin.on('data', data => {
      for (const char of data.toString()) {
        if (char === 'x') process.stdout.write('\\x1b[2;1HINPUT x');
        if (char === 'r') process.stdout.write('\\x1b[3;1HSIZE '+process.stdout.getWindowSize().join('x'));
        if (char === 'q') { process.stdin.setRawMode(false); process.stdout.write('\\x1b[0m\\x1b[?25h\\x1b[?1049l'); process.stdin.pause(); process.exitCode=7; }
      }
    });
  `);
  const terminal = new ConptyTerminal();
  try {
    await terminal.open({ argv: [process.execPath, program], cwd: dir, result });
    const wait = async (predicate) => { for (let i = 0; i < 100; i++) { const state = await terminal.capture(); if (predicate(state)) return state; await sleep(50); } assert.fail("Timed out waiting for real terminal state"); };
    const ready = await wait((state) => state.lines.join("\n").includes("READY true true"));
    assert.equal(ready.alternate, true); assert.equal(ready.cursorVisible, false);
    await terminal.send("x"); await wait((state) => state.lines[1].includes("INPUT x"));
    await terminal.resize(40, 12); await sleep(250); await terminal.send("r");
    const resized = await wait((state) => state.lines.join("\n").includes("SIZE 40x12"));
    assert.equal(resized.columns, 40); assert.equal(resized.rows, 12);
    await terminal.send("q"); const closed = await wait((state) => state.exit !== null);
    assert.equal(closed.exit, 7); assert.equal(closed.alternate, false); assert.equal(closed.cursorVisible, true);
    assert.equal(closed.lines[0].trim(), "main"); assert.deepEqual(closed.unknown, []);
    const consoleResult = JSON.parse(readFileSync(result, "utf8"));
    assert.equal(consoleResult.exit, 7);
    assert.equal(consoleResult.after[0], consoleResult.before[0], "input console mode restored");
    assert.throws(() => process.kill(consoleResult.child_pid, 0), { code: "ESRCH" });
  } finally { await terminal.close(); }
});
