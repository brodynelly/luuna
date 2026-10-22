// Width-aware rendering helpers of the interactive workbench: truncation and wrapping that keep
// every row inside the terminal width, count SGR colour as zero width and never bleed colour.
import assert from "node:assert/strict";
import { test } from "node:test";
import { charWidth, pickFit, stripAnsi, truncate, visibleWidth, wrap, wrapLines } from "../src/text.mjs";
import { bodyRows, menuFooter, textFooter, viewportTop } from "../src/interactive.mjs";

const GREEN = "\u001b[32m";
const RESET = "\u001b[0m";

test("visible width ignores SGR sequences and counts wide characters twice", () => {
  assert.equal(visibleWidth("abc"), 3);
  assert.equal(visibleWidth(`${GREEN}passed${RESET}`), 6);
  assert.equal(visibleWidth("↑/↓ move · Esc"), 14);
  assert.equal(visibleWidth("漢字"), 4);
  assert.equal(charWidth("é".codePointAt(1)), 0);
  assert.equal(stripAnsi(`${GREEN}x${RESET}`), "x");
});

test("truncate keeps a fitting row unchanged and cuts a long one to the width with an ellipsis", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("exactly ten", 11), "exactly ten");
  assert.equal(visibleWidth(truncate("a".repeat(50), 40)), 40);
  assert.equal(truncate("a".repeat(50), 40), `${"a".repeat(39)}…`);
  assert.equal(truncate("漢字漢字", 5), "漢字…");
  assert.equal(truncate("abc", 1), "…");
  assert.equal(truncate("abc", 0), "");
});

test("truncate keeps colour sequences and closes an open colour at the cut", () => {
  const row = `run-1  ${GREEN}reviewed${RESET}  workflow`;
  assert.equal(truncate(row, 100), row);
  const cut = truncate(row, 12);
  assert.equal(visibleWidth(cut), 12);
  assert.ok(cut.startsWith(`run-1  ${GREEN}revi`), cut);
  assert.ok(cut.endsWith(`…${RESET}`), "the cut row resets the colour it opened");
});

test("wrap breaks at the last space that fits and inside a word only when the word is wider than the row", () => {
  assert.deepEqual(wrap("the quick brown fox", 10), ["the quick", "brown fox"]);
  assert.deepEqual(wrap("abcdefghijkl", 5), ["abcde", "fghij", "kl"]);
  assert.deepEqual(wrap("", 10), [""]);
  assert.deepEqual(wrap("fits", 10), ["fits"]);
  for (const row of wrap("a path /very/long/path/without/spaces/at/all and then words that follow it", 20)) assert.ok(visibleWidth(row) <= 20, row);
  assert.deepEqual(wrapLines("one\ntwo three", 5), ["one", "two", "three"]);
});

test("wrap carries an open colour across rows and resets it at each row end", () => {
  const rows = wrap(`${GREEN}passed passed passed${RESET} plain`, 8);
  assert.deepEqual(rows, [`${GREEN}passed${RESET}`, `${GREEN}passed${RESET}`, `${GREEN}passed${RESET}`, "plain"]);
  assert.deepEqual(wrap(`${GREEN}ab cd${RESET} ef`, 8), [`${GREEN}ab cd${RESET} ef`]);
  for (const row of rows) assert.ok(visibleWidth(row) <= 8, row);
});

test("the frame leaves the body the rows between the header and the footer, and the viewport follows the cursor", () => {
  assert.equal(bodyRows(12), 7);
  assert.equal(bodyRows(24), 18);
  assert.equal(bodyRows(6), 1);
  assert.equal(viewportTop(0, 0, 7), 0);
  assert.equal(viewportTop(0, 6, 7), 0);
  assert.equal(viewportTop(0, 7, 7), 1);
  assert.equal(viewportTop(5, 2, 7), 2);
  assert.equal(viewportTop(5, 13, 7), 7);
});

test("the help footer keeps q quit and the position at every width, shortening its wording to fit", () => {
  const wide = menuFooter(80, { top: 0, shown: 18, total: 25 });
  assert.equal(wide, "↑/↓ move · Enter select · r reload · Esc back · q quit · 1–18 of 25");
  assert.equal(menuFooter(80, { top: 0, shown: 18, total: 14 }), "↑/↓ move · Enter select · r reload · Esc back · q quit");
  const narrow = menuFooter(40, { top: 7, shown: 7, total: 14 });
  assert.ok(visibleWidth(narrow) <= 40, narrow);
  assert.match(narrow, /q/);
  assert.match(narrow, /8–14 of 14/);
  const text = textFooter(40, { offset: 1, shown: 7, total: 43 });
  assert.ok(visibleWidth(text) <= 40, text);
  assert.match(text, /2–8 of 43/);
  assert.equal(textFooter(80, { offset: 0, shown: 18, total: 43 }), "lines 1–18 of 43 · ↑/↓ scroll · PgUp/PgDn page · Esc back · q quit");
  assert.equal(visibleWidth(pickFit(["much too long for this", "short"], 6)), 5);
  assert.equal(visibleWidth(pickFit(["much too long for this", "still too long"], 6)), 6);
});
