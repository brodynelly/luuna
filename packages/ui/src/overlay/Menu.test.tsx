import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRef } from "react";
import { Menu } from "./Menu";
import { MenuList } from "./MenuList";
import type { MenuEntry } from "./Menu";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => undefined;
const items: MenuEntry[] = [
  { id: "copy", label: "Copy id", onSelect: noop },
  { id: "cancel", label: "Cancel run", onSelect: noop, disabled: true },
  { id: "discard", label: "Discard", onSelect: noop, tone: "danger" },
  { id: "plain", label: "Rename", onSelect: noop, tone: "neutral" },
];

test("the closed menu is a button with the menu popup role, collapsed, and no panel", () => {
  const markup = html(<Menu label="Run actions" trigger="Actions" items={items} />);
  expect(markup).toMatch(/^<div class="ov-anchor"><button type="button" aria-haspopup="menu" aria-expanded="false">Actions<\/button><\/div>$/);
});

test("rest props and class names land on the wrapper", () => {
  expect(html(<Menu label="Run actions" trigger="Actions" items={items} className="row-menu" data-surface="board" />)).toContain('class="ov-anchor row-menu" data-surface="board"');
});

const panel = (active: number) => html(<MenuList id="m" label="Run actions" items={items} active={active} panel={createRef()} onKeyDown={noop} onChoose={noop} />);

test("the open panel is role=menu with an accessible name, vertical, one menuitem per supplied command", () => {
  const markup = panel(0);
  expect(markup).toContain('role="menu" aria-label="Run actions" aria-orientation="vertical"');
  expect(markup.match(/role="menuitem"/g)).toHaveLength(items.length);
  for (const item of items) expect(markup).toContain(item.label);
});

test("roving tabindex: only the active item is in the tab order", () => {
  const markup = panel(2);
  expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
  expect(markup.match(/tabindex="-1"/g)).toHaveLength(3);
  expect(markup).toMatch(/tabindex="0"[^>]*>(?:<span[^>]*><\/span>)?Discard/);
  expect(panel(-1)).not.toContain('tabindex="0"');
});

test("a disabled command is a disabled button", () => {
  expect(panel(0)).toMatch(/disabled=""[^>]*>Cancel run/);
});

test("a toned command carries the shape mark and its tone; neutral adds no mark", () => {
  const markup = panel(0);
  expect(markup).toContain('data-tone="danger"');
  expect(markup).toContain('<span class="tone-mark" data-tone="danger" aria-hidden="true"></span>Discard');
  expect(markup.match(/tone-mark/g)).toHaveLength(1);
});
