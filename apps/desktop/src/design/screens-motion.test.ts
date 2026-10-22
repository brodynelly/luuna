import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { declarations, rules } from "./lint";

// Evidence never animates (docs/DESIGN-SYSTEM.md, ADR 0031/0032). Screen sheets other than the
// shell's (item C) must not declare motion on evidence selectors, and the live output card stays untransformed.
const root = new URL("../screens/", import.meta.url);
const sheets = readdirSync(root, { recursive: true }).filter((file) => file.endsWith(".css") && !["app.css", "shell.css"].includes(file));
const read = (file: string) => readFileSync(new URL(file, root), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const EVIDENCE = /\.candidate-review\b|\.plan-review\b|\.facts\b|\.state\b|\.callout\b|\.failure-note\b|\.recovery-note\b|\.check-record\b|\.finding-record\b|\.publication\b|ol\.events|\bpre\b/;
const MOTION = /^(?:animation(?:-[\w-]+)?|transition(?:-[\w-]+)?|opacity)$/;

describe("screen sheets and evidence", () => {
  test("there are screen sheets to check", () => expect(sheets).toContain("sessions.css"));
  for (const sheet of sheets) {
    test(`${sheet} declares no animation, transition or opacity on evidence selectors`, () => {
      const found = rules(read(sheet)).filter(({ selector }) => selector.split(",").some((part) => EVIDENCE.test(part))).flatMap(({ selector, body }) => declarations(`${body};`).filter(([property]) => MOTION.test(property)).map(([property]) => `${selector} { ${property} }`));
      expect(found).toEqual([]);
    });
  }
  test("sessions.css never transforms, filters or fades the live output card or its descendants", () => {
    const found = rules(read("sessions.css")).filter(({ selector }) => /\.assistant-output/.test(selector)).flatMap(({ selector, body }) => declarations(`${body};`).filter(([property]) => /^(?:transform|will-change|filter|opacity|translate|scale|rotate)$/.test(property)).map(([property]) => `${selector} { ${property} }`));
    expect(found).toEqual([]);
  });
});
