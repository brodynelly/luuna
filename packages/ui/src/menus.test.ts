import { describe, expect, it } from "vitest";
import { FOCUSABLE_SELECTOR, focusReturnTarget } from "./menus";
import type { FocusableLike } from "./menus";

/** A tiny element tree: closest() walks parents and honours only the focusable selector. */
class Node implements FocusableLike {
  constructor(readonly name: string, readonly focusable: boolean, readonly parent: Node | null = null) {}
  closest(selector: string): Node | null {
    if (selector !== FOCUSABLE_SELECTOR) throw new Error("unexpected selector");
    for (let node: Node | null = this; node; node = node.parent) if (node.focusable) return node;
    return null;
  }
  contains(other: unknown): boolean {
    for (let node = other as Node | null; node; node = node.parent) if (node === this) return true;
    return false;
  }
  focus() {}
}

describe("focus return for a context menu", () => {
  const outer = new Node("section", true);
  const row = new Node("li", false, outer);
  const button = new Node("button", true, row);
  const label = new Node("span", false, button);

  it("returns to the row's button when the secondary click lands on a span inside it", () => {
    expect(focusReturnTarget(label, row)).toBe(button);
  });
  it("keeps the target when it is itself focusable", () => {
    expect(focusReturnTarget(button, row)).toBe(button);
  });
  it("never climbs above the owner to a focusable ancestor", () => {
    const padding = new Node("div", false, row);
    expect(focusReturnTarget(padding, row)).toBe(padding);
  });
  it("is null without a target", () => {
    expect(focusReturnTarget(null, row)).toBeNull();
  });
});
