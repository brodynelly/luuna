import { createElement } from "react";
import { expect, test } from "vitest";
import { describedBy, fieldWiring, hasContent, joinClass, labelText, slugName } from "./identity";

test("labelText flattens nested label content and slugName falls back to the id", () => {
  expect(labelText(createElement("span", null, "Checkout of ", createElement("code", null, "app")))).toBe("Checkout of  app");
  expect(slugName("Project name", "id-1")).toBe("project-name");
  expect(slugName(createElement("span"), "id-1")).toBe("id-1");
});

test("hasContent treats empty slots as absent and zero as present", () => {
  expect([undefined, null, false, ""].map(hasContent)).toEqual([false, false, false, false]);
  expect(["x", 0, createElement("b")].map(hasContent)).toEqual([true, true, true]);
});

test("describedBy joins only real ids", () => {
  expect(describedBy(undefined, false, "")).toBeUndefined();
  expect(describedBy("a", false, "b")).toBe("a b");
});

test("fieldWiring links hint and error ids and marks invalid only with an error", () => {
  const plain = fieldWiring("f", {});
  expect(plain.control).toEqual({ id: "f", "aria-describedby": undefined, "aria-invalid": undefined, "aria-required": undefined });
  const full = fieldWiring("f", { hint: "Help", error: "Fix it", required: true, describedBy: "extra" });
  expect(full.hintId).toBe("f-hint");
  expect(full.errorId).toBe("f-error");
  expect(full.control["aria-describedby"]).toBe("extra f-hint f-error");
  expect(full.control["aria-invalid"]).toBe(true);
  expect(full.control["aria-required"]).toBe(true);
  expect(fieldWiring("f", { hint: "Help" }).control["aria-invalid"]).toBeUndefined();
});

test("joinClass drops empties", () => {
  expect(joinClass("a", undefined, false, "b")).toBe("a b");
  expect(joinClass(undefined)).toBeUndefined();
});
