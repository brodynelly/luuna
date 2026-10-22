import { expect, test } from "vitest";
import { NARROW_QUERY, navKey, sidebarCommand } from "./offCanvas";

test("the breakpoint is Ledger's 768 px", () => {
  expect(NARROW_QUERY).toBe("(max-width: 768px)");
});

test("narrow windows open the drawer, wide ones collapse the rail", () => {
  expect(sidebarCommand(true)).toBe("drawer");
  expect(sidebarCommand(false)).toBe("collapse");
});

test("Escape closes only an open panel; other keys do nothing", () => {
  expect(navKey({ key: "Escape" }, true)).toBe("close");
  expect(navKey({ key: "Escape" }, false)).toBeNull();
  expect(navKey({ key: "Tab" }, true)).toBeNull();
});
