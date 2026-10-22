import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { declarations, rules } from "./lint";

// Evidence never animates (docs/DESIGN-SYSTEM.md, ADR 0031/0032). Screen sheets other than the
// shell's (item C) must not declare motion on evidence selectors, and the live output card stays untransformed.
const root = new URL("../screens/", import.meta.url);
const sheets = readdirSync(root, { recursive: true }).filter((file) => file.endsWith(".css") && !["app.css", "shell.css"].includes(file));
const read = (file: string) => readFileSync(new URL(file, root), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const EVIDENCE = /\.candidate-review\b|\.plan-review\b|\.facts\b|\.state\b|\.callout\b|\.failure-note\b|\.recovery-note\b|\.check-record\b|\.finding-record\b|\.publication\b|ol\.events|\bpre\b/;
const MOTION = /^(?:animation(?:-[\w-]+)?|transition(?:-[\w-]+)?|opacity|transform|translate|scale|rotate)$/;
const motionOn = (css: string) => rules(css).filter(({ selector }) => selector.split(",").some((part) => EVIDENCE.test(part))).flatMap(({ selector, body }) => declarations(`${body};`).filter(([property]) => MOTION.test(property)).map(([property]) => `${selector} { ${property} }`));

describe("screen sheets and evidence", () => {
  test("there are screen sheets to check", () => expect(sheets).toContain("sessions.css"));
  for (const sheet of sheets) {
    test(`${sheet} declares no animation, transition or opacity on evidence selectors`, () => {
      expect(motionOn(read(sheet))).toEqual([]);
    });
  }
  test("the evidence check rejects a hover lift, a transition and a fade, and accepts static depth", () => {
    expect(motionOn(".facts:hover { transform: translateY(var(--lift-y)); }")).toHaveLength(1);
    expect(motionOn(".candidate-review .check-record { transition: box-shadow var(--duration-micro) var(--ease-out); }")).toHaveLength(1);
    expect(motionOn(".callout { opacity: 0; }")).toHaveLength(1);
    expect(motionOn(".candidate-review { box-shadow: var(--shadow-card); border-radius: var(--radius-card); }")).toEqual([]);
    expect(motionOn(".board-cards > li > button.run-card:hover { transform: translateY(var(--lift-y)); }")).toEqual([]);
  });
  test("sessions.css never transforms, filters or fades the live output card or its descendants", () => {
    const found = rules(read("sessions.css")).filter(({ selector }) => /\.assistant-output/.test(selector)).flatMap(({ selector, body }) => declarations(`${body};`).filter(([property]) => /^(?:transform|will-change|filter|opacity|translate|scale|rotate)$/.test(property)).map(([property]) => `${selector} { ${property} }`));
    expect(found).toEqual([]);
  });
});
