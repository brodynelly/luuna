import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "./StatusBadge";
import { TONES, baselineTone, candidateTone, checkTone, confidenceTone, connectionTone, leaseTone, manifestTone, runTone, severityTone, verdictTone } from "./tone";
import type { Tone } from "./tone";
import { declarations, motionProblems, rules } from "./lint";
import { ALLOWED_SELECTORS, DARK_MEDIA, DARK_MEDIA_SELECTOR, MANIFEST, TOKENS, TOKEN_SHEETS, colourThemes, depthThemes, media, read, sheets } from "./sheet-fixtures";


// Tailwind CSS v4 utilities (ADR 0030): last layer, its theme a reference to the tokens.
const TAILWIND = "design/tailwind.css";
// Platform fonts (ADR 0033 font amendment): @font-face descriptors plus the Söhne-first override. Last import of the tokens layer, but not a token sheet.
const FONTS = "design/fonts.css";
// Every sheet is registered once (ADR 0032); later items replace a sheet's content, never this list.
const EXPECTED_SHEETS = [MANIFEST, ...TOKEN_SHEETS, FONTS, "design/base.css", "design/components.css", "design/overlays.css", "design/controls.css", "design/motion.css", "screens/app.css", "screens/shell.css", "screens/home.css", "screens/board.css", "screens/projects.css", "screens/workflows.css", "screens/candidate-review.css", "screens/project-components.css", "screens/help.css", "screens/settings.css", "screens/sessions.css", "design/tailwind.css"];
function layerOf(sheet: string): string {
  if (TOKEN_SHEETS.includes(sheet) || sheet === FONTS) return "tokens";
  if (sheet === "design/base.css") return "base";
  if (sheet === TAILWIND) return "utilities";
  if (sheet.startsWith("screens/")) return "screens";
  return "components"; // components, overlays, controls, motion
}
const MEDIA = ["(max-width: 920px)", "(max-width: 768px)", "(max-width: 680px)", "(prefers-reduced-motion: reduce)", "(prefers-color-scheme: dark)", "(prefers-contrast: more)", "(forced-colors: active)", "(hover: hover)", "(pointer: fine)"];

const STATES = [...new Set([runTone, candidateTone, checkTone, baselineTone, verdictTone, severityTone, leaseTone, connectionTone].flatMap((map) => Object.keys(map)))];
const STATE_SELECTOR = new RegExp(`[.="'](?:${STATES.join("|")})(?![\\w-])`);

describe("stylesheets", () => {
  test("the manifest imports every design-system sheet in layer order and each has rules", () => {
    expect(EXPECTED_SHEETS.every((sheet) => sheets.includes(sheet))).toBe(true);
    expect(sheets.filter((sheet) => !EXPECTED_SHEETS.includes(sheet))).toEqual([]);
    for (const sheet of sheets) expect(read(sheet).trim().length, `${sheet} is empty`).toBeGreaterThan(0);
    for (const sheet of sheets.filter((name) => name !== MANIFEST)) expect(rules(read(sheet)).length, `${sheet} has no rules`).toBeGreaterThan(0);
    const manifest = read(MANIFEST).trim().split(/;\s*/).filter(Boolean);
    expect(manifest[0]).toBe("@layer tokens, base, components, screens, utilities");
    expect(manifest.slice(1)).toEqual(EXPECTED_SHEETS.slice(1).map((sheet) => `@import "./${sheet}" layer(${layerOf(sheet)})`));
  });

  for (const file of EXPECTED_SHEETS.filter((name) => !TOKEN_SHEETS.includes(name) && name !== MANIFEST)) {
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
        if (value.includes("!important")) problems.push(`!important in ${where}`);
        if (/--tone-(?:success|active|danger|attention|neutral|interrupted)-/.test(value) && file !== "design/components.css") problems.push(`raw tone token outside the tone indirection: ${where}`);
      }
      for (const { selector, body } of rules(css)) {
        for (const [property, value] of declarations(`${body};`)) {
          if (property === "outline" && /^(?:none|0)$/.test(value) && selector !== "main:focus") problems.push(`outline removed in ${selector}`);
          if ((property === "max-height" || (/^overflow(-y)?$/.test(property) && /auto|scroll/.test(value))) && !/ol\.events|pre\[aria-label|\[role="listbox"\]/.test(selector)) problems.push(`only labelled scroll regions may scroll: ${selector} { ${property}: ${value} }`);
          if (/\b(?:code|pre)\b/.test(selector) && (property === "text-overflow" || property === "-webkit-line-clamp" || (property === "overflow" && value === "hidden"))) problems.push(`identities are never truncated: ${selector} { ${property}: ${value} }`);
        }
        if (/\[data-tone=/.test(selector) && file !== "design/components.css") problems.push(`tone mapping outside components.css: ${selector}`);
        // Custom properties inherit: a rule may read the tone only from an element that carries data-tone itself.
        if (/var\(--tone-(?:fg|bg|border|mark)\)/.test(body)) for (const part of selector.split(",")) if (!part.includes("[data-tone")) problems.push(`reads a tone without carrying data-tone: ${part.trim()}`);
        // Style by tone, never by a runtime state name (Kanban columns, badges and cards all go through tone.ts).
        for (const part of selector.replace(/\[data-tone(?:="[^"]*")?\]/g, "").split(",")) if (STATE_SELECTOR.test(part)) problems.push(`selector names a runtime state: ${part.trim()}`);
        if (file.startsWith("screens/") && selector.split(",").some((part) => (part.match(/>/g) ?? []).length > 3)) problems.push(`scope by a unique class with at most three child steps: ${selector}`);
      }
      problems.push(...motionProblems(css));
      for (const prelude of css.matchAll(/@media\s+([^{]+)\{/g)) {
        for (const part of prelude[1].split(/\band\b|,/).map((item) => item.trim()).filter(Boolean)) if (!MEDIA.includes(part)) problems.push(`unapproved media query ${part}`);
      }
      expect(problems, `\n${problems.join("\n")}`).toEqual([]);
    });
  }

  test("Tailwind's theme only references tokens: no preflight, no palette, no literal", () => {
    const css = read(TAILWIND);
    expect(css).toMatch(/@import "tailwindcss\/utilities\.css"/);
    expect(css).not.toMatch(/tailwindcss(?:\/(?:index|preflight|theme)\.css)?"/);
    const theme = css.match(/@theme inline reference\s*\{([^}]*)\}/);
    expect(theme, "@theme inline reference block").not.toBeNull();
    const values = declarations(theme![1]);
    expect(values.length).toBeGreaterThan(0);
    for (const [name, value] of values) expect(value, name).toMatch(/^var\(--[\w-]+\)$/);
  });

  test("every var() reference resolves to a defined custom property", () => {
    const all = sheets.map(read).join("\n");
    const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    const missing = [...new Set([...all.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]))].filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });
});



// Theme structure, Ledger exactness, legacy aliases, contrast and decoration bans are in ledger-tokens.test.ts.
describe("token sheets", () => {
  const MOTION = "design/tokens-motion.css";
  const RM = "(prefers-reduced-motion: reduce)";
  for (const file of TOKEN_SHEETS) {
    test(`${file} holds only :root custom properties under approved media`, () => {
      const css = read(file);
      const { inside, preludes, outside } = media(css);
      expect(rules(outside).filter(({ selector }) => !ALLOWED_SELECTORS.includes(selector)).map(({ selector }) => selector)).toEqual([]);
      for (const [name] of [...declarations(outside), ...inside.flatMap(declarations)]) expect(name.startsWith("--") || (file === TOKENS && name === "color-scheme"), `${file}: ${name}`).toBe(true);
      for (const prelude of preludes) for (const part of prelude.split(/\band\b|,/).map((item) => item.trim()).filter(Boolean)) expect(MEDIA, `${file}: ${part}`).toContain(part);
      // The :not(...) selector appears only inside the dark media block.
      preludes.forEach((prelude, index) => {
        for (const { selector } of rules(inside[index])) expect(selector === DARK_MEDIA_SELECTOR ? prelude === DARK_MEDIA : selector === ":root", `${file}: ${selector} in ${prelude}`).toBe(true);
      });
    });
  }
  for (const [file, set] of [[TOKENS, colourThemes], ["design/tokens-depth.css", depthThemes]] as const) {
    test(`${file}: light and dark define the same names, dark is one set of values, and :root redefines no themed name`, () => {
      expect(set.light.size).toBeGreaterThan(file === TOKENS ? 40 : 2);
      expect([...set.light.keys()].sort()).toEqual([...set.darkAttribute.keys()].sort());
      expect([...set.darkAttribute]).toEqual([...set.darkMedia]);
      expect([...set.plain.keys()].filter((name) => set.light.has(name))).toEqual([]);
    });
  }
  test("color-scheme is light, dark and dark", () => {
    expect([colourThemes.light.get("color-scheme"), colourThemes.darkAttribute.get("color-scheme"), colourThemes.darkMedia.get("color-scheme")]).toEqual(["light", "dark", "dark"]);
  });
  test("every duration token is zeroed under reduced motion, derived from the token sheets", () => {
    const durations = new Set<string>();
    const reduced = new Map<string, string>();
    for (const file of TOKEN_SHEETS) {
      const { inside, preludes, outside } = media(read(file));
      for (const [name] of declarations(outside)) if (name.startsWith("--duration-")) durations.add(name);
      preludes.forEach((prelude, index) => { if (prelude === RM) for (const [name, value] of declarations(inside[index])) reduced.set(name, value); });
    }
    expect(durations.size).toBeGreaterThanOrEqual(12);
    expect([...durations].filter((name) => !/^0m?s$/.test(reduced.get(name) ?? ""))).toEqual([]);
    for (const name of ["--lift-y", "--reveal-offset", "--toast-offset"]) expect(reduced.get(name), name).toBe("0px");
    for (const name of ["--press-scale", "--enter-scale", "--pulse-scale"]) expect(reduced.get(name), name).toBe("1");
    expect(MOTION).toBe("design/tokens-motion.css");
  });
});


// Screen structure (templates, components, file size) is enforced in components.test.ts.

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
