import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { DISPLAY_FAMILY, FONT_STACK, MONO_STACK, UNICODE_RANGE } from "./mantine-values";
import { DESKTOP_ROOT, raw, scalePlain, sheets } from "./sheet-fixtures";

// Read with node:fs: Vitest's `?raw` CSS import returns "" (see design-system.test.ts).
const cssUrl = new URL("../styles/fonts.css", import.meta.url);
const css = readFileSync(cssUrl, "utf8");
const fontDir = new URL("../assets/fonts/outfit/", import.meta.url);
const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]);
const prop = (body: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";
const FACES: Array<[string, keyof typeof UNICODE_RANGE]> = [["Outfit-latin.woff2", "latin"], ["Outfit-latin-ext.woff2", "latinExt"]];

describe("Outfit font declarations (ADR 0035)", () => {
  test("exactly two faces, both Outfit, variable 100 to 900, normal, swap, woff2", () => {
    expect(blocks).toHaveLength(2);
    for (const body of blocks) {
      expect(prop(body, "font-family")).toBe(`"${DISPLAY_FAMILY}"`);
      expect(prop(body, "font-weight")).toBe("100 900");
      expect(prop(body, "font-style")).toBe("normal");
      expect(prop(body, "font-display")).toBe("swap");
      expect(prop(body, "src")).toMatch(/^url\("\.\.\/assets\/fonts\/outfit\/Outfit-[a-z-]+\.woff2"\) format\("woff2"\)$/);
    }
  });
  test("each face points at a real woff2 (magic wOF2) and carries the Mantine unicode-range", () => {
    const referenced: string[] = [];
    for (const body of blocks) {
      const src = /url\("([^"]+)"\)/.exec(prop(body, "src"))![1];
      const file = src.split("/").pop()!;
      const face = FACES.find(([name]) => name === file);
      expect(face, file).toBeDefined();
      expect(prop(body, "unicode-range")).toBe(UNICODE_RANGE[face![1]]);
      const bytes = readFileSync(new URL(src, cssUrl));
      expect(bytes.toString("latin1", 0, 4)).toBe("wOF2");
      expect(bytes.length).toBeGreaterThan(5 * 1024);
      referenced.push(file);
    }
    expect(referenced.sort()).toEqual(FACES.map(([name]) => name).sort());
  });
  test("the directory holds the two woff2 files and the OFL license, nothing else", () => {
    expect(readdirSync(fontDir).map(String).sort()).toEqual(["OFL.txt", "Outfit-latin-ext.woff2", "Outfit-latin.woff2"]);
    const license = readFileSync(new URL("OFL.txt", fontDir), "utf8");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
  test("no remote font URL, no data: URI, no other @font-face, and Söhne is not referenced from any stylesheet", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/https?:|\/\/[a-z]|data:/i);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "").match(/@font-face/g)).toHaveLength(2);
    for (const sheet of sheets) {
      const text = raw(sheet);
      expect(text, sheet).not.toMatch(/s[öo]hne|data-platform|data-type/i);
      expect(text, sheet).not.toMatch(/@import\s+url\(|url\(\s*["']?https?:/i);
    }
    expect(sheets.length).toBeGreaterThan(10);
  });
  test("every url() in the stylesheets is a bundled Outfit file", () => {
    for (const sheet of sheets) {
      const text = raw(sheet);
      for (const match of text.matchAll(/url\(\s*["']?([^"')]+)/g)) expect(match[1], sheet).toMatch(/^\.\.\/assets\/fonts\/outfit\/Outfit-(?:latin|latin-ext)\.woff2$/);
    }
  });
  test("the stacks: Mantine's system stack for body and UI, Outfit then that stack for display, Mantine monospace", () => {
    expect(scalePlain.get("--font-sans")).toBe("var(--font-stack)");
    expect(scalePlain.get("--font-stack")).toBe(FONT_STACK);
    expect(scalePlain.get("--font-display")).toBe('"Outfit", var(--font-stack)');
    expect(scalePlain.get("--font-mono")).toBe(MONO_STACK);
  });
  test("fonts.css holds no custom property, no size and no platform override", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/--[\w-]+\s*:|font-size|line-height|:root/);
  });
  test("the CSP keeps font-src 'self' and the build never inlines .ttf or .woff2", () => {
    const tauri = readFileSync(new URL("../src-tauri/tauri.conf.json", DESKTOP_ROOT), "utf8");
    expect(tauri).toContain("font-src 'self';");
    const vite = readFileSync(new URL("../vite.config.ts", DESKTOP_ROOT), "utf8");
    expect(vite).toMatch(/assetsInlineLimit[^\n]*\\\.\(\?:ttf\|woff2\)\$\//);
  });
  test("the license notice lists Outfit and marks Söhne as no longer bundled", () => {
    const notices = readFileSync(new URL("../../../../THIRD-PARTY-NOTICES.md", import.meta.url), "utf8");
    expect(notices).toMatch(/Outfit[\s\S]*SIL Open Font License/i);
    expect(notices).toMatch(/Söhne[\s\S]*no longer (?:bundled|referenced)/i);
  });
});

describe("headings and body use the right face", () => {
  const base = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
  test("body is the system stack at the Mantine base size and 1.55 line height, antialiased", () => {
    const body = /\nbody \{([^}]*)\}/.exec(base)![1];
    expect(prop(body, "font-family")).toBe("var(--font-sans)");
    expect(prop(body, "font-size")).toBe("var(--text-body)");
    expect(prop(body, "line-height")).toBe("var(--leading-body)");
    expect(prop(body, "-webkit-font-smoothing")).toBe("antialiased");
    expect(prop(body, "-moz-osx-font-smoothing")).toBe("grayscale");
  });
  test("h1 to h4 take the display face at the semibold (600) weight", () => {
    expect(base).toMatch(/h1, h2, h3, h4 \{[^}]*font-family: var\(--font-display\)/);
    for (const level of [1, 2, 3, 4]) expect(new RegExp(`\\nh${level} \\{[^}]*font-weight: var\\(--weight-semibold\\)`).test(base), `h${level}`).toBe(true);
  });
});
