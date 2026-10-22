import { describe, expect, test } from "vitest";
import { ariaSort, compareValues, nextSort, sortHint, sortRows } from "./tableSort";

describe("sort state", () => {
  test("cycles ascending, descending, unsorted, and restarts on another column", () => {
    const first = nextSort(null, "name");
    expect(first).toEqual({ key: "name", direction: "ascending" });
    const second = nextSort(first, "name");
    expect(second).toEqual({ key: "name", direction: "descending" });
    expect(nextSort(second, "name")).toBeNull();
    expect(nextSort(second, "age")).toEqual({ key: "age", direction: "ascending" });
  });

  test("aria-sort exists only on sortable columns and is none until sorted", () => {
    expect(ariaSort(null, "a", false)).toBeUndefined();
    expect(ariaSort(null, "a", true)).toBe("none");
    expect(ariaSort({ key: "a", direction: "descending" }, "a", true)).toBe("descending");
    expect(ariaSort({ key: "b", direction: "descending" }, "a", true)).toBe("none");
    expect(sortHint("ascending")).toBe("sorted ascending");
    expect(sortHint("none")).toBe("not sorted");
  });
});

describe("sorting rows", () => {
  test("compares numbers, numeric strings and empty values", () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues("item 2", "item 10")).toBeLessThan(0);
    expect(compareValues("a", "B")).toBeLessThan(0);
    expect(compareValues(null, 1)).toBeGreaterThan(0);
    expect(compareValues("", "")).toBe(0);
  });

  test("is stable and keeps empty values last in both directions", () => {
    const rows = [{ id: 1, v: 3 }, { id: 2, v: null }, { id: 3, v: 1 }, { id: 4, v: 3 }];
    expect(sortRows(rows, (row) => row.v, "ascending").map((row) => row.id)).toEqual([3, 1, 4, 2]);
    expect(sortRows(rows, (row) => row.v, "descending").map((row) => row.id)).toEqual([1, 4, 3, 2]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4]);
  });
});
