import { describe, expect, test } from "vitest";
import { chooseSide, clamp, parsePlacement, placeFloating } from "./placement";

const viewport = { width: 1000, height: 800 };
const panel = { width: 200, height: 100 };
const anchorAt = (x: number, y: number) => ({ x, y, width: 80, height: 30 });

describe("placement math", () => {
  test("parses sides and alignments", () => {
    expect(parsePlacement("bottom")).toEqual({ side: "bottom", align: "center" });
    expect(parsePlacement("top-end")).toEqual({ side: "top", align: "end" });
    expect(parsePlacement("left-start")).toEqual({ side: "left", align: "start" });
  });

  test("bottom-start sits under the anchor, left edges aligned, with the gap", () => {
    expect(placeFloating({ anchor: anchorAt(300, 200), floating: panel, viewport, offset: 4 })).toEqual({ x: 300, y: 234, placement: "bottom-start" });
  });

  test("end alignment lines up right edges; centre splits the difference", () => {
    expect(placeFloating({ anchor: anchorAt(300, 200), floating: panel, viewport, placement: "bottom-end", offset: 4 }).x).toBe(300 + 80 - 200);
    expect(placeFloating({ anchor: anchorAt(300, 200), floating: panel, viewport, placement: "top", offset: 4 })).toEqual({ x: 240, y: 96, placement: "top" });
  });

  test("flips to the top when there is no room below, and back when there is no room above", () => {
    const low = placeFloating({ anchor: anchorAt(300, 740), floating: panel, viewport, offset: 4 });
    expect(low.placement).toBe("top-start");
    expect(low.y).toBe(740 - 100 - 4);
    const high = placeFloating({ anchor: anchorAt(300, 10), floating: panel, viewport, placement: "top", offset: 4 });
    expect(high.placement).toBe("bottom");
    expect(high.y).toBe(10 + 30 + 4);
  });

  test("flips left and right on the horizontal axis", () => {
    const edge = placeFloating({ anchor: anchorAt(930, 300), floating: panel, viewport, placement: "right", offset: 4 });
    expect(edge.placement).toBe("left");
    expect(edge.x).toBe(930 - 200 - 4);
  });

  test("keeps the preferred side when neither fits and it has more room", () => {
    const tall = { width: 200, height: 900 };
    expect(chooseSide("bottom", anchorAt(300, 100), tall, viewport, 4, 8)).toBe("bottom");
    expect(chooseSide("bottom", anchorAt(300, 600), tall, viewport, 4, 8)).toBe("top");
  });

  test("clamps across the viewport so the panel never leaves the window", () => {
    expect(placeFloating({ anchor: anchorAt(900, 200), floating: panel, viewport, margin: 8 }).x).toBe(1000 - 200 - 8);
    expect(placeFloating({ anchor: anchorAt(-40, 200), floating: panel, viewport, margin: 8 }).x).toBe(8);
  });

  test("a panel larger than the viewport sticks to the start margin", () => {
    expect(clamp(50, 1200, 1000, 8)).toBe(8);
    expect(clamp(-5, 100, 1000, 8)).toBe(8);
    expect(clamp(500, 100, 1000, 8)).toBe(500);
  });
});
