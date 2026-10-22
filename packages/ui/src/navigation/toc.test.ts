import { expect, test } from "vitest";
import { tocHref, tocItems } from "./toc";

test("tocHref prefixes a single hash", () => {
  expect(tocHref("setup")).toBe("#setup");
  expect(tocHref("#setup")).toBe("#setup");
});

test("tocItems drops unlinkable entries and clamps levels", () => {
  expect(tocItems([{ id: "a", label: "A" }, { id: " ", label: "B" }, { id: "c", label: "" }, { id: "d", label: "D", level: 2 }])).toEqual([{ id: "a", label: "A", level: 1 }, { id: "d", label: "D", level: 2 }]);
});
