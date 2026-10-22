import { describe, expect, test } from "vitest";
import { fillProblems, filterProblems, gradientProblems, keyframeProblems, leftRuleProblems, leftRuleSelectors, opacityProblems, splitAtRules, timingProblems, tsxStyleProblems, willChangeProblems } from "./lint";

// A rule that cannot fail is not evidence: each rule is shown to accept and to reject (ADR 0032, ADR 0033).
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
    expect(filterProblems(".x { filter: blur(var(--blur-sm)) }")).toEqual([]);
    expect(filterProblems(".x { backdrop-filter: none }")).toEqual([]);
    expect(filterProblems(".x { filter: blur(4px) }")).toHaveLength(1);
    expect(filterProblems(".x { -webkit-backdrop-filter: blur(4px) }")).toHaveLength(1);
    expect(willChangeProblems(".x { transform: none }")).toEqual([]);
    expect(willChangeProblems(".x { will-change: transform }")).toHaveLength(1);
  });
});

describe("ADR 0033 rules", () => {
  test("gradients are rejected in every value", () => {
    expect(gradientProblems(".x { background: var(--surface); box-shadow: none }")).toEqual([]);
    expect(gradientProblems(".x { background: var(--wash-token) }")).toEqual([]);
    expect(gradientProblems(".x { background: linear-gradient(90deg, red, blue) }")).toHaveLength(1);
    expect(gradientProblems(".x { background-image: radial-gradient(circle, red, blue) }")).toHaveLength(1);
    expect(gradientProblems(".x { background: repeating-conic-gradient(red, blue) }")).toHaveLength(1);
    expect(gradientProblems(":root { --wash: LINEAR-GRADIENT(red, blue) }")).toHaveLength(1);
  });

  test("a coloured left rule is rejected", () => {
    expect(leftRuleProblems(".card { border: var(--border-width) solid var(--separator); border-left: var(--border-width) solid var(--separator) }")).toEqual([]);
    expect(leftRuleProblems(".card { border-right: var(--rule-width) solid var(--tone-mark) }")).toEqual([]);
    expect(leftRuleProblems(".card { box-shadow: var(--shadow-card) }")).toEqual([]);
    expect(leftRuleProblems(".a { border-left: var(--rule-width) solid var(--tone-mark) }")).toHaveLength(1);
    expect(leftRuleProblems(".a { border-left-color: var(--color-accent) }")).toHaveLength(1);
    expect(leftRuleProblems(".a { border-inline-start: var(--border-width) solid var(--accent) }")).toHaveLength(1);
    expect(leftRuleProblems(".a { border-inline-start-color: var(--tone-fg) }")).toHaveLength(1);
    expect(leftRuleProblems(".a { box-shadow: inset var(--rule-width) 0 0 var(--tone-mark) }")).toHaveLength(1);
    expect(leftRuleSelectors(".a,\n .b > .c { border-left: var(--rule-width) solid var(--tone-mark) } .d { color: var(--ink) }")).toEqual([".a, .b > .c"]);
  });

  test("gradient utilities and strings in TSX are rejected", () => {
    expect(tsxStyleProblems('<div className="flex items-center bg-surface to" />')).toEqual([]);
    expect(tsxStyleProblems('<p>{"Back to the list"}</p>')).toEqual([]);
    for (const bad of ["bg-gradient-to-r", "bg-linear-to-b", "bg-radial-[at_top]", "bg-conic-90", "from-accent", "via-surface", "to-accent", "hover:from-accent"]) {
      expect(tsxStyleProblems('<div className="flex ' + bad + '" />'), bad).not.toEqual([]);
    }
    expect(tsxStyleProblems("const s = 'linear-gradient(red, blue)'")).not.toEqual([]);
  });
});

describe("tsx utilities", () => {
  test("token-bound layout utilities and plain text pass", () => {
    expect(tsxStyleProblems('<div className="flex items-center gap-2 text-sm bg-surface rounded-card p-4 hover:bg-accent-tint md:grid transition-none shadow-none" />')).toEqual([]);
    expect(tsxStyleProblems('<div className="w-[var(--menu-w)] shadow-[var(--shadow-card)]" />')).toEqual([]);
    expect(tsxStyleProblems("const message = 'Ease of use: one opacity of effort'; // opacity-50 in a comment")).toEqual([]);
    expect(tsxStyleProblems('const x = PATHS[name]; /* duration-300 */')).toEqual([]);
  });

  test("motion and effect utilities are rejected, with variants and importance", () => {
    for (const bad of ["opacity-50", "transition", "transition-all", "transition-colors", "animate-spin", "duration-300", "ease-in-out", "delay-150", "will-change-transform", "blur-sm", "backdrop-blur-md", "shadow-lg", "hover:opacity-80", "md:hover:-translate-y-1 transition-all", "!opacity-0"]) {
      expect(tsxStyleProblems('<div className="flex ' + bad + '" />'), bad).not.toEqual([]);
    }
    expect(tsxStyleProblems("const c = `flex ${on ? 'opacity-0' : ''}`;")).toHaveLength(1);
  });

  test("arbitrary values with literal colours, lengths or durations are rejected", () => {
    for (const bad of ["w-[300px]", "bg-[#635bff]", "text-[rgb(0,0,0)]", "[transition:opacity_200ms]", "gap-[0.5rem]", "[animation-duration:2s]"]) {
      expect(tsxStyleProblems('<div className="' + bad + '" />'), bad).not.toEqual([]);
    }
  });

  test("inline CSS declarations in strings are rejected", () => {
    expect(tsxStyleProblems('el.setAttribute("style", "opacity: 0")')).toHaveLength(1);
    expect(tsxStyleProblems("const s = 'transition: transform 200ms'")).toHaveLength(1);
    expect(tsxStyleProblems('el.style.setProperty("--menu-x", "4px")')).toEqual([]);
  });
});
