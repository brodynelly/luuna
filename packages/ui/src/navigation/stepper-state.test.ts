import { expect, test } from "vitest";
import { resolveSteps, STEP_STATES } from "./stepper-state";
import { TONES } from "../tone/tone";

test("steps without a state are in progress only when current; position never completes one", () => {
  const steps = resolveSteps([{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], "b");
  expect(steps.map((step) => step.state)).toEqual(["upcoming", "current", "upcoming"]);
  expect(steps.map((step) => step.isCurrent)).toEqual([false, true, false]);
});

test("an explicit state wins and the current marker stays on the current id", () => {
  const steps = resolveSteps([{ id: "a", label: "A", state: "complete" }, { id: "b", label: "B", state: "blocked" }], "b");
  expect(steps.map((step) => step.state)).toEqual(["complete", "blocked"]);
  expect(steps[1].isCurrent).toBe(true);
});

test("every state has a known tone and distinct visible text", () => {
  const entries = Object.values(STEP_STATES);
  for (const { tone } of entries) expect(TONES).toContain(tone);
  expect(new Set(entries.map((entry) => entry.text)).size).toBe(entries.length);
});
