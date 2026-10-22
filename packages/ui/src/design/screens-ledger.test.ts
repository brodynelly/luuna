import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { declarations, rules } from "./lint";
import { DESKTOP_ROOT } from "./sheet-fixtures";

// Ledger "don'ts" for the screen sheets (ADR 0033, docs/DESIGN-SYSTEM.md). app.css and shell.css belong to the shell and have their own guards.
const screens = new URL("screens/", DESKTOP_ROOT);
const sources = DESKTOP_ROOT;
const sheets = readdirSync(screens, { recursive: true }).filter((file) => file.endsWith(".css") && !["app.css", "shell.css"].includes(file));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const readSheet = (file: string) => strip(readFileSync(new URL(file, screens), "utf8"));

/** Every forbidden pattern in one sheet, as `selector { property }` strings. */
export function problems(css: string): string[] {
  const found: string[] = [];
  for (const { selector, body } of rules(css)) {
    for (const [property, value] of declarations(`${body};`)) {
      const at = `${selector} { ${property} }`;
      if (/gradient/.test(value) || /--gradient-/.test(value)) found.push(`${at}: gradient`);
      if (property === "text-transform" && /uppercase/.test(value)) found.push(`${at}: uppercase`);
      if (/^border-(?:left|inline-start)(?:-color)?$/.test(property) && /--tone-|--color-accent|--accent/.test(value)) found.push(`${at}: coloured left border`);
      if (/--lift-y/.test(value)) found.push(`${at}: hover lift`);
      if (property === "position" && /sticky/.test(value) && /header/.test(selector)) found.push(`${at}: sticky header`);
      if (property === "max-width" && !/^(?:none|100%|var\(--(?:content-max-width|content-max|measure)\))$/.test(value.trim())) found.push(`${at}: max-width ${value} is not a content-max or measure token`);
    }
    if (/\.aurora\b|\.glow-surface\b/.test(selector)) found.push(`${selector}: decorative selector`);
  }
  return found;
}

describe("screen sheets obey the Ledger don'ts", () => {
  test("there are screen sheets to check", () => expect(sheets).toEqual(expect.arrayContaining(["help.css", "settings.css", "sessions.css"])));
  for (const sheet of sheets) test(`${sheet} has no gradient, uppercase, coloured left rule, hover lift, sticky header or decorative selector`, () => expect(problems(readSheet(sheet))).toEqual([]));

  test("the check catches each forbidden pattern and accepts the Ledger treatment", () => {
    expect(problems(".a { background: linear-gradient(var(--accent), var(--surface)); }")).toHaveLength(1);
    expect(problems(".a { background: var(--gradient-aurora); }")).toHaveLength(1);
    expect(problems(".a { text-transform: uppercase; }")).toHaveLength(1);
    expect(problems(".a { border-left: var(--rule-width) solid var(--tone-mark); }")).toHaveLength(1);
    expect(problems(".a { border-inline-start: 2px solid var(--color-accent); }")).toHaveLength(1);
    expect(problems(".a:hover { transform: translateY(var(--lift-y)); }")).toHaveLength(1);
    expect(problems(".project-header { position: sticky; top: 0; }")).toHaveLength(1);
    expect(problems(".aurora { color: var(--ink); } .glow-surface { color: var(--ink); }")).toHaveLength(2);
    expect(problems(".a { max-width: 900px; }")).toHaveLength(1);
    expect(problems(".a { max-width: var(--measure); background: var(--surface-muted); border: var(--border-width) solid var(--separator); } .rail { position: sticky; top: var(--topbar-height); }")).toEqual([]);
  });
});

describe("views compose no decorative primitive", () => {
  const views = readdirSync(sources, { recursive: true }).map((file) => file.split("\\").join("/")).filter((file) => /\.tsx$/.test(file) && !/\.test\./.test(file) && !/^(?:ui|design)\//.test(file));
  test("no view imports Aurora, GlowSurface or CheckDraw, or passes wash", () => {
    expect(views.length).toBeGreaterThan(10);
    const found = views.filter((file) => /\b(?:Aurora|GlowSurface|CheckDraw)\b|\bwash\b/.test(readFileSync(new URL(file, sources), "utf8")));
    expect(found).toEqual([]);
  });
});
