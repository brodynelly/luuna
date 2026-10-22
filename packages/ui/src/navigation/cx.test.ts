import { expect, test } from "vitest";
import { cx } from "./cx";

test("cx keeps present names in order and drops the rest", () => {
  expect(cx("a", undefined, false, "", "b", null)).toBe("a b");
  expect(cx()).toBe("");
});
