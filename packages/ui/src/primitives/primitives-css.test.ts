import { describe, expect, test } from "vitest";
import { declarations, gradientProblems, leftRuleProblems, motionProblems, rules } from "../design/lint";
import { read, sheets } from "../design/sheet-fixtures";

// The same rules design-system.test.ts runs over every registered sheet, applied to this family's sheet before the
// coordinator registers it. Not applied here: the labelled-scroll-region rule, which names its allowed selectors.
const FILE = "ui/primitives/primitives.css";
const css = read(FILE);
const MEDIA = ["(max-width: 920px)", "(max-width: 680px)"];

describe("primitives.css", () => {
  test("has rules, stays under 300 lines, and holds no gradient, motion or coloured left edge", () => {
    expect(rules(css).length).toBeGreaterThan(40);
    expect(css.split("\n").length).toBeLessThanOrEqual(300);
    expect([...gradientProblems(css), ...motionProblems(css), ...leftRuleProblems(css)]).toEqual([]);
  });

  test("uses tokens only: no colour, raw length or duration, no !important, text sizes from --text-*", () => {
    const problems: string[] = [];
    for (const [property, value] of declarations(css)) {
      const where = `${property}: ${value}`;
      if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix|light-dark)\(/i.test(value)) problems.push(`colour in ${where}`);
      if (/(?<![\w-])-?\d*\.?\d+(?:px|rem|em|pt|vw|vh|vmin|vmax|ch|ex|ms|s)\b/.test(value)) problems.push(`raw length or duration in ${where}`);
      if (property === "font-size" && !/^(?:var\(--text-[\w-]+\)|inherit)$/.test(value)) problems.push(`font-size must be var(--text-*): ${where}`);
      if (value.includes("!important")) problems.push(`!important in ${where}`);
      if (/--tone-/.test(value)) problems.push(`raw tone token in ${where}`);
    }
    expect(problems).toEqual([]);
  });

  test("never removes an outline, reads no tone, and truncates no identity", () => {
    for (const { selector, body } of rules(css)) {
      for (const [property, value] of declarations(`${body};`)) {
        if (property === "outline") expect(value, selector).not.toMatch(/^(?:none|0)$/);
        if (/\bcode\b/.test(selector)) expect([property === "text-overflow", property === "-webkit-line-clamp", property === "overflow" && value === "hidden"], selector).not.toContain(true);
      }
      expect(selector).not.toMatch(/\[data-tone/);
    }
  });

  test("only the two library breakpoints are used", () => {
    const queries = [...css.matchAll(/@media\s+([^{]+)\{/g)].map((match) => match[1].trim());
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(MEDIA).toContain(query);
  });

  test("every var() resolves to a custom property defined in a sheet or in this one", () => {
    const all = [...sheets.map(read), css].join("\n");
    const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    const missing = [...new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]))].filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  test("only the scroll area scrolls, and it is selected by its data hook", () => {
    for (const { selector, body } of rules(css)) {
      const scrolls = declarations(`${body};`).some(([property, value]) => /^overflow(-[xy])?$/.test(property) && /auto|scroll/.test(value));
      if (scrolls) expect(selector).toContain("[data-scroll-area]");
    }
  });
});
