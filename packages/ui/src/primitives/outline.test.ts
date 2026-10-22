import { expect, test } from "vitest";
import { outlineProblems } from "./outline";

test("h2, h3, h4 in order is a valid outline, and returning to a shallower level is allowed", () => {
  expect(outlineProblems([2, 3, 4, 4, 3, 4])).toEqual([]);
  expect(outlineProblems([])).toEqual([]);
});

test("a second h2 is reported", () => {
  expect(outlineProblems([2, 3, 2])).toEqual(["one h2 per view, found 2"]);
});

test("a skipped level is reported with its position", () => {
  expect(outlineProblems([2, 4])).toEqual(["heading 2: h4 skips a level after h2"]);
  expect(outlineProblems([3])).toEqual(["heading 1: h3 skips a level after h1"]);
});

test("levels outside h2 to h4 are reported", () => {
  expect(outlineProblems([1])).toEqual(["heading 1: h1 is outside h2 to h4"]);
  expect(outlineProblems([2, 5])).toEqual(["heading 2: h5 is outside h2 to h4"]);
});
