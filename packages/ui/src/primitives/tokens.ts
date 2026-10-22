// DOM-free prop vocabulary of the layout primitives (ADR 0034 family 5). Props are names on the token scale,
// never numbers of pixels: a value outside these unions is a type error, and each name maps to one existing
// custom property. primitives.css holds the matching rule for every entry (tokens.test.ts checks both ways).

/** Space steps, in the order of tokens-scale.css: `"0.5"` is --space-0-5, `0` is no space. */
export const GAPS = [0, "0.5", 1, "1.5", 2, "2.5", 3, 4, 5, 6, 8, 12] as const;
export type Gap = (typeof GAPS)[number];
/** Whole steps are numbers (`2`); fractional steps are strings (`"1.5"`). `1.5` as a number is a type error. */
export type GapNumber = Extract<Gap, number>;
export type GapString = Extract<Gap, string>;

/** The space token a step reads, or undefined for `0`. */
export function spaceToken(gap: Gap): string | undefined {
  return gap === 0 ? undefined : `--space-${String(gap).replace(".", "-")}`;
}

export const COLUMNS = [1, 2, 3, 4, 5, 6] as const;
export type Columns = (typeof COLUMNS)[number];
/** The two breakpoints the library has (tokens-scale.css): compact is 920 px and below, narrow is 680 px and below. */
export const BREAKPOINTS = { compact: "(max-width: 920px)", narrow: "(max-width: 680px)" } as const;
export type Breakpoint = keyof typeof BREAKPOINTS;
export type ResponsiveColumns = { base: Columns } & { [name in Breakpoint]?: Columns };

export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackJustify = "start" | "center" | "end" | "between";
export type ContainerSize = "content" | "measure" | "narrow";
export type MinItem = "field" | "hint";
export type ScrollHeight = "plan" | "scroll" | "list";
export type TitleSize = "page" | "section" | "subsection" | "label";

/** Which token each named size reads; primitives.css must read the same one. */
export const CONTAINER_TOKEN: Record<ContainerSize, string> = { content: "--content-max-width", measure: "--measure", narrow: "--connect-width" };
export const MIN_ITEM_TOKEN: Record<MinItem, string> = { field: "--field-min", hint: "--hint-min" };
export const SCROLL_TOKEN: Record<ScrollHeight, string> = { plan: "--plan-max", scroll: "--scroll-max", list: "--palette-list-max" };
export const TITLE_STYLE: Record<TitleSize, string> = { page: "page-title", section: "section-title", subsection: "body-strong", label: "label" };

/** Joins class names, skipping empty ones. */
export function cx(...names: Array<string | false | null | undefined>): string | undefined {
  return names.filter(Boolean).join(" ") || undefined;
}

/** Attribute form of a responsive column count: a bare number holds at every width. */
export function columnAttributes(cols: Columns | ResponsiveColumns): Record<string, number> {
  if (typeof cols === "number") return { "data-cols": cols };
  const result: Record<string, number> = { "data-cols": cols.base };
  for (const name of Object.keys(BREAKPOINTS) as Breakpoint[]) {
    const value = cols[name];
    if (value !== undefined) result[`data-cols-${name}`] = value;
  }
  return result;
}
