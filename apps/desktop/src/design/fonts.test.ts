import { readdirSync, readFileSync } from "node:fs";
import type { Bytes } from "node:fs";
import { describe, expect, test } from "vitest";

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
