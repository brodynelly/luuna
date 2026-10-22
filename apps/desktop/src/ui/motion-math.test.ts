import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EASE_OUT, EASE_OUT_POINTS, STAGGER_CAP, clamp, cubicBezier, indicatorGeometry, lerp, prefersReducedMotion, staggerIndex, tweenValue } from "./motion-math";

describe("clamp and lerp", () => {
  it("clamps into the range and interpolates linearly", () => {
    expect([clamp(-1, 0, 1), clamp(0.4, 0, 1), clamp(9, 0, 1)]).toEqual([0, 0.4, 1]);
    expect([lerp(10, 20, 0), lerp(10, 20, 0.5), lerp(10, 20, 1)]).toEqual([10, 15, 20]);
  });
});

describe("cubicBezier", () => {
  it("starts at 0 and ends at 1", () => {
    for (const ease of [EASE_OUT, cubicBezier(0.2, 0, 0, 1), cubicBezier(0.4, 0, 1, 1)]) expect([ease(0), ease(1)]).toEqual([0, 1]);
  });
  it("is monotonic and never overshoots for the out curve", () => {
    let previous = 0;
    for (let step = 1; step <= 100; step++) {
      const value = EASE_OUT(step / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });
  it("front-loads progress like an out curve and matches a linear curve when the handles are on the diagonal", () => {
    expect(EASE_OUT(0.2)).toBeGreaterThan(0.5);
    expect(cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3)(0.37)).toBeCloseTo(0.37, 4);
  });
});

describe("staggerIndex", () => {
  it("is the identity up to the cap, then holds, and never goes negative", () => {
    expect([0, 1, 5, 9].map((i) => staggerIndex(i))).toEqual([0, 1, 5, 9]);
    expect([10, 11, 400].map((i) => staggerIndex(i))).toEqual([10, 10, 10]);
    expect(staggerIndex(-3)).toBe(0);
    expect(STAGGER_CAP).toBe(10);
  });
});

describe("tweenValue", () => {
  it("gives the end value for no duration or an elapsed time past it, and the start before", () => {
    expect(tweenValue(0, 100, 50, 0)).toBe(100);
    expect(tweenValue(0, 100, 900, 800)).toBe(100);
    expect(tweenValue(0, 100, 800, 800)).toBe(100);
    expect(tweenValue(0, 100, 0, 800)).toBe(0);
  });
  it("is between the ends at the midpoint", () => {
    const mid = tweenValue(0, 100, 400, 800);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
  });
});

describe("indicatorGeometry", () => {
  const list = { left: 100, top: 40, width: 400, height: 34 };
  it("offsets the tab inside the list and scales by the width ratio", () => {
    expect(indicatorGeometry(list, { left: 160, top: 40, width: 100, height: 34 })).toEqual({ x: 60, y: 0, scale: 0.25 });
    expect(indicatorGeometry(list, { left: 100, top: 74, width: 400, height: 34 })).toEqual({ x: 0, y: 34, scale: 1 });
  });
  it("gives scale 0 for a list with no width", () => {
    expect(indicatorGeometry({ ...list, width: 0 }, { left: 100, top: 40, width: 50, height: 34 }).scale).toBe(0);
  });
});

describe("prefersReducedMotion", () => {
  it("is false without matchMedia and follows the query when given one", () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion((query) => ({ matches: !query.includes("reduce") }))).toBe(false);
  });
});

describe("token drift guard", () => {
  it("EASE_OUT mirrors --ease-out in tokens-motion.css", () => {
    const css = readFileSync(new URL("../design/tokens-motion.css", import.meta.url), "utf8");
    const match = /--ease-out:\s*cubic-bezier\(([^)]+)\)/.exec(css);
    expect(match, "--ease-out token").not.toBeNull();
    expect(match![1]!.split(",").map(Number)).toEqual([...EASE_OUT_POINTS]);
  });
  it("the stagger cap mirrors the token comment", () => {
    const css = readFileSync(new URL("../design/tokens-motion.css", import.meta.url), "utf8");
    expect(css).toMatch(/--stagger-cap is 10/);
  });
});
