import { expect, test } from "vitest";
import { overflows } from "./scroll";

const box = (scrollHeight: number, clientHeight: number, scrollWidth = 100, clientWidth = 100) => ({ scrollHeight, clientHeight, scrollWidth, clientWidth });

test("a region that fits does not overflow, and a one-pixel rounding difference is not overflow", () => {
  expect(overflows(box(100, 100))).toBe(false);
  expect(overflows(box(101, 100))).toBe(false);
});

test("content taller than the box overflows vertically", () => {
  expect(overflows(box(300, 100))).toBe(true);
  expect(overflows(box(300, 100), "x")).toBe(false);
});

test("content wider than the box overflows horizontally, and both reads either", () => {
  expect(overflows(box(100, 100, 400, 100), "x")).toBe(true);
  expect(overflows(box(100, 100, 400, 100), "y")).toBe(false);
  expect(overflows(box(100, 100, 400, 100), "both")).toBe(true);
  expect(overflows(box(300, 100), "both")).toBe(true);
  expect(overflows(box(100, 100), "both")).toBe(false);
});
