import { expect, test } from "vitest";
import { filterOptions, firstActive, nextListState } from "./listbox";

const state = (open: boolean, active: number, count = 4) => ({ open, active, count });

test("Down opens at the selected option, or the first; once open it moves and stops at the last", () => {
  expect(nextListState("ArrowDown", state(false, -1))).toEqual({ open: true, active: 0, select: false });
  expect(nextListState("ArrowDown", state(false, -1), 2)).toEqual({ open: true, active: 2, select: false });
  expect(nextListState("ArrowDown", state(true, -1))).toEqual({ open: true, active: 0, select: false });
  expect(nextListState("ArrowDown", state(true, 1))?.active).toBe(2);
  expect(nextListState("ArrowDown", state(true, 3))?.active).toBe(3);
});

test("Up opens at the selected option, or the last; once open it moves and stops at the first", () => {
  expect(nextListState("ArrowUp", state(false, -1))?.active).toBe(3);
  expect(nextListState("ArrowUp", state(false, -1), 1)?.active).toBe(1);
  expect(nextListState("ArrowUp", state(true, -1))?.active).toBe(3);
  expect(nextListState("ArrowUp", state(true, 2))?.active).toBe(1);
  expect(nextListState("ArrowUp", state(true, 0))?.active).toBe(0);
});

test("Home and End move the list only once an option is active; before that they stay the caret's", () => {
  expect(nextListState("Home", state(true, -1))).toBeNull();
  expect(nextListState("End", state(false, 2))).toBeNull();
  expect(nextListState("Home", state(true, 2))?.active).toBe(0);
  expect(nextListState("End", state(true, 1))?.active).toBe(3);
});

test("Enter selects the active option only; Esc closes only an open list", () => {
  expect(nextListState("Enter", state(true, 2))).toEqual({ open: false, active: 2, select: true });
  expect(nextListState("Enter", state(true, -1))).toBeNull();
  expect(nextListState("Enter", state(false, 2))).toBeNull();
  expect(nextListState("Escape", state(true, 2))).toEqual({ open: false, active: -1, select: false });
  expect(nextListState("Escape", state(false, -1))).toBeNull();
  expect(nextListState("a", state(true, 0))).toBeNull();
});

test("an empty list opens with nothing active and never selects", () => {
  expect(nextListState("ArrowDown", state(false, -1, 0))).toEqual({ open: true, active: -1, select: false });
  expect(nextListState("ArrowUp", state(true, -1, 0))?.active).toBe(-1);
  expect(nextListState("Enter", state(true, 0, 0))).toBeNull();
  expect(firstActive(0)).toBe(-1);
  expect(firstActive(3)).toBe(0);
});

test("filterOptions matches labels case-insensitively, returns all for an empty query, and accepts a custom match", () => {
  const options = [{ label: "Alpha", value: "a" }, { label: "Beta", value: "b" }, { label: "alphabet", value: "c" }];
  expect(filterOptions(options, "ALP").map((option) => option.value)).toEqual(["a", "c"]);
  expect(filterOptions(options, "  ")).toHaveLength(3);
  expect(filterOptions(options, "b", (option, query) => option.value === query).map((option) => option.label)).toEqual(["Beta"]);
  expect(filterOptions(options, "zzz")).toEqual([]);
});
