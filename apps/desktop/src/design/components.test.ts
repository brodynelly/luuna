import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// The structure the template, the smokes and the accessibility audit depend on (ADR 0030):
// every view renders through the component library in src/ui, every file stays small enough to
// read in one sitting, and no view hand-builds a control, a heading, a form or a container.
const root = new URL("../", import.meta.url);
const files = readdirSync(root, { recursive: true }).map((file) => file.replaceAll("\\", "/")).sort();
const source = (file: string) => readFileSync(new URL(file, root), "utf8");
const MAX_LINES = 300;
const LIBRARY = (file: string) => file.startsWith("ui/") || file.startsWith("design/");
const components = files.filter((file) => file.endsWith(".tsx") && !file.includes(".test."));
const views = components.filter((file) => !LIBRARY(file) && file !== "main.tsx");
// Raw elements that only the library renders: controls, headings, forms, disclosures, landmark
// and container sections, blocks, paragraphs, hints, identities, lists, links, machine-output
// regions, definition lists and alerts. Views keep only inline text semantics (span, strong, time).
const RAW = /<(button|input|textarea|select|option|label|form|fieldset|details|summary|section|aside|nav|main|pre|dl|div|p|small|code|ul|ol|li|a|table|h[1-6])\b|role="alert"|className="(?:panel|error|callout|record|empty|actions|facts)\b/;

describe("components and templates", () => {
  test(`every front-end file is at most ${MAX_LINES} lines`, () => {
    const long = files.filter((file) => /\.(tsx?|css)$/.test(file)).map((file) => [file, source(file).split("\n").length] as const).filter(([, lines]) => lines > MAX_LINES);
    expect(long).toEqual([]);
  });

  test("there are views to check and a library to compose them from", () => {
    expect(views.length).toBeGreaterThan(8);
    expect(components.filter(LIBRARY).length).toBeGreaterThan(4);
  });

  for (const file of views) {
    test(`${file} composes library components only`, () => {
      const found = source(file).split("\n").map((line, index) => [index + 1, line.match(RAW)?.[0]] as const).filter(([, match]) => match).map(([line, match]) => `${file}:${line} ${match}`);
      expect(found).toEqual([]);
    });
  }

  test("every view page renders through the Page template", () => {
    const pages = ["Home.tsx", "Board.tsx", "projects/Projects.tsx", "sessions/Sessions.tsx", "Settings.tsx", "Help.tsx"];
    for (const file of pages) expect(source(file), file).toMatch(/<Page\b/);
  });

  for (const file of components) {
    test(`${file}: no inline styles, no positive tabIndex, badges through StatusBadge`, () => {
      const text = source(file);
      expect(text).not.toMatch(/style=\{\{/);
      expect(text).not.toMatch(/tabIndex=\{[1-9]/);
      if (file !== "design/StatusBadge.tsx") expect(text).not.toMatch(/className=\{?["'`]state\b/);
    });
  }

  test("every alert carries a Dismiss button", () => {
    for (const file of components) {
      const text = source(file);
      for (const match of text.matchAll(/role="alert"/g)) expect(text.slice(match.index, text.indexOf("</div>", match.index)), file).toContain(">Dismiss</button>");
    }
  });

  test("headings come from the library alone, so the outline is the same on every view", () => {
    const headings = components.filter((file) => /<h[1-6]\b/.test(source(file)));
    expect(headings.every((file) => file.startsWith("ui/")), headings.join(", ")).toBe(true);
  });
});
