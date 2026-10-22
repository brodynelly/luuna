import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { declarations, rules, splitAtRules } from "./lint";

// Guards for the motion stylesheets (item B). Sheets are read with node:fs; the shared token lint
// in design-system.test.ts already covers values, so this file checks structure: what animates,
// what transitions, and that every animation has a reduced-motion switch-off.
const root = new URL("../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SHEETS = ["design/motion.css", "design/components.css", "design/overlays.css", "design/controls.css"];
const ANIMATED_SHEETS = ["design/motion.css", "design/components.css", "design/overlays.css"];
const ALLOWED = ["transform", "opacity", "background-position", "stroke-dashoffset"];
const LAYOUT = /^(?:width|height|min-width|min-height|max-width|max-height|inline-size|block-size|top|left|right|bottom|inset|inset-inline|inset-block|inset-inline-start|inset-block-end|margin|padding|all)\b/;

function topLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(" || char === "[") depth++;
    if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) { parts.push(current.trim()); current = ""; } else current += char;
  }
  return [...parts, current.trim()].filter(Boolean);
}

describe("motion stylesheets", () => {
  test("every @keyframes body animates only transform, opacity, background-position or stroke-dashoffset", () => {
    const bodies = SHEETS.flatMap((sheet) => splitAtRules(read(sheet), "keyframes").inside);
    expect(bodies.length).toBeGreaterThan(8);
    const problems = bodies.flatMap((body) => declarations(body)).filter(([property]) => !ALLOWED.includes(property)).map(([property, value]) => `${property}: ${value}`);
    expect(problems).toEqual([]);
  });

  test("no transition lists a layout property or all", () => {
    const problems: string[] = [];
    for (const sheet of SHEETS) {
      for (const [property, value] of declarations(splitAtRules(read(sheet), "keyframes").outside)) {
        if (property === "transition") for (const item of topLevel(value)) if (item !== "none" && LAYOUT.test(item)) problems.push(`${sheet}: transition ${item}`);
        if (property === "transition-property" && LAYOUT.test(value)) problems.push(`${sheet}: transition-property ${value}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("there is no will-change anywhere", () => {
    for (const sheet of [...SHEETS, "design/base.css"]) expect(read(sheet), sheet).not.toMatch(/will-change/);
  });

  for (const sheet of ANIMATED_SHEETS) {
    test(`${sheet}: every animated selector is switched off under prefers-reduced-motion`, () => {
      const css = read(sheet);
      const { inside, preludes, outside } = splitAtRules(css, "media");
      const animated = rules(splitAtRules(outside, "keyframes").outside).filter(({ body }) => declarations(`${body};`).some(([property, value]) => property === "animation" && value !== "none")).flatMap(({ selector }) => topLevel(selector));
      const off = new Set(inside.flatMap((body, index) => (preludes[index]!.includes("prefers-reduced-motion") ? rules(body) : [])).filter(({ body }) => declarations(`${body};`).some(([property, value]) => property === "animation" && value === "none")).flatMap(({ selector }) => topLevel(selector)));
      expect(animated.length).toBeGreaterThan(0);
      expect(animated.filter((selector) => !off.has(selector))).toEqual([]);
    });
  }

  test("the glow is not drawn under reduced motion, and only a fine hovering pointer lights it", () => {
    const { inside, preludes } = splitAtRules(read("design/motion.css"), "media");
    const reduced = inside.filter((_, index) => preludes[index]!.includes("prefers-reduced-motion")).flatMap(rules);
    expect(reduced.some(({ selector, body }) => selector === ".glow-surface::before" && /display:\s*none/.test(body))).toBe(true);
    const hover = inside.filter((_, index) => preludes[index] === "(hover: hover) and (pointer: fine)").flatMap(rules);
    expect(hover.map(({ selector }) => selector)).toContain(".glow-surface:hover::before");
  });

  test("the active chip pulses in CSS and live output never does", () => {
    const components = read("design/components.css");
    expect(components).toMatch(/\.state\[data-tone="active"\]::after \{[^}]*animation: pulse-ring/);
    const caret = rules(components).filter(({ selector }) => selector.includes("pre[data-live]"));
    expect(caret.length).toBeGreaterThan(0);
    for (const { body } of caret) expect(body).not.toMatch(/animation/);
  });

  test("overlays and the reveal fill backwards, so no transform remains at rest", () => {
    for (const sheet of ANIMATED_SHEETS) for (const [property, value] of declarations(splitAtRules(read(sheet), "keyframes").outside)) if (property === "animation" && /(?:menu|dialog|scrim|toast|reveal)-in/.test(value)) expect(value, `${sheet}: ${value}`).toMatch(/\bbackwards\b/);
  });
});
