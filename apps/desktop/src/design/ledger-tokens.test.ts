import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { TONES } from "./tone";
import { declarations, gradientProblems, leftRuleSelectors, rules } from "./lint";
import { MANIFEST, TOKEN_SHEETS, colourThemes, dark, depthThemes, light, media, read, scalePlain, sheets, toMap } from "./sheet-fixtures";

// ---- Exactness against the vendored Ledger tokens.json (ADR 0033) ----
interface Named { name: string; value: string }
interface Themed { name: string; value: { light: string; dark: string } }
interface TypeStyle { name: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string }
const ledger = JSON.parse(readFileSync(new URL("../../../../docs/design-reference/ledger/tokens/tokens.json", import.meta.url), "utf8")) as {
  color: { tokens: Themed[] };
  shadow: { tokens: Themed[] };
  spacing: { tokens: Named[] };
  radius: { tokens: Named[] };
  zIndex: { tokens: Named[] };
  size: { tokens: Named[] };
  type: { families: { sans: string; mono: string }; groups: Array<{ styles: TypeStyle[] }> };
};
const same = (actual: string | undefined, expected: string) => (actual ?? "").toLowerCase() === expected.toLowerCase();

describe("Ledger exactness", () => {
  test("the vendored tokens are present and complete", () => {
    expect(ledger.color.tokens.length).toBeGreaterThan(40);
    expect(ledger.shadow.tokens).toHaveLength(3);
  });
  test.each(ledger.color.tokens.map((token) => [token.name, token] as const))("--%s equals tokens.json in both themes", (name, token) => {
    expect(same(colourThemes.light.get(`--${name}`), token.value.light), `light ${token.value.light}`).toBe(true);
    expect(same(colourThemes.darkAttribute.get(`--${name}`), token.value.dark), `dark ${token.value.dark}`).toBe(true);
    expect(same(colourThemes.darkMedia.get(`--${name}`), token.value.dark), `dark media ${token.value.dark}`).toBe(true);
  });
  test.each(ledger.shadow.tokens.map((token) => [token.name, token] as const))("--%s equals tokens.json in both themes", (name, token) => {
    expect(same(depthThemes.light.get(`--${name}`), token.value.light)).toBe(true);
    expect(same(depthThemes.darkAttribute.get(`--${name}`), token.value.dark)).toBe(true);
    expect(same(depthThemes.darkMedia.get(`--${name}`), token.value.dark)).toBe(true);
  });
  test("spacing, radius, z-index and size tokens match by name", () => {
    const depth = depthThemes.plain;
    const missing: string[] = [];
    for (const { name, value } of ledger.spacing.tokens) if (scalePlain.get(`--${name}`) !== value) missing.push(`--${name}: ${value}`);
    for (const { name, value } of ledger.size.tokens) if (scalePlain.get(`--${name}`) !== value) missing.push(`--${name}: ${value}`);
    for (const { name, value } of ledger.radius.tokens) if (depth.get(`--${name}`) !== value) missing.push(`--${name}: ${value}`);
    for (const { name, value } of ledger.zIndex.tokens) if (depth.get(`--${name}`) !== value) missing.push(`--${name}: ${value}`);
    expect(missing).toEqual([]);
    expect(ledger.spacing.tokens.length + ledger.size.tokens.length + ledger.radius.tokens.length + ledger.zIndex.tokens.length).toBe(8 + 10 + 5 + 5);
  });
  test("font families and type styles match", () => {
    expect(scalePlain.get("--font-sans")).toBe(ledger.type.families.sans);
    expect(scalePlain.get("--font-mono")).toBe(ledger.type.families.mono);
    expect(scalePlain.get("--font-display")).toBe("var(--font-sans)");
    const styles = ledger.type.groups.flatMap((group) => group.styles);
    expect(styles).toHaveLength(10);
    const wrong: string[] = [];
    for (const style of styles) {
      if (scalePlain.get(`--text-${style.name}`) !== style.fontSize) wrong.push(`--text-${style.name}`);
      if (scalePlain.get(`--leading-${style.name}`) !== style.lineHeight) wrong.push(`--leading-${style.name}`);
      if (scalePlain.get(`--weight-${style.name}`) !== String(style.fontWeight)) wrong.push(`--weight-${style.name}`);
      if (style.letterSpacing && scalePlain.get(`--tracking-${style.name}`) !== style.letterSpacing) wrong.push(`--tracking-${style.name}`);
    }
    expect(wrong).toEqual([]);
  });
  test("dark cards and buttons are flat: depth comes from surface steps", () => {
    for (const set of [depthThemes.darkAttribute, depthThemes.darkMedia]) {
      expect(set.get("--shadow-card")).toBe("none");
      expect(set.get("--shadow-button")).toBe("none");
    }
  });
  test("no token sheet defines a gradient, aurora or glow name", () => {
    for (const file of TOKEN_SHEETS) expect([...read(file).matchAll(/(--[\w-]*(?:gradient|aurora|glow)[\w-]*)\s*:/g)].map((match) => match[1]), file).toEqual([]);
  });
});

// ---- Legacy aliases ----
const COLOUR_ROWS: Array<[string[], string]> = [
  [["color-bg", "color-sidebar"], "surface"],
  [["color-surface", "color-control"], "surface-raised"],
  [["color-surface-raised", "color-control-hover", "color-field-disabled"], "fill"],
  [["color-surface-sunken"], "surface-muted"],
  [["color-field"], "field"],
  [["color-selected", "color-accent-tint", "color-selection"], "accent-soft"],
  [["color-selected-border", "color-accent"], "accent"],
  [["color-accent-hover", "color-accent-active"], "accent-hover"],
  [["color-on-accent"], "ink-on-accent"],
  [["color-focus"], "focus-ring"],
  [["color-border"], "separator"],
  [["color-border-strong", "color-scrollbar"], "border"],
  [["color-border-control"], "border-strong"],
  [["color-text"], "ink-body"],
  [["color-text-heading"], "ink"],
  [["color-text-muted", "color-text-subtle"], "ink-muted"],
  [["color-text-disabled"], "ink-disabled"],
  [["color-scrim"], "scrim"],
];
const TONE_ROWS: Record<string, [string, string, string]> = {
  success: ["success", "success-soft", "success"],
  active: ["info", "info-soft", "info"],
  danger: ["danger", "danger-soft", "danger"],
  attention: ["warning", "warning-soft", "warning"],
  neutral: ["ink-body", "fill-strong", "ink-muted"],
  // Interrupted shares the neutral family (ADR 0033); its pause-bar mark and runtime text keep it distinct.
  interrupted: ["ink-body", "fill-strong", "ink-muted"],
};
const LEGACY: Record<string, string> = {
  ...Object.fromEntries(COLOUR_ROWS.flatMap(([olds, to]) => olds.map((old) => [`--${old}`, `var(--${to})`]))),
  ...Object.fromEntries(Object.entries(TONE_ROWS).flatMap(([tone, [fg, bg, mark]]) => [[`--tone-${tone}-fg`, `var(--${fg})`], [`--tone-${tone}-bg`, `var(--${bg})`], [`--tone-${tone}-border`, `var(--${bg})`], [`--tone-${tone}-mark`, `var(--${mark})`]])),
};
const legacySheet = "design/tokens-legacy.css";
const legacyOuter = media(read(legacySheet)).outside;
const legacy = toMap(rules(legacyOuter).find(({ selector }) => selector === ":root")!.body);

describe("legacy aliases", () => {
  test("every alias is var(--defined-in-another-token-sheet), except the one flat kbd shadow", () => {
    const defined = new Set(TOKEN_SHEETS.filter((file) => file !== legacySheet).flatMap((file) => [...read(file).matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])));
    const bad: string[] = [];
    for (const [name, value] of legacy) {
      const target = value.match(/^var\((--[\w-]+)\)$/)?.[1];
      if (value === "none") {
        if (name !== "--shadow-kbd") bad.push(`${name}: none`);
      } else if (!target || !defined.has(target)) bad.push(`${name}: ${value}`);
      if (defined.has(name)) bad.push(`${name} is also defined outside the legacy sheet`);
    }
    expect(bad).toEqual([]);
    for (const { inside } of [media(read(legacySheet))]) for (const body of inside) for (const [name, value] of declarations(body)) expect(value, name).toBe("var(--border-strong)");
  });
  test("the colour and tone map is pinned (a semantic change needs an edit here and an ADR note)", () => {
    const colourAndTone = Object.fromEntries([...legacy].filter(([name]) => /^--(?:color|tone)-/.test(name)));
    expect(colourAndTone).toEqual(LEGACY);
  });
  test("the type, shape and size aliases follow the table", () => {
    expect(Object.fromEntries([...legacy].filter(([name]) => !/^--(?:color|tone)-/.test(name)))).toMatchObject({
      "--radius-chip": "var(--radius-sm)", "--radius-input": "var(--radius-md)", "--radius-button": "var(--radius-md)", "--radius-card": "var(--radius-lg)", "--radius-menu": "var(--radius-lg)", "--radius-dialog": "var(--radius-xl)", "--radius-pill": "var(--radius-full)",
      "--shadow-panel": "var(--shadow-card)", "--shadow-dialog": "var(--shadow-popover)", "--shadow-overlay": "var(--shadow-popover)", "--shadow-button-hover": "var(--shadow-button)", "--shadow-kbd": "none",
      "--control-height": "var(--control-md)", "--control-height-sm": "var(--control-sm)", "--content-max": "var(--content-max-width)",
      "--text-display": "var(--text-page-title)", "--text-h1": "var(--text-page-title)", "--text-title": "var(--text-page-title)", "--text-h2": "var(--text-section-title)", "--text-h3": "var(--text-body-strong)", "--text-xl": "var(--text-metric-lg)",
      "--text-lg": "var(--text-body)", "--text-md": "var(--text-body)", "--text-small": "var(--text-label)", "--text-sm": "var(--text-label)", "--text-xs": "var(--text-caption)", "--text-2xs": "var(--text-caption)",
      "--leading-small": "var(--leading-label)", "--tracking-h2": "var(--tracking-none)", "--tracking-label": "var(--tracking-none)", "--weight-strong": "var(--weight-semibold)",
    });
  });
});

// ---- WCAG 2.x contrast of every semantic pair, in both themes ----
function luminance(colour: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(colour.slice(index, index + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(one: string, two: string): number {
  const [high, low] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
const GROUNDS = ["surface", "surface-muted", "surface-raised", "surface-overlay", "field"];
const STATUS = ["success", "danger", "warning", "info"];
const against = (fgs: string[], bgs: string[], minimum: number): Array<[string, string, number]> => fgs.flatMap((fg) => bgs.map((bg): [string, string, number] => [fg, bg, minimum]));
const PAIRS: Array<[string, string, number]> = [
  ...against(["ink", "ink-body"], [...GROUNDS, "fill", "fill-strong", "accent-soft", "control-selected"], 4.5),
  ...against(["ink-body"], STATUS.map((name) => `${name}-soft`), 4.5),
  ...against(["ink-muted"], [...GROUNDS, "fill", "accent-soft"], 4.5),
  // Subdued text sits on surfaces only (Ledger).
  ...against(["ink-subdued"], ["surface", "surface-muted", "surface-raised"], 4.5),
  // Links never sit on fill (Ledger); the exclusion is asserted below.
  ...against(["accent-text"], [...GROUNDS, "accent-soft"], 4.5),
  ...STATUS.flatMap((name) => against([name], [`${name}-soft`, "surface", "surface-muted", "surface-raised"], 4.5)),
  ...against(["ink-on-accent"], ["accent", "accent-hover"], 4.5),
  ["ink-on-danger", "danger", 4.5],
  ...against(["ink-on-toast", "toast-action"], ["toast"], 4.5),
  ["ink-on-banner", "banner", 4.5],
  // ::selection paints --ink on accent-soft.
  ["ink", "accent-soft", 4.5],
  ...against(["border-strong", "focus-ring"], GROUNDS, 3),
  ...against(["accent"], ["surface", "surface-muted", "surface-raised"], 3),
];

describe("colour tokens", () => {
  test("both themes define the same colour roles, every one a #rrggbb value", () => {
    expect(dark.size).toBeGreaterThan(35);
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
  });
  for (const [scheme, map] of [["dark", dark], ["light", light]] as const) {
    test.each(PAIRS)(`${scheme}: --%s on --%s meets %s:1`, (fg, bg, minimum) => {
      const one = map.get(`--${fg}`);
      const two = map.get(`--${bg}`);
      expect(one, `--${fg}`).toBeDefined();
      expect(two, `--${bg}`).toBeDefined();
      expect(contrast(one!, two!)).toBeGreaterThanOrEqual(minimum);
    });
    test(`${scheme}: each tone resolves through the legacy sheet and stays readable`, () => {
      const problems: string[] = [];
      const resolve = (name: string) => map.get(LEGACY[name].slice(4, -1));
      for (const tone of TONES) {
        const fg = resolve(`--tone-${tone}-fg`)!;
        const bg = resolve(`--tone-${tone}-bg`)!;
        const mark = resolve(`--tone-${tone}-mark`)!;
        for (const [label, ground] of [["bg", bg], ["surface", map.get("--surface")!], ["surface-raised", map.get("--surface-raised")!]] as const) if (contrast(fg, ground) < 4.5) problems.push(`${tone} fg on ${label}`);
        for (const [label, ground] of [["bg", bg], ["surface", map.get("--surface")!], ["surface-raised", map.get("--surface-raised")!], ["surface-muted", map.get("--surface-muted")!]] as const) if (contrast(mark, ground) < 3) problems.push(`${tone} mark on ${label}`);
      }
      expect(problems).toEqual([]);
    });
  }
  test("documented exclusion: dark accent-text on fill is below 4.5 because links never sit on fill (Ledger)", () => {
    const ratio = contrast(dark.get("--accent-text")!, dark.get("--fill")!);
    expect(ratio).toBeLessThan(4.5);
    expect(ratio).toBeCloseTo(4.18, 1);
  });
});

// ---- Banned decoration (ADR 0033) ----
// Coloured left rules are banned outright: the list of tolerated selectors is empty (L2 emptied the component sheets, L4 the screen sheets), so any new one fails.
const LEFT_RULE_PENDING: string[] = [];

describe("decoration bans", () => {
  test("no stylesheet holds a gradient", () => {
    expect(sheets.flatMap((sheet) => gradientProblems(read(sheet)).map((problem) => `${sheet}: ${problem}`))).toEqual([]);
  });
  test("coloured left rules are limited to the pending list", () => {
    const found = sheets.filter((sheet) => !TOKEN_SHEETS.includes(sheet) && sheet !== MANIFEST).flatMap((sheet) => leftRuleSelectors(read(sheet)).map((selector) => `${sheet}: ${selector}`));
    expect(found.filter((entry) => !LEFT_RULE_PENDING.includes(entry)), `new left rules:\n${found.join("\n")}`).toEqual([]);
    expect(LEFT_RULE_PENDING.filter((entry) => !found.includes(entry)), "stale pending entries").toEqual([]);
  });
});

// Screen structure (templates, components, file size) is enforced in components.test.ts.
