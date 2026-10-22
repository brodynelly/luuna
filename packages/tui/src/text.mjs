// Width-aware text helpers for the interactive screens. A terminal line that is longer than the
// pane wraps and pushes the header and the help footer out of view, so every rendered row is
// either truncated to the width (menus, headers) or wrapped to it (text screens, nothing lost).
// SGR colour sequences (the tones of format.mjs) are zero width and survive both operations;
// a cut row always closes the colour it opened so nothing bleeds into the next row.

const SGR = /\u001b\[[0-9;]*m/g;
const RESET = "\u001b[0m";
export const ELLIPSIS = "…";

/** The text without SGR colour sequences. */
export function stripAnsi(text) {
  return String(text).replace(SGR, "");
}

/** Terminal columns one code point takes: 0 for a control or combining mark, 2 for an East Asian wide character, 1 otherwise. */
export function charWidth(codePoint) {
  if (codePoint === 0 || (codePoint < 32) || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if ((codePoint >= 0x0300 && codePoint <= 0x036f) || (codePoint >= 0x200b && codePoint <= 0x200f) || codePoint === 0xfe0f || (codePoint >= 0xfe20 && codePoint <= 0xfe2f)) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0x2e80 && codePoint <= 0x303e) || (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || (codePoint >= 0x4e00 && codePoint <= 0x9fff) || (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0xf900 && codePoint <= 0xfaff) || (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) || (codePoint >= 0xffe0 && codePoint <= 0xffe6) || (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) return 2;
  return 1;
}

/** Splits a line into SGR tokens (zero width, kept) and character tokens with their width. */
function tokens(text) {
  const out = [];
  let index = 0;
  const line = String(text);
  while (index < line.length) {
    if (line[index] === "\u001b") {
      const match = /^\u001b\[[0-9;]*m/.exec(line.slice(index));
      if (match) { out.push({ sgr: match[0] }); index += match[0].length; continue; }
    }
    const codePoint = line.codePointAt(index);
    const char = String.fromCodePoint(codePoint);
    out.push({ char, width: charWidth(codePoint) });
    index += char.length;
  }
  return out;
}

/** Columns the text occupies on a terminal: SGR sequences count nothing, wide characters two. */
export function visibleWidth(text) {
  return tokens(text).reduce((sum, token) => sum + (token.width ?? 0), 0);
}

/** The SGR sequences still open at the end of `list`: everything since the last reset. */
function openSgr(list) {
  const open = [];
  for (const token of list) {
    if (!token.sgr) continue;
    if (token.sgr === RESET || token.sgr === "\u001b[m") open.length = 0;
    else open.push(token.sgr);
  }
  return open;
}

const join = (list) => list.map((token) => token.sgr ?? token.char).join("");

/** The text cut to `width` columns with an ellipsis; a text that fits is returned unchanged. */
export function truncate(text, width) {
  if (width <= 0) return "";
  const list = tokens(text);
  const total = list.reduce((sum, token) => sum + (token.width ?? 0), 0);
  if (total <= width) return join(list);
  if (width === 1) return ELLIPSIS;
  const kept = [];
  let used = 0;
  for (const token of list) {
    if (token.sgr) { kept.push(token); continue; }
    if (used + token.width > width - 1) break;
    kept.push(token);
    used += token.width;
  }
  return `${join(kept)}${ELLIPSIS}${openSgr(kept).length ? RESET : ""}`;
}

/**
 * Wraps one line to rows of at most `width` columns, breaking at the last space that fits and
 * inside a word only when the word alone is wider than the row. Colour that is open at a row end
 * is closed there and reopened on the next row. An empty line stays one empty row.
 */
export function wrap(text, width) {
  if (width <= 0) return [String(text)];
  const rows = [];
  let current = [];
  let used = 0;
  let lastSpace = -1;
  let carried = [];
  const flush = (list) => {
    const open = openSgr([...carried, ...list]);
    rows.push(`${join(carried)}${join(list)}${open.length ? RESET : ""}`);
    carried = open.map((sgr) => ({ sgr }));
  };
  for (const token of tokens(text)) {
    if (token.sgr) { current.push(token); continue; }
    if (used + token.width > width) {
      if (token.char === " ") { flush(current); current = []; used = 0; lastSpace = -1; continue; }
      if (lastSpace > 0) {
        const head = current.slice(0, lastSpace);
        const tail = current.slice(lastSpace + 1);
        flush(head);
        current = tail;
        used = tail.reduce((sum, item) => sum + (item.width ?? 0), 0);
      } else {
        flush(current);
        current = [];
        used = 0;
      }
      lastSpace = -1;
    }
    if (token.char === " ") lastSpace = current.length;
    current.push(token);
    used += token.width;
  }
  flush(current);
  return rows;
}

/** Every line of `text` wrapped to `width`, in order, as terminal rows. */
export function wrapLines(text, width) {
  return String(text).split("\n").flatMap((line) => wrap(line, width));
}

/** The first of several footer variants (longest first) that fits `width`, else the last one truncated. */
export function pickFit(variants, width) {
  for (const variant of variants) if (visibleWidth(variant) <= width) return variant;
  return truncate(variants.at(-1), width);
}
