import { describe, expect, it } from "vitest";
import { distanceToBottom, isNearBottom, parseCssPx, parseCssTime, settled, snapToDevicePixel, springStep, type SpringState } from "./glide";

function run(start: SpringState, durationMs: number, totalMs: number, stepMs = 16): SpringState {
  let state = start;
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) state = springStep(state, stepMs, durationMs);
  return state;
}

describe("springStep", () => {
  it("leaves under 1% of the distance after the duration, from rest", () => {
    expect(Math.abs(run({ x: -1000, v: 0 }, 160, 160).x)).toBeLessThan(10);
  });

  it("does not overshoot from rest", () => {
    let state: SpringState = { x: -400, v: 0 };
    for (let i = 0; i < 40; i += 1) {
      state = springStep(state, 16, 160);
      expect(state.x).toBeLessThanOrEqual(0);
    }
  });

  it("returns the same state for dt = 0 and treats a negative dt as 0", () => {
    expect(springStep({ x: -50, v: 1 }, 0, 160)).toEqual({ x: -50, v: 1 });
    expect(springStep({ x: -50, v: 1 }, -16, 160)).toEqual({ x: -50, v: 1 });
  });

  it("lands exactly on the target when the duration is 0", () => {
    expect(springStep({ x: -300, v: 2 }, 16, 0)).toEqual({ x: 0, v: 0 });
  });

  it("stays finite and settles after a 5000 ms step", () => {
    const state = springStep({ x: -900, v: 3 }, 5000, 160);
    expect(Number.isFinite(state.x)).toBe(true);
    expect(settled(state)).toBe(true);
  });

  it("keeps the gap bounded while the target moves, then converges", () => {
    let state: SpringState = { x: 0, v: 0 };
    let worst = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      state = { x: state.x - 20, v: state.v };
      state = springStep(state, 16, 160);
      worst = Math.max(worst, Math.abs(state.x));
    }
    expect(worst).toBeLessThan(600);
    for (let frame = 0; frame < 60; frame += 1) state = springStep(state, 16, 160);
    expect(state).toEqual({ x: 0, v: 0 });
  });
});

describe("bottom tests", () => {
  it("measures the distance and never goes negative", () => {
    expect(distanceToBottom(100, 500, 300)).toBe(100);
    expect(distanceToBottom(250, 500, 300)).toBe(0);
  });

  it("is near the bottom at, below and above the threshold", () => {
    expect(isNearBottom(48, 48)).toBe(true);
    expect(isNearBottom(10, 48)).toBe(true);
    expect(isNearBottom(49, 48)).toBe(false);
  });
});

describe("token parsing", () => {
  it("parses times", () => {
    expect(parseCssTime("160ms", 1)).toBe(160);
    expect(parseCssTime("0.16s", 1)).toBe(160);
    expect(parseCssTime(" 0ms ", 1)).toBe(0);
    expect(parseCssTime("", 160)).toBe(160);
    expect(parseCssTime("x", 160)).toBe(160);
  });

  it("parses pixels", () => {
    expect(parseCssPx("48px", 1)).toBe(48);
    expect(parseCssPx("", 48)).toBe(48);
    expect(parseCssPx("3rem", 48)).toBe(48);
  });

  it("snaps to device pixels", () => {
    expect(snapToDevicePixel(10.3, 2)).toBe(10.5);
    expect(snapToDevicePixel(10.3, 1)).toBe(10);
    expect(snapToDevicePixel(10.3, 0)).toBe(10);
  });
});
