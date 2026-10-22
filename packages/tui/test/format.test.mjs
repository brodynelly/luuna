// The six status tones (ADR 0013, docs/DESIGN-SYSTEM.md) in the terminal: the same mapping as the
// desktop's tone table, painted only on a colour terminal, plain text everywhere else, and the
// runtime's state words never changed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TONES, baselineTone, candidateTone, checkTone, colourEnabled, connectionTone, format, leaseTone, paint, runTone, severityTone, verdictTone } from "../src/format.mjs";
import { stripAnsi } from "../src/text.mjs";

const run = (state) => ({ id: `run-${state}`, state, metadata: { kind: "workflow", plan_id: "plan-1", plan_revision: 1 }, created_at: "2026-10-22T00:00:00Z" });

test("the tone tables mirror the desktop's: green is earned, interruption is never danger, a finished process is neutral", () => {
  assert.deepEqual(TONES, ["success", "active", "danger", "attention", "neutral", "interrupted"]);
  assert.equal(runTone.reviewed, "success");
  assert.equal(runTone.completed, "neutral");
  assert.equal(runTone.interrupted, "interrupted");
  assert.equal(runTone.failed, "danger");
  assert.equal(runTone.plan_ready, "attention");
  assert.equal(runTone.implementing, "active");
  assert.equal(candidateTone.interrupted, "interrupted");
  assert.equal(checkTone.passed, "success");
  assert.equal(baselineTone.running, "active");
  assert.equal(verdictTone.changes_required, "danger");
  assert.equal(severityTone.warning, "attention");
  assert.equal(leaseTone.abandoned, "interrupted");
  assert.equal(connectionTone.reconnecting, "interrupted");
  for (const table of [runTone, candidateTone, checkTone, baselineTone, verdictTone, severityTone, leaseTone, connectionTone]) for (const tone of Object.values(table)) assert.ok(TONES.includes(tone), tone);
});

test("paint wraps the unchanged text in one SGR colour per tone and leaves it plain without colour or for an unknown tone", () => {
  const codes = new Set(TONES.map((tone) => /^\u001b\[(\d+)m/.exec(paint("x", tone, true))?.[1]));
  assert.equal(codes.size, 6, "six distinct colours");
  for (const tone of TONES) {
    assert.equal(stripAnsi(paint("reviewed", tone, true)), "reviewed");
    assert.ok(paint("reviewed", tone, true).endsWith("\u001b[0m"));
    assert.equal(paint("reviewed", tone, false), "reviewed");
  }
  assert.equal(paint("x", "unknown", true), "x");
  assert.equal(paint("x", undefined, true), "x");
});

test("colour is used only on a terminal, never with NO_COLOR set or TERM=dumb", () => {
  assert.equal(colourEnabled({ env: {}, stdout: { isTTY: true } }), true);
  assert.equal(colourEnabled({ env: {}, stdout: { isTTY: false } }), false);
  assert.equal(colourEnabled({ env: {}, stdout: undefined }), false);
  assert.equal(colourEnabled({ env: { NO_COLOR: "1" }, stdout: { isTTY: true } }), false);
  assert.equal(colourEnabled({ env: { NO_COLOR: "" }, stdout: { isTTY: true } }), true, "an empty NO_COLOR does not disable colour (no-color.org)");
  assert.equal(colourEnabled({ env: { TERM: "dumb" }, stdout: { isTTY: true } }), false);
});

test("format paints the state words of runs, baselines, candidates and leases and degrades to the identical plain text", () => {
  const runs = ["reviewed", "implementing", "failed", "plan_ready", "completed", "interrupted"].map(run);
  const coloured = format("runs.list", runs, { colour: true });
  const plain = format("runs.list", runs);
  assert.equal(stripAnsi(coloured), plain);
  assert.ok(!plain.includes("\u001b"));
  assert.equal((coloured.match(/\u001b\[0m/g) ?? []).length, 6);
  assert.ok(coloured.includes("\u001b[32mreviewed\u001b[0m"));
  assert.ok(coloured.includes("\u001b[35minterrupted\u001b[0m"));
  assert.ok(coloured.includes("\u001b[2mcompleted\u001b[0m"));
  const baseline = { run_id: "run-b", status: "passed", manifest_revision: 1, identity: { commit: "abc" }, results: [{ recipe_id: "unit", status: "passed", exit_code: 0 }], required_checks: [{}] };
  assert.ok(format("baselines.list", [baseline], { colour: true }).includes("\u001b[32mpassed\u001b[0m  manifest r1"));
  assert.equal(stripAnsi(format("baselines.list", [baseline], { colour: true })), format("baselines.list", [baseline]));
  const view = { evidence: { candidate: { revision: 1, hash: "h", plan_hash: "p", repository_commits: {} }, status: "interrupted", results: [{ recipe_id: "unit", status: "interrupted" }], review: { verdict: "passed", findings: [{ severity: "warning", path: "a", line: 1, explanation: "e" }], reviewer_session: "s" }, reason: "interrupted by runtime shutdown" } };
  const candidate = format("runs.candidate", view, { colour: true });
  assert.ok(candidate.includes("\u001b[35minterrupted\u001b[0m"));
  assert.ok(candidate.includes("\u001b[32mpassed\u001b[0m"));
  assert.ok(candidate.includes("\u001b[33mwarning\u001b[0m"));
  assert.equal(stripAnsi(candidate), format("runs.candidate", view));
  assert.ok(format("runs.worktrees", [{ id: "l", state: "abandoned", repository_id: "app", path: "/p" }], { colour: true }).includes("\u001b[35mabandoned\u001b[0m"));
  assert.ok(format("health", { status: "ok", pi_version: "1", native_execution: true }, { colour: true }).includes("\u001b[32mok\u001b[0m"));
});
