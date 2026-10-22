import { describe, expect, test } from "vitest";
import { selectAllState, selectionAnnouncement, toggleAll, toggleRow } from "./tableSelection";

const keys = ["a", "b", "c"];

describe("selection", () => {
  test("select-all state is none, some or all of the shown rows", () => {
    expect(selectAllState([], [])).toBe("none");
    expect(selectAllState(keys, [])).toBe("none");
    expect(selectAllState(keys, ["b"])).toBe("some");
    expect(selectAllState(keys, ["c", "a", "b"])).toBe("all");
    expect(selectAllState(keys, ["x"])).toBe("none");
  });

  test("toggling a row keeps row order and keys from other pages", () => {
    expect(toggleRow(keys, [], "b")).toEqual(["b"]);
    expect(toggleRow(keys, ["c"], "a")).toEqual(["a", "c"]);
    expect(toggleRow(keys, ["a", "c"], "a")).toEqual(["c"]);
    expect(toggleRow(keys, ["z"], "b")).toEqual(["z", "b"]);
  });

  test("select-all selects the shown rows, then clears only them", () => {
    expect(toggleAll(keys, [])).toEqual(keys);
    expect(toggleAll(keys, ["b"])).toEqual(keys);
    expect(toggleAll(keys, ["z", ...keys])).toEqual(["z"]);
  });

  test("announces counts in plain words", () => {
    expect(selectionAnnouncement(0, 5)).toBe("No rows selected");
    expect(selectionAnnouncement(1, 1)).toBe("1 of 1 row selected");
    expect(selectionAnnouncement(3, 10)).toBe("3 of 10 rows selected");
  });
});
