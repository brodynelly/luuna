import { expect, test } from "vitest";
import { HIDDEN, HOVER_QUERY, canHover, focusShowsTooltip, isVisible } from "./tooltipGate";

test("hover is offered only to a pointer that is fine and can hover", () => {
  const asked: string[] = [];
  const source = (matches: boolean) => ({ matchMedia: (query: string) => { asked.push(query); return { matches }; } });
  expect(canHover(source(true))).toBe(true);
  expect(canHover(source(false))).toBe(false);
  expect(asked).toEqual([HOVER_QUERY, HOVER_QUERY]);
  expect(HOVER_QUERY).toBe("(hover: hover) and (pointer: fine)");
});

test("no matchMedia means no hover, never a crash", () => {
  expect(canHover(undefined)).toBe(false);
  expect(canHover({})).toBe(false);
});

test("keyboard focus shows the tooltip, a mouse-click focus does not, and engines without :focus-visible count as keyboard", () => {
  expect(focusShowsTooltip({ matches: (selector) => selector === ":focus-visible" })).toBe(true);
  expect(focusShowsTooltip({ matches: () => false })).toBe(false);
  expect(focusShowsTooltip({})).toBe(true);
  expect(focusShowsTooltip({ matches: () => { throw new Error("unsupported selector"); } })).toBe(true);
});

test("the tooltip is visible while either hover or focus holds it", () => {
  expect(isVisible(HIDDEN)).toBe(false);
  expect(isVisible({ hover: true, focus: false })).toBe(true);
  expect(isVisible({ hover: false, focus: true })).toBe(true);
});
