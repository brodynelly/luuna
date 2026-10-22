import { readdirSync, readFileSync } from "node:fs";
import { declarations, rules, splitAtRules } from "./lint";

// Shared by the stylesheet tests. Stylesheets are read with node:fs: Vitest replaces `*.css?raw` imports with "",
// which would let every check pass without reading anything. Each file read must be non-empty.
// Two roots (ADR 0034): the library (packages/ui/src, keys prefixed "ui/") and the desktop app (apps/desktop/src, keys
// unprefixed, e.g. "styles.css", "screens/app.css", "Home.tsx"). Every scan covers both with the same rules.
export const UI_ROOT = new URL("../", import.meta.url);
export const DESKTOP_ROOT = new URL("../../../../apps/desktop/src/", import.meta.url);
const locate = (file: string) => (file.startsWith("ui/") ? new URL(file.slice(3), UI_ROOT) : new URL(file, DESKTOP_ROOT));
export const raw = (file: string) => readFileSync(locate(file), "utf8");
export const read = (file: string) => raw(file).replace(/\/\*[\s\S]*?\*\//g, "");
const list = (root: URL) => readdirSync(root, { recursive: true }).map((file) => file.replaceAll("\\", "/"));
export const files = [...list(UI_ROOT).map((file) => "ui/" + file), ...list(DESKTOP_ROOT)].sort();
export const sheets = files.filter((file) => file.endsWith(".css"));
export const TOKENS = "ui/styles/tokens.css";
export const TOKEN_SHEETS = [TOKENS, "ui/styles/tokens-depth.css", "ui/styles/tokens-scale.css", "ui/styles/tokens-motion.css", "ui/styles/tokens-legacy.css"];
export const MANIFEST = "styles.css";

// Theme structure (ADR 0033): light by default, dark from data-theme or the OS.
export const media = (css: string) => splitAtRules(css, "media");
export const LIGHT_SELECTOR = ':root, :root[data-theme="light"]';
export const DARK_ATTRIBUTE = ':root[data-theme="dark"]';
export const DARK_MEDIA_SELECTOR = ':root:not([data-theme="light"])';
export const DARK_MEDIA = "(prefers-color-scheme: dark)";
export const ALLOWED_SELECTORS = [":root", LIGHT_SELECTOR, DARK_ATTRIBUTE];
export const toMap = (body: string) => new Map(declarations(`${body};`));
export interface Themes { plain: Map<string, string>; light: Map<string, string>; darkAttribute: Map<string, string>; darkMedia: Map<string, string> }
export function themes(file: string): Themes {
  const { inside, preludes, outside } = media(read(file));
  const outer = rules(outside);
  const body = (selector: string) => {
    const found = outer.filter((rule) => rule.selector === selector);
    if (found.length !== 1) throw new Error(`${file}: expected one ${selector} block, found ${found.length}`);
    return toMap(found[0].body);
  };
  const index = preludes.indexOf(DARK_MEDIA);
  if (index < 0) throw new Error(`${file}: no ${DARK_MEDIA} block`);
  const inner = rules(inside[index]);
  if (inner.length !== 1 || inner[0].selector !== DARK_MEDIA_SELECTOR) throw new Error(`${file}: the dark media block must hold only ${DARK_MEDIA_SELECTOR}`);
  return { plain: body(":root"), light: body(LIGHT_SELECTOR), darkAttribute: body(DARK_ATTRIBUTE), darkMedia: toMap(inner[0].body) };
}
export const colourThemes = themes(TOKENS);
export const depthThemes = themes("ui/styles/tokens-depth.css");
export const scalePlain = toMap(rules(media(read("ui/styles/tokens-scale.css")).outside).find(({ selector }) => selector === ":root")!.body);
const hexOnly = (map: Map<string, string>) => new Map([...map].filter(([name, value]) => /^--/.test(name) && /^#[0-9a-f]{6}$/i.test(value)));
export const light = hexOnly(colourThemes.light);
export const dark = hexOnly(colourThemes.darkAttribute);
