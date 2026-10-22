import assert from "node:assert/strict";
import test from "node:test";
import { failedNoChangeRepair } from "./m3-evidence.mjs";

test("no-change repair evidence requires the recorded failed second attempt", () => {
  const reason = "automatic validation stopped: automatic repair writer failed: writer settled without changing any file; budget exceeded: attempt 3 exceeds max_attempts 2";
  const attempts = [{ number: 1, state: "completed" }, { number: 2, state: "failed" }];
  assert.equal(failedNoChangeRepair(reason, attempts), true);
  assert.equal(failedNoChangeRepair("budget exceeded: attempt 3 exceeds max_attempts 2", attempts), false);
  assert.equal(failedNoChangeRepair("automatic repair writer failed: provider unavailable", attempts), false);
  assert.equal(failedNoChangeRepair(reason, attempts.slice(0, 1)), false);
  assert.equal(failedNoChangeRepair(reason, [...attempts, { number: 3, state: "failed" }]), false);
  assert.equal(failedNoChangeRepair(reason, [attempts[0], { number: 2, state: "running" }]), false);
});
