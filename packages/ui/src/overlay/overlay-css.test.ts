import { describe, expect, test } from "vitest";
import { declarations, gradientProblems, leftRuleProblems, motionProblems, rules, splitAtRules } from "../design/lint";
import { raw, read } from "../design/sheet-fixtures";

// The design tests lint only the sheets named in their manifest, and these two join it when the coordinator registers
// them. Until then this file applies the same rules (tokens only, motion budget, tone indirection, bans) to them.
const SHEETS = ["ui/overlay/overlay.css", "ui/overlay/feedback.css"];
const MEDIA = ["(prefers-reduced-motion: reduce)", "(forced-colors: active)", "(hover: hover)", "(pointer: fine)"];

for (const sheet of SHEETS) {
  describe(sheet, () => {
    const css = read(sheet);

    test("is small enough and has rules", () => {
      expect(raw(sheet).split("\n").length).toBeLessThanOrEqual(300);
      expect(rules(css).length).toBeGreaterThan(5);
    });

    test("uses tokens only: no literal colour, length, duration or font size, no !important", () => {
      const problems: string[] = [];
      for (const [property, value] of declarations(css)) {
        const where = `${property}: ${value}`;
        if (/#[0-9a-f]{3,8}\b/i.test(value)) problems.push(`hex colour in ${where}`);
        if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(value)) problems.push(`colour function in ${where}`);
        if (/(?:^|[\s,(])(?:white|black|red|green|blue|gray|grey)(?=$|[\s,)])/i.test(value)) problems.push(`named colour in ${where}`);
        if (/(?<![\w-])-?\d*\.?\d+(?:px|rem|em|pt|vw|vh|vmin|vmax|ch|ex|ms|s)\b/.test(value)) problems.push(`raw length or duration in ${where}`);
        if (property === "font-size" && !/^(?:var\(--text-[\w-]+\)|inherit)$/.test(value)) problems.push(`font-size must be var(--text-*): ${where}`);
        if (value.includes("!important")) problems.push(`!important in ${where}`);
        if (/--tone-(?:success|active|danger|attention|neutral|interrupted)-/.test(value)) problems.push(`raw tone token outside the tone indirection: ${where}`);
      }
      expect(problems).toEqual([]);
    });

    test("reads the tone only from an element that carries data-tone, and never maps a tone itself", () => {
      const problems: string[] = [];
      for (const { selector, body } of rules(css)) {
        if (/\[data-tone=/.test(selector)) problems.push(`tone mapping outside components.css: ${selector}`);
        if (/var\(--tone-(?:fg|bg|border|mark)\)/.test(body)) for (const part of selector.split(",")) if (!part.includes("[data-tone")) problems.push(`reads a tone without carrying data-tone: ${part.trim()}`);
      }
      expect(problems).toEqual([]);
    });

    test("obeys the motion budget, with no gradient and no coloured left edge", () => {
      expect([...motionProblems(css), ...gradientProblems(css), ...leftRuleProblems(css)]).toEqual([]);
    });

    test("only approved media queries, and no scrolling or outline removal", () => {
      const problems: string[] = [];
      for (const prelude of css.matchAll(/@media\s+([^{]+)\{/g)) for (const part of prelude[1].split(/\band\b|,/).map((item) => item.trim()).filter(Boolean)) if (!MEDIA.includes(part)) problems.push(`unapproved media query ${part}`);
      for (const { selector, body } of rules(css)) for (const [property, value] of declarations(`${body};`)) {
        if (property === "outline" && /^(?:none|0)$/.test(value)) problems.push(`outline removed in ${selector}`);
        if (property === "max-height" || (/^overflow(-y)?$/.test(property) && /auto|scroll/.test(value))) problems.push(`scrolling in ${selector}`);
      }
      expect(problems).toEqual([]);
    });

    test("every var() resolves to a custom property defined in the library", () => {
      const everything = ["ui/styles/tokens.css", "ui/styles/tokens-depth.css", "ui/styles/tokens-scale.css", "ui/styles/tokens-motion.css", "ui/styles/tokens-legacy.css", "ui/styles/components.css", ...SHEETS].map(read).join("\n");
      const defined = new Set([...everything.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
      const missing = [...new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]))].filter((name) => !defined.has(name));
      expect(missing).toEqual([]);
    });
  });
}

test("every entrance animation fills backwards and is switched off under reduced motion; no exit animation exists", () => {
  for (const sheet of SHEETS) {
    const { inside, preludes, outside } = splitAtRules(read(sheet), "media");
    const animated = rules(splitAtRules(outside, "keyframes").outside).filter(({ body }) => declarations(`${body};`).some(([property, value]) => property === "animation" && value !== "none")).flatMap(({ selector }) => selector.split(",").map((part) => part.trim()));
    const off = new Set(inside.flatMap((body, index) => (preludes[index].includes("prefers-reduced-motion") ? rules(body) : [])).filter(({ body }) => declarations(`${body};`).some(([property, value]) => property === "animation" && value === "none")).flatMap(({ selector }) => selector.split(",").map((part) => part.trim())));
    expect(animated.filter((selector) => !off.has(selector)), sheet).toEqual([]);
    for (const [property, value] of declarations(splitAtRules(outside, "keyframes").outside)) {
      if (property === "animation" && /(?:menu|dialog|scrim)-in/.test(value)) expect(value).toMatch(/\bbackwards\b/);
    }
    expect(read(sheet)).not.toMatch(/(?:menu|dialog|scrim|drawer|tooltip)-out|:not\(\[open\]\)\s*\{[^}]*animation/);
  }
});

test("the dialog and drawer rules never set display on the closed element, so a closed dialog stays hidden", () => {
  for (const { selector, body } of rules(read("ui/overlay/overlay.css"))) {
    if (!/dialog\.ov-(?:dialog|drawer)/.test(selector) || /\[open\]/.test(selector)) continue;
    expect(declarations(`${body};`).map(([property]) => property), selector).not.toContain("display");
  }
});
