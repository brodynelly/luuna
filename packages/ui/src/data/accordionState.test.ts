import { expect, test } from "vitest";
import { groupName, initialOpen } from "./accordionState";

const items = [{ id: "a" }, { id: "b", defaultOpen: true }, { id: "c", defaultOpen: true }];

test("single-open starts with one panel, multiple keeps every default", () => {
  expect(initialOpen(items, false)).toEqual(["b"]);
  expect(initialOpen(items, true)).toEqual(["b", "c"]);
  expect(initialOpen([{ id: "a" }], false)).toEqual([]);
});

test("single-open shares a name, multiple has none", () => {
  expect(groupName(false, ":r1:")).toBe(":r1:");
  expect(groupName(false, ":r1:", "faq")).toBe("faq");
  expect(groupName(true, ":r1:", "faq")).toBeUndefined();
});
