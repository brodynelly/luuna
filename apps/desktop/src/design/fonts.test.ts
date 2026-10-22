import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Read with node:fs: Vitest's `?raw` CSS import returns "" (see design-system.test.ts).
const cssUrl = new URL("./fonts.css", import.meta.url);
const css = readFileSync(cssUrl, "utf8");
const fontDir = new URL("../assets/fonts/soehne/", import.meta.url);
const NAMES: Record<string, number> = { leicht: 300, buch: 400, kraftig: 500, halbfett: 600, dreiviertelfett: 700 };
const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]).filter((body) => body.includes('font-family: "Söhne";'));
const prop = (body: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";

describe("Söhne font declarations", () => {
  test("ten faces cover every weight in upright and italic exactly once", () => {
    expect(blocks).toHaveLength(10);
    const pairs = blocks.map((body) => `${prop(body, "font-weight")}/${prop(body, "font-style")}`).sort();
    const expected = [300, 400, 500, 600, 700].flatMap((weight) => ["normal", "italic"].map((style) => `${weight}/${style}`)).sort();
    expect(pairs).toEqual(expected);
  });
  test("each face swaps, is woff2 and points at a real wOF2 file that matches its weight and style", () => {
    const referenced: string[] = [];
    for (const body of blocks) {
      expect(prop(body, "font-display")).toBe("swap");
      const src = /src:\s*url\("([^"]+)"\)\s*format\("woff2"\)/.exec(body)?.[1];
      expect(src, body).toBeDefined();
      expect(src!.startsWith("../")).toBe(true);
      const bytes = readFileSync(new URL(src!, cssUrl), "latin1");
      expect(bytes.slice(0, 4)).toBe("wOF2");
      expect(bytes.length).toBeGreaterThan(4096);
      const name = /soehne-([a-z]+)(-kursiv)?\.woff2$/.exec(src!);
      expect(name, src).not.toBeNull();
      expect(NAMES[name![1]]).toBe(Number(prop(body, "font-weight")));
      expect(name![2] ? "italic" : "normal").toBe(prop(body, "font-style"));
      referenced.push(src!.split("/").pop()!);
    }
    const onDisk = readdirSync(fontDir, { recursive: true }).filter((file) => file.endsWith(".woff2")).sort();
    expect(referenced.sort()).toEqual(onDisk);
  });
  test("the opt-in Söhne override (data-font=soehne, non-Apple) sets sans and display to Söhne and leaves mono alone", () => {
    const body = /:root\[data-platform="other"\]\[data-font="soehne"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(prop(body, "--font-sans").startsWith('"Söhne"')).toBe(true);
    expect(prop(body, "--font-display").startsWith('"Söhne"')).toBe(true);
    expect(body).not.toContain("--font-mono");
  });
  test("main.tsx applies the platform before the first render", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    expect(main.indexOf("applyPlatform(")).toBeGreaterThan(-1);
    expect(main.indexOf("applyPlatform(")).toBeLessThan(main.indexOf("createRoot("));
  });
});
