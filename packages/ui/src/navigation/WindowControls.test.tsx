import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WindowControls } from "./WindowControls";
import { AppShell, Sidebar, TopBar } from "../shell";

const noop = () => undefined;
const render = (maximized: boolean) => renderToStaticMarkup(<WindowControls maximized={maximized} onMinimize={noop} onToggleMaximize={noop} onClose={noop} />);

test("names the three buttons and offers Maximize while the window is not maximized", () => {
  const markup = render(false);
  expect(markup).toMatch(/^<div class="window-controls" role="group" aria-label="Window controls">/);
  expect([...markup.matchAll(/aria-label="(Minimize|Maximize|Restore|Close)"/g)].map((match) => match[1])).toEqual(["Minimize", "Maximize", "Close"]);
  expect(markup.match(/<button type="button"/g)).toHaveLength(3);
});

test("offers Restore with the restore glyph while maximized", () => {
  const markup = render(true);
  expect(markup).toContain('aria-label="Restore"');
  expect(markup).not.toContain('aria-label="Maximize"');
  expect(markup).toContain('d="M9.5 6.5v-1h9v9h-1M5.5 9.5h9v9h-9z"');
});

test("only the close button carries the danger hook, and the glyphs are decorative", () => {
  const markup = render(false);
  expect(markup.match(/caption-close/g)).toHaveLength(1);
  expect(markup.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(3);
});

test("the top bar is a drag region only when it carries window controls, and the buttons are not", () => {
  const plain = renderToStaticMarkup(<TopBar onMenu={noop} menuOpen={false} onSearch={noop} />);
  expect(plain).not.toContain("data-tauri-drag-region");
  const bar = renderToStaticMarkup(<TopBar onMenu={noop} menuOpen={false} onSearch={noop} windowControls={<WindowControls maximized={false} onMinimize={noop} onToggleMaximize={noop} onClose={noop} />} />);
  expect(bar).toMatch(/^<header class="topbar" data-tauri-drag-region="">/);
  expect(bar).toContain('<span class="topbar-spacer" data-tauri-drag-region="">');
  expect(bar).toContain('class="window-controls"');
  expect(bar.match(/<button[^>]*data-tauri-drag-region/g)).toBeNull();
  expect(bar.indexOf("topbar-search")).toBeLessThan(bar.indexOf("window-controls"));
});

test("the sidebar brand row is a drag region on request and its toggle button is not", () => {
  const render = (dragRegion?: boolean) => renderToStaticMarkup(<Sidebar status="" onToggle={noop} collapsed={false} dragRegion={dragRegion}>x</Sidebar>);
  expect(render()).not.toContain("data-tauri-drag-region");
  const markup = render(true);
  expect(markup.match(/data-tauri-drag-region=""/g)).toHaveLength(3);
  expect(markup.match(/<button[^>]*data-tauri-drag-region/g)).toBeNull();
});

test("in title bar mode the banner sits under the top bar and the shell reserves no banner offset", () => {
  const shell = (titleBar: boolean) => renderToStaticMarkup(<AppShell collapsed={false} sidebar={null} banner="Down" topbar={<i id="bar" />} titleBar={titleBar}>c</AppShell>);
  const plain = shell(false);
  expect(plain).toContain("data-banner");
  expect(plain.indexOf("shell-banner")).toBeLessThan(plain.indexOf('id="bar"'));
  const titled = shell(true);
  expect(titled).not.toContain("data-banner");
  expect(titled).toContain('data-titlebar=""');
  expect(titled.indexOf('id="bar"')).toBeLessThan(titled.indexOf("shell-banner"));
});
