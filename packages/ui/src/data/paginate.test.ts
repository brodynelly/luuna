import { describe, expect, test } from "vitest";
import { clampPage, pageRange, pageWindow } from "./paginate";

describe("paging maths", () => {
  test("clamps to the page range", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(3, 0)).toBe(1);
  });

  test("shows every page when few, and gaps when many", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 10)).toEqual([1, 2, "gap", 10]);
    expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageWindow(10, 10)).toEqual([1, "gap", 9, 10]);
  });

  test("a single hidden page is shown instead of a gap", () => {
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, "gap", 10]);
  });

  test("range figures", () => {
    expect(pageRange(2, 10, 53)).toEqual({ from: 11, to: 20 });
    expect(pageRange(6, 10, 53)).toEqual({ from: 51, to: 53 });
    expect(pageRange(1, 10, 0)).toBeNull();
  });
});
