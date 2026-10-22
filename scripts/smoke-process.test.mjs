import assert from "node:assert/strict";
import test from "node:test";
import { settled, waitForExit } from "./smoke-process.mjs";

test("restart may observe process exit while the final scan waits for log closure", async () => {
  const child = { exitCode: null, signalCode: null, stdioClosed: false };
  assert.equal((await waitForExit(child, 50, { drain: false })).exited, false);
  child.signalCode = "SIGKILL";
  assert.equal((await waitForExit(child, 100, { drain: false })).exited, true);
  assert.equal(settled(child), false);
  assert.equal((await waitForExit(child, 50)).exited, false);
  child.stdioClosed = true;
  assert.equal((await waitForExit(child, 100)).exited, true);
});
