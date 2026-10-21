import { expect, test } from "vitest";
import { ApiError } from "@luuna/api-client";
import { actionFailure, describeFailure, nextStep } from "./failures";

test("transport and status failures become plain developer sentences, never server bodies", () => {
  expect(describeFailure(new TypeError("Failed to fetch"))).toContain("did not answer");
  expect(describeFailure(new DOMException("aborted", "AbortError"))).toContain("abandoned");
  expect(describeFailure(new ApiError(404, "run not found"))).toContain("no longer has this record");
  expect(describeFailure(new ApiError(429, "four runs are already active"))).toContain("four active runs");
  expect(describeFailure(new ApiError(500, "<html>stack trace</html>"))).not.toContain("stack trace");
  expect(describeFailure(new ApiError(422, "candidate hash changed; reload"))).toBe("candidate hash changed; reload");
  expect(describeFailure("odd")).toBe("The runtime could not be reached.");
});

test("runtime reasons map to the next allowed action", () => {
  expect(nextStep("budget exceeded: timeout_seconds 600 elapsed")).toContain("next plan revision");
  expect(nextStep("workflow time or cost budget exhausted; re-plan required")).toContain("next plan revision");
  expect(nextStep("candidate hash changed; reload")).toContain("moved on");
  expect(nextStep("workflow already has active work")).toContain("active work");
  expect(nextStep("implementation requires a passed baseline")).toContain("baseline");
  expect(nextStep("interrupted by runtime shutdown: cancelled; check process group reaped")).toContain("Validate again");
  expect(nextStep("invalid structured reviewer response: expected value")).toContain("Re-validate");
  expect(nextStep("independent review did not pass; repair or re-plan required")).toContain("repair");
  expect(nextStep("required candidate checks failed")).toContain("log");
  expect(nextStep("required candidate checks could not run meaningfully")).toContain("host");
  expect(nextStep("The service rejected this token. Reconnect using its current token.")).toContain("connect again");
  expect(nextStep("every required check passed")).toBe("");
});

test("an action failure names the action, the reason and the next step", () => {
  const text = actionFailure("Validation", new ApiError(409, "workflow already has active work"));
  expect(text.startsWith("Validation refused: workflow already has active work")).toBe(true);
  expect(text).toContain("Wait for the active work");
  expect(actionFailure("Registration", new ApiError(422, "path is not a git repository root"))).toBe("Registration refused: path is not a git repository root");
});
