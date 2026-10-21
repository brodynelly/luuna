import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "./StatusBadge";
import { TONES, baselineTone, candidateTone, checkTone, confidenceTone, connectionTone, leaseTone, manifestTone, runTone, severityTone, verdictTone } from "./tone";
import type { Tone } from "./tone";

// Stylesheets are read with node:fs: Vitest replaces `*.css?raw` imports with "", which would
// let every check below pass without reading anything. Each file read must be non-empty.
const root = new URL("../", import.meta.url);
const raw = (file: string) => readFileSync(new URL(file, root), "utf8");
const read = (file: string) => raw(file).replace(/\/\*[\s\S]*?\*\//g, "");
const files = readdirSync(root, { recursive: true }).map((file) => file.replaceAll("\\", "/")).sort();
const sheets = files.filter((file) => file.endsWith(".css"));
const TOKENS = "design/tokens.css";
const MANIFEST = "styles.css";
const EXPECTED_SHEETS = [MANIFEST, TOKENS, "design/base.css", "design/components.css", "screens/app.css", "screens/projects.css", "screens/workflows.css", "screens/candidate-review.css", "screens/project-components.css"];
const MEDIA = ["(max-width: 920px)", "(max-width: 680px)", "(prefers-reduced-motion: reduce)", "(prefers-color-scheme: light)", "(forced-colors: active)"];

const STATES = [...new Set([runTone, candidateTone, checkTone, baselineTone, verdictTone, severityTone, leaseTone, connectionTone].flatMap((map) => Object.keys(map)))];
const STATE_SELECTOR = new RegExp(`[.="'](?:${STATES.join("|")})(?![\\w-])`);

function declarations(css: string): Array<[string, string]> {
  return [...css.matchAll(/([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g)].map((match) => [match[1], match[2].trim()]);
}
function rules(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));
}

describe("stylesheets", () => {
  test("the manifest imports every design-system sheet in layer order and each has rules", () => {
    expect(EXPECTED_SHEETS.every((sheet) => sheets.includes(sheet))).toBe(true);
    expect(sheets.filter((sheet) => !EXPECTED_SHEETS.includes(sheet))).toEqual([]);
    for (const sheet of sheets) expect(read(sheet).trim().length, `${sheet} is empty`).toBeGreaterThan(0);
    for (const sheet of sheets.filter((name) => name !== MANIFEST)) expect(rules(read(sheet)).length, `${sheet} has no rules`).toBeGreaterThan(0);
    const manifest = read(MANIFEST).trim().split(/;\s*/).filter(Boolean);
    expect(manifest[0]).toBe("@layer tokens, base, components, screens");
    expect(manifest.slice(1)).toEqual(EXPECTED_SHEETS.slice(1).map((sheet) => `@import "./${sheet}" layer(${sheet === TOKENS ? "tokens" : sheet.startsWith("screens/") ? "screens" : sheet.replace(/^design\/|\.css$/g, "")})`));
  });

  for (const file of EXPECTED_SHEETS.filter((name) => name !== TOKENS && name !== MANIFEST)) {
    test(`${file} uses tokens only`, () => {
      const css = read(file);
      const problems: string[] = [];
      for (const [property, value] of declarations(css)) {
        const where = `${property}: ${value}`;
        if (/#[0-9a-f]{3,8}\b/i.test(value)) problems.push(`hex colour in ${where}`);
        if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(value)) problems.push(`colour function in ${where}`);
        if (/(?:^|[\s,(])(?:white|black|red|green|blue|gray|grey)(?=$|[\s,)])/i.test(value)) problems.push(`named colour in ${where}`);
        if (/(?<![\w-])-?\d*\.?\d+(?:px|rem|em|pt|vw|vh|vmin|vmax|ch|ex|ms|s)\b/.test(value)) problems.push(`raw length or duration in ${where}`);
        if (property === "font-size" && !/^(?:var\(--text-[\w-]+\)|inherit)$/.test(value)) problems.push(`font-size must be var(--text-*): ${where}`);
        if (property === "opacity") problems.push(`opacity hides contrast from the audit; use a disabled colour token: ${where}`);
        if (value.includes("!important")) problems.push(`!important in ${where}`);
        if (/--tone-(?:success|active|danger|attention|neutral|interrupted)-/.test(value) && file !== "design/components.css") problems.push(`raw tone token outside the tone indirection: ${where}`);
      }
      for (const { selector, body } of rules(css)) {
        for (const [property, value] of declarations(`${body};`)) {
          if (property === "outline" && /^(?:none|0)$/.test(value) && selector !== "main:focus") problems.push(`outline removed in ${selector}`);
          if ((property === "max-height" || (/^overflow(-y)?$/.test(property) && /auto|scroll/.test(value))) && !/ol\.events|pre\[aria-label/.test(selector)) problems.push(`only labelled scroll regions may scroll: ${selector} { ${property}: ${value} }`);
          if (/\b(?:code|pre)\b/.test(selector) && (property === "text-overflow" || property === "-webkit-line-clamp" || (property === "overflow" && value === "hidden"))) problems.push(`identities are never truncated: ${selector} { ${property}: ${value} }`);
        }
        if (/\[data-tone=/.test(selector) && file !== "design/components.css") problems.push(`tone mapping outside components.css: ${selector}`);
        // Custom properties inherit: a rule may read the tone only from an element that carries data-tone itself.
        if (/var\(--tone-(?:fg|bg|border|mark)\)/.test(body)) for (const part of selector.split(",")) if (!part.includes("[data-tone")) problems.push(`reads a tone without carrying data-tone: ${part.trim()}`);
        // Style by tone, never by a runtime state name (Kanban columns, badges and cards all go through tone.ts).
        for (const part of selector.replace(/\[data-tone(?:="[^"]*")?\]/g, "").split(",")) if (STATE_SELECTOR.test(part)) problems.push(`selector names a runtime state: ${part.trim()}`);
        if (file.startsWith("screens/") && selector.split(",").some((part) => (part.match(/>/g) ?? []).length > 3)) problems.push(`scope by a unique class with at most three child steps: ${selector}`);
      }
      for (const prelude of css.matchAll(/@media\s+([^{]+)\{/g)) {
        for (const part of prelude[1].split(/\band\b|,/).map((item) => item.trim()).filter(Boolean)) if (!MEDIA.includes(part)) problems.push(`unapproved media query ${part}`);
      }
      expect(problems, `\n${problems.join("\n")}`).toEqual([]);
    });
  }

  test("every var() reference resolves to a defined custom property", () => {
    const all = sheets.map(read).join("\n");
    const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    const missing = [...new Set([...all.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]))].filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });
});

// ---- WCAG 2.x contrast of every semantic pair, in both colour schemes ----
const tokens = read(TOKENS);
function block(start: number): string {
  const open = tokens.indexOf("{", start);
  return tokens.slice(open + 1, tokens.indexOf("}", open));
}
const darkBlock = block(tokens.indexOf(":root {"));
const lightBlock = block(tokens.indexOf(":root {", tokens.indexOf("@media (prefers-color-scheme: light)")));
const colours = (body: string) => new Map(declarations(body).filter(([name, value]) => /^--(color|tone)-/.test(name) && /^#[0-9a-f]{6}$/i.test(value)));
const dark = colours(darkBlock);
const light = colours(lightBlock);
function luminance(colour: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(colour.slice(index, index + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(one: string, two: string): number {
  const [high, low] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
const SURFACES = ["color-bg", "color-surface", "color-surface-raised", "color-surface-sunken", "color-field", "color-control", "color-selected"];
const TEXT = ["color-text", "color-text-muted", "color-text-subtle", "color-accent"];
const PAIRS: Array<[string, string, number]> = [
  ...TEXT.flatMap((fg) => SURFACES.map((bg): [string, string, number] => [fg, bg, 4.5])),
  ...TONES.flatMap((tone): Array<[string, string, number]> => [
    [`tone-${tone}-fg`, `tone-${tone}-bg`, 4.5],
    [`tone-${tone}-fg`, "color-surface", 4.5],
    [`tone-${tone}-fg`, "color-surface-raised", 4.5],
    [`tone-${tone}-fg`, "color-bg", 4.5],
    [`tone-${tone}-mark`, `tone-${tone}-bg`, 3],
    [`tone-${tone}-mark`, "color-surface", 3],
    [`tone-${tone}-mark`, "color-surface-raised", 3],
  ]),
  ["color-on-accent", "color-accent", 4.5],
  ["color-on-accent", "color-accent-hover", 4.5],
  ["color-text", "color-control-hover", 4.5],
  ["color-accent", "color-selected", 3],
  ...["color-bg", "color-surface", "color-surface-raised", "color-surface-sunken"].map((bg): [string, string, number] => ["color-focus", bg, 3]),
  ...["color-bg", "color-surface", "color-surface-raised", "color-surface-sunken", "color-field", "color-control", "color-selected"].map((bg): [string, string, number] => ["color-border-control", bg, 3]),
];

describe("colour tokens", () => {
  test("both schemes define the same colour roles, every one a #rrggbb value", () => {
    expect(dark.size).toBeGreaterThan(40);
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
    const lightNames = declarations(lightBlock).map(([name]) => name).filter((name) => name.startsWith("--"));
    const darkNames = new Set(declarations(darkBlock).map(([name]) => name));
    expect(lightNames.filter((name) => !darkNames.has(name))).toEqual([]);
  });
  for (const [scheme, map] of [["dark", dark], ["light", light]] as const) {
    test.each(PAIRS)(`${scheme}: --%s on --%s meets %s:1`, (fg, bg, minimum) => {
      const one = map.get(`--${fg}`);
      const two = map.get(`--${bg}`);
      expect(one, `--${fg}`).toBeDefined();
      expect(two, `--${bg}`).toBeDefined();
      expect(contrast(one!, two!)).toBeGreaterThanOrEqual(minimum);
    });
  }
});

// ---- Screens: structure the smoke and the accessibility audit depend on ----
const SCREENS: Record<string, string[]> = { "App.tsx": ["h1", "h2", "h3"], "Projects.tsx": ["h2"], "ProjectComponents.tsx": ["h3", "h4"], "Workflows.tsx": ["h3"], "CandidateReview.tsx": ["h4"], "main.tsx": [], "design/StatusBadge.tsx": [] };
describe("screens", () => {
  test("every component file is registered here, so a new screen inherits these checks", () => {
    const components = files.filter((file) => file.endsWith(".tsx") && !file.includes(".test."));
    expect(components.filter((file) => !(file in SCREENS))).toEqual([]);
  });
  for (const [file, levels] of Object.entries(SCREENS)) {
    const source = raw(file);
    test(`${file}: headings keep their level, no inline styles, no positive tabIndex, badges through StatusBadge`, () => {
      expect([...new Set([...source.matchAll(/<(h[1-6])\b/g)].map((match) => match[1]))].sort()).toEqual(levels);
      expect(source).not.toMatch(/style=\{\{/);
      expect(source).not.toMatch(/tabIndex=\{[1-9]/);
      if (file !== "design/StatusBadge.tsx") expect(source).not.toMatch(/className=\{?["'`]state\b/);
    });
    test(`${file}: every alert carries a Dismiss button`, () => {
      for (const match of source.matchAll(/role="alert"/g)) {
        const element = source.slice(match.index, source.indexOf("</div>", match.index));
        expect(element).toContain(">Dismiss</button>");
      }
    });
  }
});

// ---- Tone taxonomy ----
describe("tone taxonomy", () => {
  const maps: Record<string, Record<string, Tone | undefined>> = { run: runTone, candidate: candidateTone, check: checkTone, baseline: baselineTone, verdict: verdictTone, severity: severityTone, lease: leaseTone, confidence: confidenceTone };
  test("every mapped value is one of the six tones", () => {
    for (const map of [...Object.values(maps), connectionTone]) for (const tone of Object.values(map)) if (tone !== undefined) expect(TONES).toContain(tone);
  });
  test("green is earned: only passed evidence and a live connection are success", () => {
    const success = Object.entries(maps).flatMap(([domain, map]) => Object.entries(map).filter(([, tone]) => tone === "success").map(([key]) => `${domain}.${key}`)).sort();
    expect(success).toEqual(["baseline.passed", "candidate.reviewed", "check.passed", "run.reviewed", "verdict.passed"]);
    expect(Object.entries(connectionTone).filter(([, tone]) => tone === "success").map(([key]) => key)).toEqual(["connected"]);
    expect(runTone.completed).not.toBe("success");
  });
  test("interruption is not failure", () => {
    expect([runTone.interrupted, candidateTone.interrupted, checkTone.interrupted, baselineTone.interrupted, leaseTone.abandoned, connectionTone.reconnecting]).toEqual(Array(6).fill("interrupted"));
    expect(manifestTone(0)).toBe("attention");
    expect(manifestTone(3)).toBeUndefined();
  });
  test("a badge renders the runtime text unchanged; the tone is an attribute", () => {
    expect(renderToStaticMarkup(createElement(StatusBadge, { tone: "danger", children: "testing blocked" }))).toBe('<span class="state" data-tone="danger">testing blocked</span>');
    expect(renderToStaticMarkup(createElement(StatusBadge, { children: "manifest r2" }))).toBe('<span class="state">manifest r2</span>');
  });
});
