import { describe, expect, test } from "vitest";
import { EMPTY_AHEAD, TYPE_AHEAD_MS, enabledIndexes, findTypeAhead, isTypeAheadKey, menuKeyAction, moveIndex, nextTypeAhead, triggerOpenKey } from "./menuNav";
import type { NavEntry } from "./menuNav";

const items: NavEntry[] = [{ label: "Copy id" }, { label: "Cancel run", disabled: true }, { label: "Open session" }, { label: "Open record" }, { label: "Rename" }];

describe("roving focus", () => {
  test("only enabled items take focus", () => {
    expect(enabledIndexes(items)).toEqual([0, 2, 3, 4]);
  });

  test("Down and Up wrap and skip disabled items", () => {
    expect(moveIndex(items, 0, "ArrowDown")).toBe(2);
    expect(moveIndex(items, 4, "ArrowDown")).toBe(0);
    expect(moveIndex(items, 0, "ArrowUp")).toBe(4);
    expect(moveIndex(items, 2, "ArrowUp")).toBe(0);
  });

  test("from no focus Down lands first and Up lands last; Home and End jump", () => {
    expect(moveIndex(items, -1, "ArrowDown")).toBe(0);
    expect(moveIndex(items, -1, "ArrowUp")).toBe(4);
    expect(moveIndex(items, 3, "Home")).toBe(0);
    expect(moveIndex(items, 3, "End")).toBe(4);
  });

  test("a menu with nothing enabled moves nowhere", () => {
    const dead = [{ label: "A", disabled: true }];
    expect(moveIndex(dead, -1, "ArrowDown")).toBe(-1);
    expect(menuKeyAction(dead, -1, { key: "ArrowDown" }, EMPTY_AHEAD, 0).action).toEqual({ type: "none" });
  });
});

describe("type-ahead", () => {
  test("only plain printable characters count; a space needs a search under way", () => {
    expect(isTypeAheadKey({ key: "o" }, false)).toBe(true);
    expect(isTypeAheadKey({ key: " " }, false)).toBe(false);
    expect(isTypeAheadKey({ key: " " }, true)).toBe(true);
    expect(isTypeAheadKey({ key: "o", ctrlKey: true }, false)).toBe(false);
    expect(isTypeAheadKey({ key: "Enter" }, false)).toBe(false);
  });

  test("the buffer grows inside the window and restarts after it", () => {
    const first = nextTypeAhead(EMPTY_AHEAD, "O", 1000);
    expect(first.text).toBe("o");
    expect(nextTypeAhead(first, "p", 1000 + TYPE_AHEAD_MS).text).toBe("op");
    expect(nextTypeAhead(first, "r", 1000 + TYPE_AHEAD_MS + 1).text).toBe("r");
  });

  test("one letter cycles through matches after the current item", () => {
    expect(findTypeAhead(items, 0, "o")).toBe(2);
    expect(findTypeAhead(items, 2, "o")).toBe(3);
    expect(findTypeAhead(items, 3, "o")).toBe(2);
    expect(findTypeAhead(items, 2, "oo")).toBe(3);
  });

  test("a longer string matches from the current item and skips disabled labels", () => {
    expect(findTypeAhead(items, 2, "open r")).toBe(3);
    expect(findTypeAhead(items, 2, "op")).toBe(2);
    expect(findTypeAhead(items, 0, "can")).toBe(-1);
    expect(findTypeAhead(items, 0, "")).toBe(-1);
  });

  test("a key press moves focus and remembers the buffer", () => {
    const first = menuKeyAction(items, 0, { key: "o" }, EMPTY_AHEAD, 100);
    expect(first.action).toEqual({ type: "focus", index: 2 });
    const second = menuKeyAction(items, 2, { key: "p" }, first.ahead, 200);
    expect(second.ahead.text).toBe("op");
    expect(second.action).toEqual({ type: "focus", index: 2 });
    expect(menuKeyAction(items, 2, { key: "x" }, EMPTY_AHEAD, 300).action).toEqual({ type: "none" });
  });
});

describe("close keys and the trigger", () => {
  test("Escape closes and is handled; Tab closes and is left to the browser", () => {
    expect(menuKeyAction(items, 2, { key: "Escape" }, EMPTY_AHEAD, 0).action).toEqual({ type: "close", preventDefault: true });
    expect(menuKeyAction(items, 2, { key: "Tab" }, EMPTY_AHEAD, 0).action).toEqual({ type: "close", preventDefault: false });
  });

  test("Enter and Space are not intercepted: the focused button's own click selects", () => {
    expect(menuKeyAction(items, 2, { key: "Enter" }, EMPTY_AHEAD, 0).action).toEqual({ type: "none" });
    expect(menuKeyAction(items, 2, { key: " " }, EMPTY_AHEAD, 0).action).toEqual({ type: "none" });
  });

  test("the trigger opens on Down (first) and Up (last) only", () => {
    expect(triggerOpenKey("ArrowDown")).toBe("first");
    expect(triggerOpenKey("ArrowUp")).toBe("last");
    expect(triggerOpenKey("Enter")).toBeNull();
  });
});
