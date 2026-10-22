// The truth table for the Mantine default theme (ADR 0035), typed. Values are design tokens read from
// @mantine/core 9.7.3 as served by jsDelivr (MIT) and recorded in specs/mantine-theme-values.md; no Mantine
// source or stylesheet is vendored. mantine-tokens.test.ts compares every mapped token in the token sheets with
// this file, so a changed token fails until the table (and, for a contrast deviation, ADR 0035) is edited.
// Keep this file to erasable TypeScript so Node can run it directly (node --experimental-strip-types).

export const PALETTE_NAMES = ["dark", "gray", "red", "pink", "grape", "violet", "indigo", "blue", "cyan", "teal", "green", "lime", "yellow", "orange"] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

export const PALETTES: Record<PaletteName, readonly string[]> = {
  dark: ["#C9C9C9", "#b8b8b8", "#828282", "#696969", "#424242", "#3b3b3b", "#2e2e2e", "#242424", "#1f1f1f", "#141414"],
  gray: ["#f8f9fa", "#f1f3f5", "#e9ecef", "#dee2e6", "#ced4da", "#adb5bd", "#868e96", "#495057", "#343a40", "#212529"],
  red: ["#fff5f5", "#ffe3e3", "#ffc9c9", "#ffa8a8", "#ff8787", "#ff6b6b", "#fa5252", "#f03e3e", "#e03131", "#c92a2a"],
  pink: ["#fff0f6", "#ffdeeb", "#fcc2d7", "#faa2c1", "#f783ac", "#f06595", "#e64980", "#d6336c", "#c2255c", "#a61e4d"],
  grape: ["#f8f0fc", "#f3d9fa", "#eebefa", "#e599f7", "#da77f2", "#cc5de8", "#be4bdb", "#ae3ec9", "#9c36b5", "#862e9c"],
  violet: ["#f3f0ff", "#e5dbff", "#d0bfff", "#b197fc", "#9775fa", "#845ef7", "#7950f2", "#7048e8", "#6741d9", "#5f3dc4"],
  indigo: ["#edf2ff", "#dbe4ff", "#bac8ff", "#91a7ff", "#748ffc", "#5c7cfa", "#4c6ef5", "#4263eb", "#3b5bdb", "#364fc7"],
  blue: ["#e7f5ff", "#d0ebff", "#a5d8ff", "#74c0fc", "#4dabf7", "#339af0", "#228be6", "#1c7ed6", "#1971c2", "#1864ab"],
  cyan: ["#e3fafc", "#c5f6fa", "#99e9f2", "#66d9e8", "#3bc9db", "#22b8cf", "#15aabf", "#1098ad", "#0c8599", "#0b7285"],
  teal: ["#e6fcf5", "#c3fae8", "#96f2d7", "#63e6be", "#38d9a9", "#20c997", "#12b886", "#0ca678", "#099268", "#087f5b"],
  green: ["#ebfbee", "#d3f9d8", "#b2f2bb", "#8ce99a", "#69db7c", "#51cf66", "#40c057", "#37b24d", "#2f9e44", "#2b8a3e"],
  lime: ["#f4fce3", "#e9fac8", "#d8f5a2", "#c0eb75", "#a9e34b", "#94d82d", "#82c91e", "#74b816", "#66a80f", "#5c940d"],
  yellow: ["#fff9db", "#fff3bf", "#ffec99", "#ffe066", "#ffd43b", "#fcc419", "#fab005", "#f59f00", "#f08c00", "#e67700"],
  orange: ["#fff4e6", "#ffe8cc", "#ffd8a8", "#ffc078", "#ffa94d", "#ff922b", "#fd7e14", "#f76707", "#e8590c", "#d9480f"],
};

// A colour reference is "#rrggbb" or "<palette>.<shade>", for example "blue.8".
export function resolve(ref: string): string {
  if (ref.startsWith("#")) return ref.toLowerCase();
  const [name, shade] = ref.split(".");
  const value = PALETTES[name as PaletteName]?.[Number(shade)];
  if (value === undefined) throw new Error(`unknown colour reference ${ref}`);
  return value.toLowerCase();
}

export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';
export const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
export const DISPLAY_FAMILY = "Outfit";

export const FONT_SIZES = { xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.125rem", xl: "1.25rem" } as const;
export const LINE_HEIGHTS = { xs: "1.4", sm: "1.45", md: "1.55", lg: "1.6", xl: "1.65" } as const;
export const FONT_WEIGHTS = { regular: "400", medium: "600", bold: "700" } as const;
export const HEADINGS = [
  { level: 1, size: "2.125rem", lineHeight: "1.3" },
  { level: 2, size: "1.625rem", lineHeight: "1.35" },
  { level: 3, size: "1.375rem", lineHeight: "1.4" },
  { level: 4, size: "1.125rem", lineHeight: "1.45" },
  { level: 5, size: "1rem", lineHeight: "1.5" },
  { level: 6, size: "0.875rem", lineHeight: "1.5" },
] as const;
// Mantine's headings are weight 700; mantine.dev sets its Outfit titles at 600, which is the Luuna heading weight (ADR 0035).
export const HEADING_WEIGHT = "600";

export const RADIUS = { xs: "2px", sm: "4px", md: "8px", lg: "16px", xl: "32px" } as const;
export const SPACING = { xs: "10px", sm: "12px", md: "16px", lg: "20px", xl: "32px" } as const;
export const BREAKPOINTS = { xs: "36em", sm: "48em", md: "62em", lg: "75em", xl: "88em" } as const;
export const SHADOWS = {
  xs: "0 1px 3px rgba(0, 0, 0, .05), 0 1px 2px rgba(0, 0, 0, .1)",
  sm: "0 1px 3px rgba(0, 0, 0, .05), rgba(0, 0, 0, .05) 0 10px 15px -5px, rgba(0, 0, 0, .04) 0 7px 7px -5px",
  md: "0 1px 3px rgba(0, 0, 0, .05), rgba(0, 0, 0, .05) 0 20px 25px -5px, rgba(0, 0, 0, .04) 0 10px 10px -5px",
  lg: "0 1px 3px rgba(0, 0, 0, .05), rgba(0, 0, 0, .05) 0 28px 23px -7px, rgba(0, 0, 0, .04) 0 12px 12px -7px",
  xl: "0 1px 3px rgba(0, 0, 0, .05), rgba(0, 0, 0, .05) 0 36px 28px -7px, rgba(0, 0, 0, .04) 0 17px 17px -7px",
} as const;

export const UNICODE_RANGE = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  latinExt: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
} as const;

// ---- Colour roles ----
// token: the Luuna role name (kept from ADR 0033 so components keep working). used: the value in tokens.css.
// mantine: the value of the Mantine role it maps to, when Mantine defines one (undefined for roles Mantine has no
// counterpart for: tints, charts, banner, toast, ai). basis: the Mantine role or the palette rule behind it.
export interface Choice { used: string; mantine?: string }
export interface Role { token: string; basis: string; light: Choice; dark: Choice }
const same = (value: string): Choice => ({ used: value, mantine: value });
const pick = (used: string): Choice => ({ used });

export const ROLES: readonly Role[] = [
  { token: "surface", basis: "body", light: same("#ffffff"), dark: same("dark.7") },
  { token: "surface-raised", basis: "default (control and paper ground)", light: same("#ffffff"), dark: { used: "dark.7", mantine: "dark.6" } },
  { token: "surface-muted", basis: "palette: default-hover ground", light: pick("gray.0"), dark: pick("dark.8") },
  { token: "fill", basis: "palette", light: pick("gray.1"), dark: pick("dark.6") },
  { token: "fill-strong", basis: "palette", light: pick("gray.2"), dark: pick("dark.5") },
  { token: "control-selected", basis: "palette", light: pick("#ffffff"), dark: pick("dark.4") },
  { token: "surface-overlay", basis: "default", light: same("#ffffff"), dark: same("dark.6") },
  { token: "field", basis: "default", light: same("#ffffff"), dark: same("dark.6") },
  { token: "banner", basis: "palette", light: pick("gray.9"), dark: pick("dark.6") },
  { token: "separator", basis: "palette", light: pick("gray.3"), dark: pick("dark.5") },
  { token: "border", basis: "default-border", light: same("gray.4"), dark: same("dark.4") },
  { token: "border-strong", basis: "default-border", light: { used: "gray.6", mantine: "gray.4" }, dark: { used: "dark.2", mantine: "dark.4" } },
  { token: "ink", basis: "bright", light: same("#000000"), dark: same("#ffffff") },
  { token: "ink-body", basis: "text", light: same("#000000"), dark: same("dark.0") },
  { token: "ink-muted", basis: "dimmed", light: { used: "gray.7", mantine: "gray.6" }, dark: { used: "dark.1", mantine: "dark.2" } },
  { token: "ink-subdued", basis: "dimmed", light: { used: "gray.7", mantine: "gray.6" }, dark: { used: "dark.1", mantine: "dark.2" } },
  { token: "ink-disabled", basis: "disabled-color", light: same("gray.5"), dark: same("dark.3") },
  { token: "ink-on-banner", basis: "palette", light: pick("#ffffff"), dark: pick("dark.0") },
  { token: "accent", basis: "primary filled (blue, shade 6 light, 8 dark)", light: { used: "blue.8", mantine: "blue.6" }, dark: same("blue.8") },
  { token: "accent-hover", basis: "primary filled, hover", light: { used: "blue.9", mantine: "blue.7" }, dark: same("blue.9") },
  { token: "ink-on-accent", basis: "primary filled text (white)", light: same("#ffffff"), dark: same("#ffffff") },
  { token: "accent-text", basis: "anchor", light: { used: "blue.8", mantine: "blue.6" }, dark: same("blue.4") },
  { token: "accent-soft", basis: "palette tint (Mantine light variant: the filled colour at low alpha)", light: pick("blue.0"), dark: pick("#22303c") },
  { token: "focus-ring", basis: "focus ring (primary filled)", light: same("blue.6"), dark: { used: "blue.7", mantine: "blue.8" } },
  { token: "toast", basis: "palette", light: pick("gray.9"), dark: pick("dark.5") },
  { token: "ink-on-toast", basis: "palette", light: pick("#ffffff"), dark: pick("#ffffff") },
  { token: "toast-action", basis: "palette", light: pick("blue.2"), dark: pick("blue.3") },
  { token: "chart-1", basis: "palette (blue)", light: pick("blue.6"), dark: pick("blue.5") },
  { token: "chart-2", basis: "palette (violet)", light: pick("violet.6"), dark: pick("violet.5") },
  { token: "chart-3", basis: "palette (teal)", light: pick("teal.6"), dark: pick("teal.5") },
  { token: "chart-4", basis: "palette (orange)", light: pick("orange.6"), dark: pick("orange.5") },
  { token: "chart-5", basis: "palette (pink)", light: pick("pink.6"), dark: pick("pink.5") },
  { token: "ai", basis: "palette (violet)", light: pick("violet.7"), dark: pick("violet.4") },
  { token: "chart-muted", basis: "palette", light: pick("gray.4"), dark: pick("dark.4") },
  { token: "chart-grid", basis: "palette", light: pick("gray.2"), dark: pick("dark.5") },
  { token: "success", basis: "success (teal, shade 8)", light: { used: "teal.9", mantine: "teal.8" }, dark: { used: "teal.6", mantine: "teal.8" } },
  { token: "success-soft", basis: "palette tint", light: pick("teal.0"), dark: pick("#20352e") },
  { token: "danger", basis: "error (red, shade 6 light, 8 dark)", light: { used: "red.9", mantine: "red.6" }, dark: { used: "red.5", mantine: "red.8" } },
  { token: "ink-on-danger", basis: "filled text (white)", light: same("#ffffff"), dark: { used: "#000000", mantine: "#ffffff" } },
  { token: "danger-soft", basis: "palette tint", light: pick("red.0"), dark: pick("#402626") },
  { token: "warning", basis: "orange family (shade 6 light, 8 dark)", light: { used: "#c8420e", mantine: "orange.6" }, dark: { used: "orange.6", mantine: "orange.8" } },
  { token: "warning-soft", basis: "palette tint", light: pick("orange.0"), dark: pick("#412c20") },
  { token: "info", basis: "primary / anchor (blue)", light: { used: "blue.8", mantine: "blue.6" }, dark: same("blue.4") },
  { token: "info-soft", basis: "palette tint", light: pick("blue.0"), dark: pick("#22303c") },
];

// Dark tints that are not palette shades: the shade-8 colour of the family at 15% over the dark body (#242424),
// Mantine's light-variant alpha in the dark scheme. Rounded per channel.
export const DERIVED = {
  "#22303c": "blue.8 at 15% over dark.7",
  "#20352e": "teal.8 at 15% over dark.7",
  "#402626": "red.8 at 15% over dark.7",
  "#412c20": "orange.8 at 15% over dark.7",
  "#c8420e": "orange.9 with every channel scaled to 92% (the lightest scale that passes 4.5:1 on every attention ground)",
} as const;

// ---- Contrast deviations (ADR 0035) ----
// Each is a role whose Mantine value fails the repo gate (text 4.5:1, marks and edges 3:1) in its scheme. pair is
// [foreground token, background token]; the test recomputes both ratios (Mantine value substituted for `token`,
// every other token as used) and requires them to equal the figures here, the Mantine one below `min` and the used one at or above it.
export interface Deviation { token: string; scheme: "light" | "dark"; pair: [string, string]; min: number; mantine: number; used: number; reason: string }
export const DEVIATIONS: readonly Deviation[] = [
  { token: "ink-muted", scheme: "light", pair: ["ink-muted", "surface"], min: 4.5, mantine: 3.32, used: 8.18, reason: "dimmed (gray-6) fails text contrast on white; gray-7 is the nearest passing shade" },
  { token: "ink-subdued", scheme: "light", pair: ["ink-subdued", "surface"], min: 4.5, mantine: 3.32, used: 8.18, reason: "same dimmed role and the same fix as ink-muted" },
  { token: "border-strong", scheme: "light", pair: ["border-strong", "surface"], min: 3, mantine: 1.49, used: 3.32, reason: "default-border (gray-4) is a hairline; control edges need 3:1, gray-6 is the nearest passing shade" },
  { token: "accent", scheme: "light", pair: ["ink-on-accent", "accent"], min: 4.5, mantine: 3.56, used: 5.02, reason: "white on filled blue-6 fails; blue-8 is the nearest passing shade" },
  { token: "accent-hover", scheme: "light", pair: ["ink-on-accent", "accent-hover"], min: 4.5, mantine: 4.2, used: 6.09, reason: "white on blue-7 fails; one step darker than the used accent" },
  { token: "accent-text", scheme: "light", pair: ["accent-text", "surface"], min: 4.5, mantine: 3.56, used: 5.02, reason: "anchor blue-6 on white fails; blue-8 is the nearest passing shade" },
  { token: "info", scheme: "light", pair: ["info", "info-soft"], min: 4.5, mantine: 3.2, used: 4.52, reason: "info text on its tint with blue-6 fails; blue-8 passes" },
  { token: "success", scheme: "light", pair: ["success", "success-soft"], min: 4.5, mantine: 3.68, used: 4.67, reason: "teal-8 text on its tint fails; teal-9 is the nearest passing shade" },
  { token: "danger", scheme: "light", pair: ["danger", "danger-soft"], min: 4.5, mantine: 3.07, used: 5.1, reason: "error red-6 text on its tint fails; red-8 passes on white only, so red-9" },
  { token: "warning", scheme: "light", pair: ["warning", "warning-soft"], min: 4.5, mantine: 2.37, used: 4.56, reason: "orange-6 fails; the darkest orange shade (orange-9, 4.30:1) still fails, so orange-9 is scaled to 92%" },
  { token: "ink-muted", scheme: "dark", pair: ["ink-muted", "surface"], min: 4.5, mantine: 4.04, used: 7.83, reason: "dimmed (dark-2) fails on the dark body; dark-1 is the nearest passing shade" },
  { token: "ink-subdued", scheme: "dark", pair: ["ink-subdued", "surface"], min: 4.5, mantine: 4.04, used: 7.83, reason: "same dimmed role and the same fix as ink-muted" },
  { token: "border-strong", scheme: "dark", pair: ["border-strong", "surface"], min: 3, mantine: 1.54, used: 4.04, reason: "default-border (dark-4) is a hairline; control edges need 3:1, dark-2 is the nearest passing shade" },
  { token: "surface-raised", scheme: "dark", pair: ["accent", "surface-raised"], min: 3, mantine: 2.7, used: 3.09, reason: "paper ground dark-6 leaves filled blue-8 marks under 3:1 on cards; cards sit on the body shade dark-7 and are told apart by their border" },
  { token: "focus-ring", scheme: "dark", pair: ["focus-ring", "field"], min: 3, mantine: 2.7, used: 3.24, reason: "the blue-8 ring is under 3:1 on dark-6 fields; blue-7 is the nearest passing shade" },
  { token: "success", scheme: "dark", pair: ["success", "surface"], min: 4.5, mantine: 3.93, used: 6.08, reason: "teal-8 text on the dark body fails; teal-6 is the nearest passing shade" },
  { token: "danger", scheme: "dark", pair: ["danger", "surface"], min: 4.5, mantine: 3.44, used: 5.59, reason: "error red-8 on the dark body fails; red-5 is the nearest passing shade" },
  { token: "ink-on-danger", scheme: "dark", pair: ["ink-on-danger", "danger"], min: 4.5, mantine: 2.78, used: 7.57, reason: "white on the lighter dark-scheme danger fails; black passes" },
  { token: "warning", scheme: "dark", pair: ["warning", "surface"], min: 4.5, mantine: 4.34, used: 6.04, reason: "orange-8 text on the dark body fails; orange-6 is the nearest passing shade" },
];
