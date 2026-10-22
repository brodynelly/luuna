import { describe, expect, test } from "vitest";
import { CONNECTION_LABEL, NAV_SECTIONS, OUTAGE_LABEL, OUTAGE_NOTE, VIEWS, viewForShortcut, viewShortcut } from "./views";

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

describe("status words", () => {
  test("the connection labels are the words the smokes read", () => {
    expect(CONNECTION_LABEL).toEqual({ connected: "Local runtime connected", reconnecting: "Reconnecting to runtime", offline: "Local runtime offline" });
  });
  test("the outage banner names its label and the durable-work sentence", () => {
    expect(OUTAGE_LABEL).toBe("Reconnecting");
    expect(OUTAGE_NOTE).toBe("Runs, candidates and worktrees are durable in the runtime; nothing is lost while Luuna waits.");
  });
});
