import { describe, expect, test } from "vitest";
import { fillProblems, filterProblems, keyframeProblems, opacityProblems, splitAtRules, timingProblems, willChangeProblems } from "./lint";

// A rule that cannot fail is not evidence: each rule is shown to accept and to reject (ADR 0032).
describe("lint rules", () => {
  test("splitAtRules balances nested braces", () => {
    const { inside, outside } = splitAtRules("a { x: 1 } @keyframes k { from { opacity: 0 } to { opacity: 1 } } b { y: 2 }", "keyframes");
    expect(inside).toHaveLength(1);
    expect(inside[0]).toContain("to { opacity: 1 }");
    expect(outside).toContain("a { x: 1 }");
    expect(outside).toContain("b { y: 2 }");
    expect(outside).not.toContain("keyframes");
  });

  test("opacity", () => {
    expect(opacityProblems("@keyframes a { from { opacity: 0; transform: translateY(var(--reveal-offset)); } }")).toEqual([]);
    expect(opacityProblems("@keyframes a { from { opacity: var(--start); } }")).toEqual([]);
    expect(opacityProblems(".g::before { opacity: 0 }")).toEqual([]);
    expect(opacityProblems(".g::after, .h::backdrop { opacity: 1 }")).toEqual([]);
    expect(opacityProblems("transition: opacity var(--duration-fast) var(--ease)")).toEqual([]);
    expect(opacityProblems(".x { opacity: 0.5 }")).toHaveLength(1);
    expect(opacityProblems(".x::before { opacity: 0.4 }")).toHaveLength(1);
    expect(opacityProblems(".x { opacity: 1 }")).toHaveLength(1);
    expect(opacityProblems(".x::before, .y { opacity: 0 }")).toHaveLength(1);
    expect(opacityProblems("@keyframes a { from { opacity: 2 } }")).toHaveLength(1);
  });

  test("durations and easings are tokens", () => {
    expect(timingProblems(".a { transition: transform var(--duration-standard) var(--ease-out) }")).toEqual([]);
    expect(timingProblems(".a { transition: none }")).toEqual([]);
    expect(timingProblems(".a { transition: color var(--duration-fast) var(--ease), transform var(--duration-press) var(--ease-out) }")).toEqual([]);
    expect(timingProblems(".a { animation: a var(--duration-large) var(--ease-out) backwards }")).toEqual([]);
    expect(timingProblems(".a { animation-delay: calc(var(--i) * var(--duration-stagger)) }")).toEqual([]);
    expect(timingProblems(".a { transition: color var(--duration-fast) ease-out }")).not.toEqual([]);
    expect(timingProblems(".a { transition: all var(--duration-fast) var(--ease) }")).not.toEqual([]);
    expect(timingProblems(".a { transition: color var(--duration-fast) cubic-bezier(0, 0, 1, 1) }")).not.toEqual([]);
    expect(timingProblems(".a { transition: color 1s var(--ease) }")).not.toEqual([]);
    expect(timingProblems(".a { transition-timing-function: linear }")).not.toEqual([]);
    expect(timingProblems(".a { transition: color var(--duration-fast) var(--ease), transform 1s }")).not.toEqual([]);
  });

  test("keyframes animate only the allowed properties", () => {
    expect(keyframeProblems("@keyframes a { from { transform: scale(1); background-position: 0 0 } to { stroke-dashoffset: 0; clip-path: inset(0) } }")).toEqual([]);
    expect(keyframeProblems("@keyframes b { from { width: 0 } }")).toHaveLength(1);
    expect(keyframeProblems("@keyframes c { from { color: red } }")).toHaveLength(1);
  });

  test("nothing is left animated at rest", () => {
    expect(fillProblems(".x { animation: a var(--duration-large) var(--ease-out) backwards }")).toEqual([]);
    expect(fillProblems("::view-transition-old(root) { animation-fill-mode: both }")).toEqual([]);
    expect(fillProblems(".x { animation: a var(--duration-large) var(--ease-out) forwards }")).toHaveLength(1);
    expect(fillProblems(".x { animation-fill-mode: both }")).toHaveLength(1);
  });

  test("filters are tokens and will-change is banned", () => {
    expect(filterProblems(".x { filter: blur(var(--blur-aurora)) }")).toEqual([]);
    expect(filterProblems(".x { backdrop-filter: none }")).toEqual([]);
    expect(filterProblems(".x { filter: blur(4px) }")).toHaveLength(1);
    expect(filterProblems(".x { -webkit-backdrop-filter: blur(4px) }")).toHaveLength(1);
    expect(willChangeProblems(".x { transform: none }")).toEqual([]);
    expect(willChangeProblems(".x { will-change: transform }")).toHaveLength(1);
  });
});
