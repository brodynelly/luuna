import { readdirSync, readFileSync } from "node:fs";
import type { Bytes } from "node:fs";
import { describe, expect, test } from "vitest";
import { declarations, rules } from "./lint";
import { read, sheets, toMap } from "./sheet-fixtures";

// Read with node:fs: Vitest's `?raw` CSS import returns "" (see design-system.test.ts).
const cssUrl = new URL("./fonts.css", import.meta.url);
const css = readFileSync(cssUrl, "utf8");
const fontDir = new URL("../assets/fonts/soehne/", import.meta.url);
const NAMES: Record<string, number> = { leicht: 300, buch: 400, kraftig: 500, halbfett: 600, dreiviertelfett: 700 };
const EXPECTED_FILES = Object.keys(NAMES).flatMap((name) => [`Soehne-${name}.ttf`, `Soehne-${name}-kursiv.ttf`]).sort();
const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]).filter((body) => body.includes('font-family: "Söhne";'));
const prop = (body: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";

// Reads the sfnt table directory: the files are untrusted binary data, so nothing is executed.
function tables(bytes: Bytes): Set<string> {
  const count = bytes.readUInt16BE(4);
  const found = new Set<string>();
  for (let index = 0; index < count; index++) found.add(bytes.toString("latin1", 12 + index * 16, 16 + index * 16));
  return found;
}

describe("Söhne font declarations", () => {
  test("ten faces cover every weight in upright and italic exactly once", () => {
    expect(blocks).toHaveLength(10);
    const pairs = blocks.map((body) => `${prop(body, "font-weight")}/${prop(body, "font-style")}`).sort();
    const expected = [300, 400, 500, 600, 700].flatMap((weight) => ["normal", "italic"].map((style) => `${weight}/${style}`)).sort();
    expect(pairs).toEqual(expected);
  });
  test("each face swaps, is truetype and points at a real TTF that matches its weight and style", () => {
    const referenced: string[] = [];
    for (const body of blocks) {
      expect(prop(body, "font-display")).toBe("swap");
      const src = /src:\s*url\("([^"]+)"\)\s*format\("truetype"\)/.exec(body)?.[1];
      expect(src, body).toBeDefined();
      expect(src!.startsWith("../assets/fonts/soehne/")).toBe(true);
      const bytes = readFileSync(new URL(src!, cssUrl));
      expect(bytes.readUInt32BE(0)).toBe(0x00010000);
      expect(bytes.length).toBeGreaterThan(90 * 1024);
      expect(bytes.length).toBeLessThan(110 * 1024);
      const name = /Soehne-([a-z]+)(-kursiv)?\.ttf$/.exec(src!);
      expect(name, src).not.toBeNull();
      expect(NAMES[name![1]]).toBe(Number(prop(body, "font-weight")));
      expect(name![2] ? "italic" : "normal").toBe(prop(body, "font-style"));
      referenced.push(src!.split("/").pop()!);
    }
    expect(referenced.sort()).toEqual(EXPECTED_FILES);
  });
  test("the directory holds only the ten expected files: no trial, Mono or duplicate files", () => {
    const onDisk = readdirSync(fontDir, { recursive: true }).map(String).sort();
    expect(onDisk).toEqual(EXPECTED_FILES);
    expect(onDisk.filter((file) => /^test|mono|\.otf$|^sohne-buch/i.test(file))).toEqual([]);
  });
  test("every bundled TTF keeps its hinting tables (fpgm, prep, cvt), so a swap to unhinted files fails", () => {
    for (const file of EXPECTED_FILES) {
      const found = tables(readFileSync(new URL(file, fontDir)));
      for (const table of ["fpgm", "prep", "cvt "]) expect(found.has(table), `${file} lacks ${table}`).toBe(true);
    }
  });
  test("the other-platform override puts Söhne first for sans and display and leaves mono alone", () => {
    const body = /:root\[data-platform="other"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(prop(body, "--font-sans").startsWith('"Söhne"')).toBe(true);
    expect(prop(body, "--font-display").startsWith('"Söhne"')).toBe(true);
    expect(prop(body, "--font-sans")).toContain('"Segoe UI"');
    expect(body).not.toContain("--font-mono");
  });
  test("main.tsx applies the platform before the first render", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    expect(main.indexOf("applyPlatform(")).toBeGreaterThan(-1);
    expect(main.indexOf("applyPlatform(")).toBeLessThan(main.indexOf("createRoot("));
  });
  test("the CSP keeps font-src 'self' and the build never inlines fonts", () => {
    const tauri = readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8");
    expect(tauri).toContain("font-src 'self';");
    const vite = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    expect(vite).toMatch(/assetsInlineLimit[^\n]*\\\.ttf\$\//);
    expect(vite).not.toContain("woff2");
  });
});

// Typography amendment (ADR 0033): the measured Söhne remap, behind one switch.
const SWITCH = ':root[data-platform="other"]:not([data-type="ledger"])';
const WEIGHTS = ["--weight-regular", "--weight-medium", "--weight-semibold", "--weight-bold", "--weight-strong"];
const stripped = read("design/fonts.css");
const fontRules = rules(stripped).filter(({ selector }) => selector !== "@font-face");
const override = toMap(fontRules.find(({ selector }) => selector === SWITCH)?.body ?? "");
const features = fontRules.filter(({ selector }) => selector.startsWith(SWITCH + " "));
// Reads GSUB's FeatureList tags: untrusted binary, nothing executed.
function gsubFeatures(bytes: Bytes): Set<string> {
  const count = bytes.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    if (bytes.toString("latin1", 12 + index * 16, 16 + index * 16) !== "GSUB") continue;
    const gsub = bytes.readUInt32BE(12 + index * 16 + 8);
    const list = gsub + bytes.readUInt16BE(gsub + 6);
    const tags = new Set<string>();
    for (let feature = 0; feature < bytes.readUInt16BE(list); feature++) tags.add(bytes.toString("latin1", list + 2 + feature * 6, list + 6 + feature * 6));
    return tags;
  }
  return new Set();
}

describe("Söhne typography override", () => {
  test("every bundled face carries ss01 and tnum before ss01 is enabled", () => {
    for (const file of EXPECTED_FILES) {
      const found = gsubFeatures(readFileSync(new URL(file, fontDir)));
      expect(found.has("ss01"), `${file} lacks ss01`).toBe(true);
      expect(found.has("tnum"), `${file} lacks tnum`).toBe(true);
    }
    expect(features.some(({ body }) => /font-feature-settings:\s*"ss01" on/.test(body))).toBe(true);
  });
  test("the weight tokens map to 300, 400, 500, 500, 500", () => {
    expect(WEIGHTS.map((name) => override.get(name))).toEqual(["300", "400", "500", "500", "500"]);
  });
  test("role weights follow the generic weights, never a literal", () => {
    for (const [name, value] of override) if (/^--weight-(?!regular|medium|semibold|bold|strong)/.test(name)) expect(value, name).toMatch(/^var\(--weight-(?:regular|medium|semibold|bold)\)$/);
  });
  test("the block touches only weight and tracking tokens, and only ss01 or normal features elsewhere", () => {
    for (const name of override.keys()) expect(name, name).toMatch(/^--(?:weight|tracking)-/);
    expect(override.get("--tracking-page-title")).toBe("var(--tracking-title)");
    expect(override.get("--tracking-h2")).toBe("calc(var(--tracking-title) / 2)");
    for (const { body } of features) for (const [name, value] of declarations(`${body};`)) {
      expect(name).toBe("font-feature-settings");
      expect(value).toMatch(/^(?:"ss01" on|normal)$/);
    }
  });
  test("monospace is excluded: every font-mono rule is reset to normal features, and --font-mono is untouched", () => {
    const reset = features.find(({ body }) => /font-feature-settings:\s*normal/.test(body))?.selector ?? "";
    for (const part of ["code", "kbd", "samp", "pre"]) expect(reset).toMatch(new RegExp(`[(,\\s]${part}[,)]`));
    for (const sheet of sheets.filter((name) => !name.startsWith("design/tokens") && name !== "design/fonts.css" && name !== "styles.css")) {
      for (const { selector, body } of rules(read(sheet))) {
        if (!/font-family:\s*var\(--font-mono\)/.test(body)) continue;
        for (const part of selector.split(",").map((item) => item.trim())) if (!/^(?:code|kbd|samp|pre)$/.test(part)) expect(reset, `${sheet}: ${part}`).toContain(part);
      }
    }
    expect(css).not.toMatch(/--font-mono\s*:/);
  });
  test("Apple and the fallback are untouched: every override rule needs data-platform=other, and the switch reverts it", () => {
    const after = fontRules.filter(({ selector }) => !selector.startsWith(":root[data-platform=\"other\"]"));
    expect(after).toEqual([]);
    for (const { selector } of fontRules) if (selector !== ':root[data-platform="other"]') expect(selector.startsWith(SWITCH)).toBe(true);
  });
  test("sizes are untouched: no font-size or line-height in fonts.css", () => {
    expect(stripped).not.toMatch(/font-size|line-height|--text-|--leading-/);
  });
  test("the Ledger weight and tracking token values in tokens-scale.css stay exact", () => {
    const scale = toMap(rules(read("design/tokens-scale.css")).find(({ selector }) => selector === ":root")!.body);
    const wanted: Record<string, string> = { "--weight-regular": "400", "--weight-medium": "500", "--weight-semibold": "600", "--weight-bold": "700", "--weight-page-title": "700", "--weight-body": "400", "--tracking-page-title": "-0.01em", "--tracking-title": "-0.02em" };
    for (const [name, value] of Object.entries(wanted)) expect(scale.get(name), name).toBe(value);
  });
});
