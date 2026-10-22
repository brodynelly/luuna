import { describe, expect, test } from "vitest";
import { TONES } from "../tone/tone";
import { declarations, gradientProblems, leftRuleSelectors, rules } from "./lint";
import { BREAKPOINTS, DEVIATIONS, DERIVED, DISPLAY_FAMILY, FONT_SIZES, FONT_STACK, FONT_WEIGHTS, HEADINGS, HEADING_WEIGHT, LINE_HEIGHTS, MONO_STACK, PALETTES, PALETTE_NAMES, RADIUS, ROLES, SHADOWS, SPACING, resolve } from "./mantine-values";
import { MANIFEST, TOKEN_SHEETS, colourThemes, dark, depthThemes, light, media, read, scalePlain, sheets, toMap } from "./sheet-fixtures";

// ---- Exactness against the Mantine default theme (ADR 0035; the values are in mantine-values.ts) ----
// Follows a var(--other) alias to its literal within one map.
function literal(map: Map<string, string>, name: string): string {
  let value = map.get(name);
  for (let hops = 0; value !== undefined && /^var\(--[\w-]+\)$/.test(value) && hops < 5; hops++) value = map.get(value.slice(4, -1));
  if (value === undefined) throw new Error(`${name} is not defined`);
  return value;
}
const squash = (value: string) => value.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
const plain = colourThemes.plain;

describe("Mantine exactness: palettes", () => {
  test("the 14 palettes hold 10 shades each", () => {
    expect(PALETTE_NAMES).toHaveLength(14);
    for (const name of PALETTE_NAMES) expect(PALETTES[name], name).toHaveLength(10);
  });
  test.each(PALETTE_NAMES.flatMap((name) => PALETTES[name].map((value, shade) => [name, shade, value] as const)))("--color-%s-%i equals %s", (name, shade, value) => {
    expect(plain.get(`--color-${name}-${shade}`)).toBe(value.toLowerCase());
  });
});

describe("Mantine exactness: colour roles", () => {
  test("every colour role is in the truth table and the table lists no role the sheet lacks", () => {
    expect([...light.keys()].sort()).toEqual(ROLES.map((role) => `--${role.token}`).sort());
  });
  test.each(ROLES.map((role) => [role.token, role] as const))("--%s equals the table in light, dark and the dark media block", (token, role) => {
    expect(light.get(`--${token}`), "light").toBe(resolve(role.light.used));
    expect(dark.get(`--${token}`), "dark").toBe(resolve(role.dark.used));
    expect(colourThemes.darkMedia.get(`--${token}`), "dark media").toBe(resolve(role.dark.used));
  });
  test("a role uses the Mantine value unless a deviation row explains it, and every row matches a role", () => {
    const differing = ROLES.flatMap((role) => (["light", "dark"] as const).filter((scheme) => role[scheme].mantine !== undefined && resolve(role[scheme].mantine!) !== resolve(role[scheme].used)).map((scheme) => `${scheme}:${role.token}`)).sort();
    expect(DEVIATIONS.map((row) => `${row.scheme}:${row.token}`).sort()).toEqual(differing);
  });
  test("every literal that is not a palette shade, white or black is a documented derivation", () => {
    const shades = new Set(PALETTE_NAMES.flatMap((name) => PALETTES[name].map((value) => value.toLowerCase())));
    const unknown = ROLES.flatMap((role) => [role.light.used, role.dark.used]).filter((ref) => ref.startsWith("#") && !shades.has(ref) && !["#ffffff", "#000000"].includes(ref));
    expect([...new Set(unknown)].sort()).toEqual(Object.keys(DERIVED).sort());
  });
  test("the derived dark tints are the shade-8 colour at 15% over the dark body, and the light warning is orange-9 at 92%", () => {
    const channel = (colour: string, index: number) => parseInt(colour.slice(index, index + 2), 16);
    const hex = (values: number[]) => "#" + values.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("");
    const body = resolve("dark.7");
    for (const [family, tint] of [["blue", "#22303c"], ["teal", "#20352e"], ["red", "#402626"], ["orange", "#412c20"]] as const) {
      const fg = resolve(`${family}.8`);
      expect(hex([1, 3, 5].map((index) => channel(fg, index) * 0.15 + channel(body, index) * 0.85)), family).toBe(tint);
    }
    expect(hex([1, 3, 5].map((index) => channel(resolve("orange.9"), index) * 0.92))).toBe("#c8420e");
  });
  test("semantic roles resolve to the Mantine light and dark schemes", () => {
    const get = (token: string, scheme: "light" | "dark") => resolve(ROLES.find((role) => role.token === token)![scheme].used);
    expect([get("surface", "light"), get("ink-body", "light"), get("border", "light"), get("ink-disabled", "light"), get("focus-ring", "light")]).toEqual(["#ffffff", "#000000", "#ced4da", "#adb5bd", "#228be6"]);
    expect([get("surface", "dark"), get("ink-body", "dark"), get("field", "dark"), get("border", "dark"), get("ink-disabled", "dark"), get("accent", "dark"), get("accent-text", "dark")]).toEqual(["#242424", "#c9c9c9", "#2e2e2e", "#424242", "#696969", "#1971c2", "#4dabf7"]);
  });
});

describe("Mantine exactness: scale", () => {
  test("font stacks: Mantine's body and monospace stacks, Outfit for display", () => {
    expect(scalePlain.get("--font-stack")).toBe(FONT_STACK);
    expect(literal(scalePlain, "--font-sans")).toBe(FONT_STACK);
    expect(scalePlain.get("--font-mono")).toBe(MONO_STACK);
    expect(scalePlain.get("--font-display")).toBe(`"${DISPLAY_FAMILY}", var(--font-stack)`);
    expect(scalePlain.get("--font-sans")).toBe("var(--font-stack)");
  });
  test("font sizes, line heights, weights", () => {
    for (const [key, value] of Object.entries(FONT_SIZES)) expect(scalePlain.get(`--font-size-${key}`), key).toBe(value);
    for (const [key, value] of Object.entries(LINE_HEIGHTS)) expect(scalePlain.get(`--line-height-${key}`), key).toBe(value);
    for (const [key, value] of Object.entries(FONT_WEIGHTS)) expect(scalePlain.get(`--font-weight-${key}`), key).toBe(value);
    expect(scalePlain.get("--font-weight-heading")).toBe(HEADING_WEIGHT);
  });
  test("headings h1 to h6", () => {
    for (const { level, size, lineHeight } of HEADINGS) {
      expect(scalePlain.get(`--heading-${level}-size`), `h${level}`).toBe(size);
      expect(scalePlain.get(`--heading-${level}-line-height`), `h${level}`).toBe(lineHeight);
    }
  });
  test("spacing and breakpoints", () => {
    for (const [key, value] of Object.entries(SPACING)) expect(scalePlain.get(`--spacing-${key}`), key).toBe(value);
    for (const [key, value] of Object.entries(BREAKPOINTS)) expect(scalePlain.get(`--breakpoint-${key}`), key).toBe(value);
  });
  test("radius xs 2, sm 4, md 8, lg 16, xl 32 px", () => {
    for (const [key, value] of Object.entries(RADIUS)) expect(depthThemes.plain.get(`--radius-${key}`), key).toBe(value);
  });
  test("shadows xs to xl are Mantine's exact strings", () => {
    for (const [key, value] of Object.entries(SHADOWS)) expect(squash(depthThemes.plain.get(`--shadow-${key}`)!), key).toBe(squash(value));
  });
  test("dark cards and buttons are flat; popovers use shadow-md in both schemes", () => {
    for (const set of [depthThemes.darkAttribute, depthThemes.darkMedia]) {
      expect(set.get("--shadow-card")).toBe("none");
      expect(set.get("--shadow-button")).toBe("none");
    }
    for (const set of [depthThemes.light, depthThemes.darkAttribute, depthThemes.darkMedia]) expect(set.get("--shadow-popover")).toBe("var(--shadow-md)");
  });
  test("Luuna type roles map onto the Mantine scale (page title = h2, metric-lg = h3, section title = h4)", () => {
    const role = (name: string) => [literal(scalePlain, `--text-${name}`), literal(scalePlain, `--leading-${name}`), literal(scalePlain, `--weight-${name}`)];
    expect(role("page-title")).toEqual(["1.625rem", "1.35", "600"]);
    expect(role("metric-lg")).toEqual(["1.375rem", "1.4", "600"]);
    expect(role("section-title")).toEqual(["1.125rem", "1.45", "600"]);
    expect(role("metric")).toEqual(["1.25rem", "1.4", "600"]);
    expect(role("body-strong")).toEqual(["1rem", "1.55", "600"]);
    expect(role("body")).toEqual(["1rem", "1.55", "400"]);
    expect(role("label")).toEqual(["0.875rem", "1.45", "600"]);
    expect(role("caption")).toEqual(["0.75rem", "1.4", "400"]);
    expect(role("overline")).toEqual(["0.75rem", "1.4", "600"]);
    expect(role("mono")).toEqual(["0.875rem", "1.55", "400"]);
    expect(["--weight-regular", "--weight-medium", "--weight-semibold", "--weight-bold"].map((name) => literal(scalePlain, name))).toEqual(["400", "600", "600", "700"]);
  });
  test("Mantine has no tracking: titles and body track 0", () => {
    for (const name of ["--tracking-page-title", "--tracking-title", "--tracking-tight", "--tracking-none"]) expect(literal(scalePlain, name), name).toBe("0em");
  });
  test("the Luuna 4px rhythm and half steps are unchanged", () => {
    const space = Object.fromEntries([...scalePlain].filter(([name]) => name.startsWith("--space-")));
    expect(space).toEqual({ "--space-0-5": "2px", "--space-1": "4px", "--space-1-5": "6px", "--space-2": "8px", "--space-2-5": "10px", "--space-3": "12px", "--space-4": "16px", "--space-5": "20px", "--space-6": "24px", "--space-8": "32px", "--space-12": "48px" });
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
  [["color-accent"], "accent"],
  [["color-focus"], "focus-ring"],
  [["color-border"], "separator"],
  [["color-border-strong", "color-scrollbar"], "border"],
  [["color-border-control"], "border-strong"],
  [["color-text"], "ink-body"],
  [["color-text-heading"], "ink"],
  [["color-text-muted", "color-text-subtle"], "ink-muted"],
  [["color-text-disabled"], "ink-disabled"],
];
const TONE_ROWS: Record<string, [string, string, string]> = {
  // Tone mapping to Mantine palettes (ADR 0035): success teal, active blue, danger red, attention orange, neutral gray.
  success: ["success", "success-soft", "success"],
  active: ["info", "info-soft", "info"],
  danger: ["danger", "danger-soft", "danger"],
  attention: ["warning", "warning-soft", "warning"],
  neutral: ["ink-body", "fill-strong", "ink-muted"],
  // Interrupted shares the neutral family (ADR 0033, kept); its pause-bar mark and runtime text keep it distinct.
  interrupted: ["ink-body", "fill-strong", "ink-muted"],
};
const LEGACY: Record<string, string> = {
  ...Object.fromEntries(COLOUR_ROWS.flatMap(([olds, to]) => olds.map((old) => [`--${old}`, `var(--${to})`]))),
  ...Object.fromEntries(Object.entries(TONE_ROWS).flatMap(([tone, [fg, bg, mark]]) => [[`--tone-${tone}-fg`, `var(--${fg})`], [`--tone-${tone}-bg`, `var(--${bg})`], [`--tone-${tone}-border`, `var(--${bg})`], [`--tone-${tone}-mark`, `var(--${mark})`]])),
};
const legacySheet = "ui/styles/tokens-legacy.css";
const legacyOuter = media(read(legacySheet)).outside;
const legacy = toMap(rules(legacyOuter).find(({ selector }) => selector === ":root")!.body);

describe("legacy aliases", () => {
  test("every alias is var(--defined-in-another-token-sheet)", () => {
    const defined = new Set(TOKEN_SHEETS.filter((file) => file !== legacySheet).flatMap((file) => [...read(file).matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])));
    const bad: string[] = [];
    for (const [name, value] of legacy) {
      const target = value.match(/^var\((--[\w-]+)\)$/)?.[1];
      if (!target || !defined.has(target)) bad.push(`${name}: ${value}`);
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
      "--radius-chip": "var(--radius-sm)", "--radius-input": "var(--radius-md)", "--radius-button": "var(--radius-md)", "--radius-card": "var(--radius-md)", "--radius-pill": "var(--radius-full)",
      "--shadow-button-hover": "var(--shadow-button)",
      "--control-height": "var(--control-md)", "--control-height-sm": "var(--control-sm)", "--content-max": "var(--content-max-width)",
      "--text-display": "var(--text-page-title)", "--text-h1": "var(--text-page-title)", "--text-title": "var(--text-page-title)", "--text-h2": "var(--text-section-title)", "--text-h3": "var(--text-body-strong)", "--text-xl": "var(--text-metric-lg)",
      "--text-lg": "var(--font-size-lg)", "--text-md": "var(--text-body)", "--text-small": "var(--text-label)", "--text-sm": "var(--text-label)", "--text-xs": "var(--text-caption)", "--text-2xs": "var(--text-caption)",
      "--leading-small": "var(--leading-label)", "--tracking-h2": "var(--tracking-none)", "--tracking-label": "var(--tracking-none)", "--weight-strong": "var(--weight-semibold)",
    });
  });
});

// ---- WCAG 2.x contrast of every semantic pair, in both themes (not weakened by ADR 0035) ----
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
  // Subdued text sits on surfaces only.
  ...against(["ink-subdued"], ["surface", "surface-muted", "surface-raised"], 4.5),
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
      const resolveTone = (name: string) => map.get(LEGACY[name].slice(4, -1));
      for (const tone of TONES) {
        const fg = resolveTone(`--tone-${tone}-fg`)!;
        const bg = resolveTone(`--tone-${tone}-bg`)!;
        const mark = resolveTone(`--tone-${tone}-mark`)!;
        for (const [label, ground] of [["bg", bg], ["surface", map.get("--surface")!], ["surface-raised", map.get("--surface-raised")!]] as const) if (contrast(fg, ground) < 4.5) problems.push(`${tone} fg on ${label}`);
        for (const [label, ground] of [["bg", bg], ["surface", map.get("--surface")!], ["surface-raised", map.get("--surface-raised")!], ["surface-muted", map.get("--surface-muted")!]] as const) if (contrast(mark, ground) < 3) problems.push(`${tone} mark on ${label}`);
      }
      expect(problems).toEqual([]);
    });
  }
});

describe("contrast deviations from Mantine (ADR 0035)", () => {
  test.each(DEVIATIONS.map((row) => [`${row.scheme} --${row.token}`, row] as const))("%s: the Mantine value fails and the value used passes, at the recorded ratios", (_label, row) => {
    const values = new Map<string, string>(ROLES.map((role) => [role.token, resolve(role[row.scheme].used)]));
    const used = contrast(values.get(row.pair[0])!, values.get(row.pair[1])!);
    values.set(row.token, resolve(ROLES.find((role) => role.token === row.token)![row.scheme].mantine!));
    const mantine = contrast(values.get(row.pair[0])!, values.get(row.pair[1])!);
    expect(Number(mantine.toFixed(2)), "Mantine ratio").toBe(row.mantine);
    expect(Number(used.toFixed(2)), "used ratio").toBe(row.used);
    expect(mantine, "Mantine value must fail the gate").toBeLessThan(row.min);
    expect(used, "used value must pass the gate").toBeGreaterThanOrEqual(row.min);
    expect(row.reason.length).toBeGreaterThan(20);
  });
});

// ---- Banned decoration (ADR 0033, kept) ----
// Coloured left rules are banned outright: the list of tolerated selectors is empty, so any new one fails.
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
