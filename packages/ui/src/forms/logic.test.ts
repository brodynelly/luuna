import { expect, test, vi } from "vitest";
import { copyOutcome, outOfRange, parseNumber, searchKeyAction } from "./logic";

test("Esc clears only a non-empty search, Enter submits, other keys are left alone", () => {
  expect(searchKeyAction("Escape", "abc")).toBe("clear");
  expect(searchKeyAction("Escape", "")).toBeNull();
  expect(searchKeyAction("Enter", "")).toBe("submit");
  expect(searchKeyAction("a", "x")).toBeNull();
});

test("parseNumber reads finite numbers and treats the rest as empty", () => {
  expect([parseNumber(""), parseNumber(" "), parseNumber("-"), parseNumber("1e999")]).toEqual([null, null, null, null]);
  expect([parseNumber("12"), parseNumber("-3.5"), parseNumber("0")]).toEqual([12, -3.5, 0]);
});

test("outOfRange checks only the bounds that are set", () => {
  expect(outOfRange(null, 1, 5)).toBe(false);
  expect(outOfRange(0, 1, 5)).toBe(true);
  expect(outOfRange(6, 1, 5)).toBe(true);
  expect(outOfRange(5, 1, 5)).toBe(false);
  expect(outOfRange(100, 1)).toBe(false);
  expect(outOfRange(-1, undefined, 5)).toBe(false);
});

test("copyOutcome calls the injected copy with the value and reports a throw or rejection as failed", async () => {
  const copy = vi.fn();
  expect(await copyOutcome(copy, "abc123")).toBe("copied");
  expect(copy).toHaveBeenCalledWith("abc123");
  expect(await copyOutcome(async () => { throw new Error("denied"); }, "x")).toBe("failed");
  expect(await copyOutcome(() => { throw new Error("denied"); }, "x")).toBe("failed");
});
