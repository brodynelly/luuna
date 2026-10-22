import { describe, expect, test } from "vitest";
import { declarations, rules } from "./lint";
import { read } from "./sheet-fixtures";

// Ledger rules (ADR 0033) in the four component sheets: flat controls, no coloured edges, no halo,
// one focus offset, sentence-case table headers, an invalid state and static badges.
const SHEETS = ["ui/styles/components.css", "ui/styles/controls.css", "ui/styles/overlays.css", "ui/styles/motion.css"];
const all = Object.fromEntries(SHEETS.map((sheet) => [sheet, read(sheet)]));
const everything = SHEETS.map((sheet) => all[sheet]).join("\n");
const rulesOf = (sheet: string) => rules(all[sheet]);

describe("Ledger component sheets", () => {
  test("no coloured left edge or inset accent rule", () => {
    for (const sheet of SHEETS) {
      for (const { selector, body } of rulesOf(sheet)) {
        for (const [property, value] of declarations(`${body};`)) {
          if (/^(?:border-left|border-left-color|border-inline-start|border-inline-start-color)$/.test(property)) expect(value, `${sheet}: ${selector}`).not.toMatch(/--tone-|accent|rule-width/);
          if (property === "box-shadow") expect(value, `${sheet}: ${selector}`).not.toMatch(/inset var\(--rule-width\)/);
        }
      }
    }
    expect(everything).not.toMatch(/border-left|--rule-width/);
  });

  test("no focus halo or inset highlight token in the controls or overlays", () => {
    for (const sheet of ["ui/styles/controls.css", "ui/styles/overlays.css"]) expect(all[sheet], sheet).not.toMatch(/--shadow-focus|--shadow-inset-highlight/);
    expect(everything).not.toMatch(/--shadow-inset-highlight|--shadow-kbd/);
  });

  test("buttons do not lift or scale", () => {
    expect(everything).not.toMatch(/translateY\(var\(--lift-y\)\)|--press-scale|--lift-y/);
    for (const sheet of SHEETS) {
      for (const { selector, body } of rulesOf(sheet)) {
        if (/button/.test(selector) && /:hover/.test(selector)) expect(declarations(`${body};`).map(([property]) => property), `${sheet}: ${selector}`).not.toContain("transform");
      }
    }
  });

  test("the field focus rule keeps the shared 2 px outline offset", () => {
    const focus = rulesOf("ui/styles/controls.css").find(({ selector }) => selector.startsWith("input:focus-visible"));
    expect(focus, "field focus rule").toBeDefined();
    expect(focus!.body).toContain("outline-offset: var(--focus-offset)");
  });

  test("table headers are sentence case", () => {
    const heads = rulesOf("ui/styles/controls.css").filter(({ selector }) => selector.startsWith(".table th"));
    expect(heads.length).toBeGreaterThan(0);
    for (const { body } of heads) expect(body).not.toMatch(/text-transform|letter-spacing/);
  });

  test("an invalid field has a danger rule, and a focused one has a danger ring", () => {
    const invalid = rulesOf("ui/styles/controls.css").filter(({ selector }) => selector.includes('[aria-invalid="true"]'));
    expect(invalid.length).toBeGreaterThanOrEqual(2);
    expect(invalid.every(({ body }) => body.includes("var(--danger)"))).toBe(true);
  });

  test("badges, tags and marks declare no animation", () => {
    for (const { selector, body } of rulesOf("ui/styles/components.css").filter(({ selector }) => /\.(?:state|tag)\b/.test(selector))) expect(body, selector).not.toMatch(/animation/);
  });

  test("disabled controls are shown by colour, never by opacity", () => {
    for (const sheet of SHEETS) for (const { selector, body } of rulesOf(sheet).filter(({ selector }) => selector.includes(":disabled"))) expect(body, `${sheet}: ${selector}`).not.toMatch(/opacity/);
  });

  test("no earlier decorative styling remains", () => {
    expect(everything).not.toMatch(/gradient|aurora|glow|\.reveal|count-up|\.tab-indicator|--ease-spring/i);
  });
});
