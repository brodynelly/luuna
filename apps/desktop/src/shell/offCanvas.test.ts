import { expect, test, vi } from "vitest";
import { closeTarget, NARROW_QUERY, navKey, settleFocus, sidebarCommand, watchNarrow } from "./offCanvas";
import type { NarrowQuery } from "./offCanvas";

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

const element = () => ({ focus: vi.fn() });
const documentStub = () => {
  const item = element(), menu = element(), main = element();
  return { item, menu, main, doc: { querySelector: vi.fn((selector: string) => (selector === '#app-sidebar [aria-current="page"]' ? item : null)), getElementById: vi.fn((id: string) => (id === "nav-menu" ? menu : id === "main" ? main : null)) } };
};

test("a close option picks where focus returns", () => {
  expect(closeTarget({ restoreFocus: true })).toBe("menu");
  expect(closeTarget({ focusMain: true })).toBe("main");
  expect(closeTarget({ restoreFocus: true, focusMain: true })).toBe("menu");
  expect(closeTarget({})).toBeNull();
});

test("opening focuses the current item and keeps the pending target", () => {
  const { doc, item, menu, main } = documentStub();
  expect(settleFocus(doc, true, "menu")).toBe("menu");
  expect(item.focus).toHaveBeenCalledTimes(1);
  expect(menu.focus).not.toHaveBeenCalled();
  expect(main.focus).not.toHaveBeenCalled();
});

test("closing focuses the menu button or the content once, then clears the target", () => {
  const first = documentStub();
  expect(settleFocus(first.doc, false, "menu")).toBeNull();
  expect(first.menu.focus).toHaveBeenCalledTimes(1);
  expect(first.main.focus).not.toHaveBeenCalled();
  const second = documentStub();
  expect(settleFocus(second.doc, false, "main")).toBeNull();
  expect(second.main.focus).toHaveBeenCalledTimes(1);
  const none = documentStub();
  expect(settleFocus(none.doc, false, null)).toBeNull();
  expect(none.doc.getElementById).not.toHaveBeenCalled();
  expect(none.item.focus).not.toHaveBeenCalled();
});

test("a missing element is skipped without throwing", () => {
  expect(settleFocus({ querySelector: () => null, getElementById: () => null }, true, null)).toBeNull();
  expect(settleFocus({ querySelector: () => null, getElementById: () => null }, false, "main")).toBeNull();
});

function queryStub(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = { matches, addEventListener: vi.fn((_type: "change", listener: () => void) => { listeners.add(listener); }), removeEventListener: vi.fn((_type: "change", listener: () => void) => { listeners.delete(listener); }) } satisfies NarrowQuery;
  return { query, listeners, set(value: boolean) { query.matches = value; for (const listener of [...listeners]) listener(); } };
}

test("watchNarrow reports now, on every change, and stops after cleanup", () => {
  const stub = queryStub(true);
  const match = vi.fn((_query: string) => stub.query);
  const seen: boolean[] = [];
  const stop = watchNarrow(match, (narrow) => seen.push(narrow));
  expect(match).toHaveBeenCalledWith(NARROW_QUERY);
  expect(seen).toEqual([true]);
  stub.set(false);
  expect(seen).toEqual([true, false]);
  stop();
  expect(stub.query.removeEventListener).toHaveBeenCalledTimes(1);
  expect(stub.listeners.size).toBe(0);
  stub.set(true);
  expect(seen).toEqual([true, false]);
});

test("watchNarrow without matchMedia watches nothing", () => {
  const apply = vi.fn();
  expect(() => watchNarrow(undefined, apply)()).not.toThrow();
  expect(apply).not.toHaveBeenCalled();
});
