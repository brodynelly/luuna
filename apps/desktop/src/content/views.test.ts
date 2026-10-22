import { describe, expect, test } from "vitest";
import { NAV_SECTIONS, VIEWS, viewForShortcut, viewShortcut } from "./views";

describe("navigation sections", () => {
  test("cover every view exactly once", () => {
    const listed: string[] = NAV_SECTIONS.flatMap((section) => [...section.views]);
    expect([...listed].sort()).toEqual(VIEWS.map((item) => item.id).sort());
  });
  test("keep the VIEWS order, so the shortcuts are stable", () => {
    expect(NAV_SECTIONS.flatMap((section) => [...section.views])).toEqual(VIEWS.map((item) => item.id));
  });
  test("every view's shortcut selects that view", () => {
    for (const { id } of VIEWS) {
      const key = viewShortcut(id).replace("Ctrl+", "");
      expect(viewForShortcut({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), id).toBe(id);
    }
  });
});
