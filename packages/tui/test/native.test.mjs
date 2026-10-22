import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.mjs";
import { launchNative, nativePaths } from "../src/native.mjs";

function fixture(t, development = true) {
  const root = mkdtempSync(path.join(tmpdir(), "luuna terminal "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (development) writeFileSync(path.join(root, "Cargo.toml"), "[workspace]\n");
  const paths = nativePaths({ root, env: {}, platform: "win32" });
  for (const file of [paths.binary, paths.bridge]) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, "fixture"); }
  let err = "";
  return { root, paths, env: { LUUNA_API_TOKEN: "fixture-secret" }, stdin: "inherit", stdout: "inherit", stderr: { write: (text) => { err += text; } }, err: () => err, platform: "win32", signals: new EventEmitter() };
}

test("checkout artifact is explicit, while installed resolution ignores target override and cwd", (t) => {
  const dev = fixture(t);
  const alternate = path.join(dev.root, "other target");
  assert.equal(nativePaths({ root: dev.root, env: { CARGO_TARGET_DIR: alternate }, platform: "win32" }).binary, path.join(alternate, "debug", "luuna-tui.exe"));
  const installed = fixture(t, false);
  assert.equal(nativePaths({ root: installed.root, env: { CARGO_TARGET_DIR: alternate }, platform: "win32" }).binary, path.join(installed.root, "luuna-tui.exe"));
});

test("missing binary has build/reinstall guidance and never calls a fallback", async (t) => {
  for (const development of [true, false]) {
    const f = fixture(t, development); rmSync(f.paths.binary);
    assert.equal(await launchNative({ ...f, spawnProcess() { assert.fail("must not spawn"); } }), 1);
    assert.match(f.err(), development ? /cargo build --locked -p luuna-tui/ : /Reinstall/);
    assert.ok(!f.err().includes(f.env.LUUNA_API_TOKEN));
  }
});

test("native launch inherits streams and private environment, passes absolute bridge and exact Node, and preserves exit", async (t) => {
  const f = fixture(t);
  const child = new EventEmitter(); child.kill = () => assert.fail("normal close must not kill");
  const code = launchNative({ ...f, spawnProcess(binary, args, options) {
    assert.equal(binary, f.paths.binary);
    assert.deepEqual(args, ["--bridge", f.paths.bridge, "--node", process.execPath]);
    assert.ok(!args.join(" ").includes(f.env.LUUNA_API_TOKEN));
    assert.deepEqual(options.stdio, [f.stdin, f.stdout, f.stderr]);
    assert.equal(options.env.LUUNA_API_TOKEN, f.env.LUUNA_API_TOKEN);
    queueMicrotask(() => child.emit("close", 23, null)); return child;
  } });
  assert.equal(await code, 23);
  assert.equal(f.signals.listenerCount("SIGINT"), 0);
  assert.equal(f.signals.listenerCount("SIGTERM"), 0);
});

test("spawn failure is bounded, sanitized and removes signal listeners", async (t) => {
  const f = fixture(t); const child = new EventEmitter();
  assert.equal(await launchNative({ ...f, spawnProcess() { queueMicrotask(() => child.emit("error", new Error(f.env.LUUNA_API_TOKEN))); return child; } }), 1);
  assert.ok(!f.err().includes(f.env.LUUNA_API_TOKEN));
  assert.equal(f.signals.listenerCount("SIGINT"), 0);
});

test("dispatch opens native only with no command and two terminal streams; help/catalog need no binary or token", async () => {
  let launched = 0; let out = "";
  const io = { env: {}, stdin: { isTTY: true }, stdout: { isTTY: true, write(text) { out += text; } }, stderr: { write() {} }, nativeLauncher: async () => { launched++; return 17; } };
  assert.equal(await main([], io), 17); assert.equal(launched, 1);
  for (const args of [["help"], ["--help"], ["-h"], ["catalog"]]) assert.equal(await main(args, io), 0);
  assert.equal(await main([], { ...io, stdout: { ...io.stdout, isTTY: false } }), 2);
  assert.equal(launched, 1); assert.match(out, /interactive workbench/);
});
