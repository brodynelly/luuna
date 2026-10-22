import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { declarations, gradientProblems, leftRuleProblems, motionProblems, rules, tsxStyleProblems } from "../design/lint";

// The data family's own sheets and sources obey the same rules the repo-wide design tests apply once the
// coordinator registers the sheets (tokens only, no gradients or coloured side rails, motion budget, 300 lines).
const dir = new URL("./", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, dir), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const names = readdirSync(dir, { recursive: true });
const sheets = names.filter((file) => file.endsWith(".css"));
const sources = names.filter((file) => /\.(tsx?)$/.test(file) && !file.includes(".test."));

describe("data family stylesheets", () => {
  test("there are at most two sheets, each with rules and within 300 lines", () => {
    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.length).toBeLessThanOrEqual(2);
    for (const sheet of sheets) { expect(read(sheet).split("\n").length, sheet).toBeLessThanOrEqual(300); expect(rules(strip(read(sheet))).length, sheet).toBeGreaterThan(0); }
  });

  for (const sheet of sheets) {
    test(`${sheet} uses tokens only and respects the motion and decoration bans`, () => {
      const css = strip(read(sheet));
      const problems: string[] = [];
      for (const [property, value] of declarations(css)) {
        const where = `${property}: ${value}`;
        if (/#[0-9a-f]{3,8}\b/i.test(value)) problems.push(`hex colour in ${where}`);
        if (/\b(?:rgba?|hsla?|color-mix|light-dark)\(/i.test(value)) problems.push(`colour function in ${where}`);
        if (/(?<![\w-])-?\d*\.?\d+(?:px|rem|em|pt|vw|vh|ch|ms|s)\b/.test(value)) problems.push(`raw length or duration in ${where}`);
        if (property === "font-size" && !/^(?:var\(--text-[\w-]+\)|inherit)$/.test(value)) problems.push(`font-size ${value}`);
        if (value.includes("!important")) problems.push(`!important in ${where}`);
        if (/--tone-/.test(value)) problems.push(`raw tone token in ${where}`);
      }
      for (const { selector, body } of rules(css)) {
        if (/\[data-tone/.test(selector)) problems.push(`tone mapping in ${selector}`);
        for (const [property, value] of declarations(`${body};`)) if (/^overflow(-y)?$|^max-height$/.test(property) && /auto|scroll|\d/.test(value)) problems.push(`scrolls: ${selector}`);
      }
      problems.push(...motionProblems(css), ...gradientProblems(css), ...leftRuleProblems(css));
      expect(problems, `\n${problems.join("\n")}`).toEqual([]);
    });
  }
});

describe("data family sources", () => {
  for (const file of sources) {
    test(`${file}: at most 300 lines, no inline style, no positive tabIndex, chips only through StatusBadge`, () => {
      const text = read(file);
      expect(text.split("\n").length).toBeLessThanOrEqual(300);
      expect(text).not.toMatch(/style=\{\{/);
      expect(text).not.toMatch(/tabIndex=\{[1-9]/);
      expect(text).not.toMatch(/className=\{?["'`]state\b/);
      expect(tsxStyleProblems(text)).toEqual([]);
      expect((text.match(/from "([^"]+)"/g) ?? []).map((match) => match.slice(6, -1)).filter((path) => !path.startsWith(".") && path !== "react")).toEqual([]);
    });
  }
});
