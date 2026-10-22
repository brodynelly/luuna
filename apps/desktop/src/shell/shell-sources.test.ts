import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("source contracts", () => {
  test("App passes the outage to a Banner and keeps no Callout or pill", () => {
    const app = source("../App.tsx");
    expect(app).toMatch(/<Banner label=\{OUTAGE_LABEL\} className="outage" title=\{`[^`]*`\}>/);
    expect(app).not.toMatch(/<Callout[^>]*outage/);
    expect(app).not.toContain("nav-pill");
  });
  test("the shell sheet has the off-canvas breakpoint and none of the earlier decorative pieces", () => {
    const css = source("../screens/shell.css");
    expect(css).toContain("@media (max-width: 768px)");
    for (const gone of ["nav-pill", "data-pill", "live-pulse", "aurora", "gradient", "header-reveal", "920px"]) expect(css, gone).not.toContain(gone);
  });
});
