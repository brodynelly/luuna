import { describe, expect, test } from "vitest";
import { read } from "../design/sheet-fixtures";
import { BREAKPOINTS, COLUMNS, CONTAINER_TOKEN, GAPS, MIN_ITEM_TOKEN, SCROLL_TOKEN, TITLE_STYLE, columnAttributes, cx, spaceToken } from "./tokens";
import type { Gap, GapNumber, GapString } from "./tokens";

const css = read("ui/primitives/primitives.css");
const scale = read("ui/styles/tokens-scale.css");
const defined = (token: string) => new RegExp(`${token}\s*:`).test(scale);

describe("gap scale", () => {
  test("every step maps to a defined --space token, and 0 to none", () => {
    expect(spaceToken(0)).toBeUndefined();
    expect(spaceToken(4)).toBe("--space-4");
    expect(spaceToken("1.5")).toBe("--space-1-5");
    for (const gap of GAPS.filter((step) => step !== 0)) expect(defined(spaceToken(gap)!), String(gap)).toBe(true);
  });

  test("gap, padding and spacer size each have one rule per step reading that token", () => {
    for (const gap of GAPS) {
      const value = gap === 0 ? "0" : `var(${spaceToken(gap)})`;
      expect(css, `gap ${gap}`).toContain(`.prim-gap[data-gap="${gap}"] { --prim-gap: ${value}; }`);
      expect(css, `pad ${gap}`).toContain(`.prim-pad[data-pad="${gap}"] { --prim-pad: ${value}; }`);
      expect(css, `size ${gap}`).toContain(`.prim-spacer[data-size="${gap}"] { --prim-size: ${value}; }`);
    }
  });

  test("an unsupported step is a type error", () => {
    // @ts-expect-error 7 is not on the scale
    const bad: Gap = 7;
    // @ts-expect-error free lengths are not steps
    const length: Gap = "10px";
    expect([bad, length]).toHaveLength(2);
  });
});

describe("named sizes", () => {
  test("containers, minimum items and scroll heights read defined tokens in the sheet", () => {
    for (const [name, token] of Object.entries(CONTAINER_TOKEN)) {
      expect(defined(token), token).toBe(true);
      expect(css).toContain(`.prim-container[data-size="${name}"] { --prim-max: var(${token}); }`);
    }
    for (const [name, token] of Object.entries(MIN_ITEM_TOKEN)) {
      expect(defined(token), token).toBe(true);
      expect(css).toContain(`.prim-simple-grid[data-min="${name}"] { --prim-min: var(${token}); }`);
    }
    for (const [name, token] of Object.entries(SCROLL_TOKEN)) {
      expect(defined(token), token).toBe(true);
      expect(css).toContain(`.prim-scroll[data-max="${name}"] { --prim-max: var(${token}); }`);
    }
  });

  test("title sizes read the Ledger type styles", () => {
    for (const [name, style] of Object.entries(TITLE_STYLE)) {
      expect(defined(`--text-${style}`), style).toBe(true);
      expect(css).toContain(`.prim-title[data-size="${name}"] { font-size: var(--text-${style});`);
    }
  });
});

describe("columns and breakpoints", () => {
  test("the two breakpoints are the media queries the library already has", () => {
    expect(BREAKPOINTS).toEqual({ compact: "(max-width: 920px)", narrow: "(max-width: 680px)" });
    for (const query of Object.values(BREAKPOINTS)) expect(css).toContain(`@media ${query}`);
  });

  test("every column count has a rule at base and at each breakpoint", () => {
    for (const count of COLUMNS) {
      expect(css).toContain(`.prim-grid[data-cols="${count}"] { --prim-cols: ${count}; }`);
      for (const name of Object.keys(BREAKPOINTS)) expect(css).toContain(`.prim-grid[data-cols-${name}="${count}"] { --prim-cols: ${count}; }`);
    }
  });

  test("columnAttributes writes the base and any breakpoint", () => {
    expect(columnAttributes(3)).toEqual({ "data-cols": 3 });
    expect(columnAttributes({ base: 4, compact: 2, narrow: 1 })).toEqual({ "data-cols": 4, "data-cols-compact": 2, "data-cols-narrow": 1 });
    expect(columnAttributes({ base: 4, narrow: 1 })).toEqual({ "data-cols": 4, "data-cols-narrow": 1 });
  });

  test("a column count outside 1 to 6 or an unknown breakpoint is a type error", () => {
    // @ts-expect-error 7 columns
    columnAttributes(7);
    // @ts-expect-error there is no wide breakpoint
    columnAttributes({ base: 2, wide: 3 });
  });
});

test("cx joins names and drops empty ones", () => {
  expect(cx("a", false, undefined, null, "", "b")).toBe("a b");
  expect(cx(false, undefined)).toBeUndefined();
});

describe("gap contract", () => {
  test("whole steps are numbers and fractional steps are strings", () => {
    expect(GAPS.filter((step) => typeof step === "string")).toEqual(["0.5", "1.5", "2.5"]);
    const whole: GapNumber = 2;
    const half: GapString = "1.5";
    // @ts-expect-error a fractional step is a string
    const number: Gap = 1.5;
    // @ts-expect-error a whole step is not a string
    const text: GapString = "2";
    expect([whole, half, number, text]).toHaveLength(4);
  });
});
