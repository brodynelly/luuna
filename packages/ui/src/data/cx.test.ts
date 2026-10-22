import { expect, test } from "vitest";
import { cx } from "./cx";

test("joins names and skips empty values", () => {
  expect(cx("a", undefined, false, null, "", "b")).toBe("a b");
  expect(cx()).toBe("");
});
