import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AppShell, ConnectionStatus, NavItem, NavSection, Sidebar, ViewSlot, applyPill, pillGeometry } from "./shell";

const noop = () => undefined;
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("pillGeometry", () => {
  test("is null without a laid-out item", () => {
    expect(pillGeometry({ top: 10 }, null)).toBeNull();
    expect(pillGeometry({ top: 10 }, { top: 50, height: 0 })).toBeNull();
  });
  test("returns the rounded offset and height", () => {
    expect(pillGeometry({ top: 10.4 }, { top: 50.2, height: 33.6 })).toEqual({ y: 40, height: 34 });
  });
});

describe("applyPill", () => {
  const fake = () => ({ style: { setProperty: vi.fn() }, setAttribute: vi.fn(), removeAttribute: vi.fn() });
  test("writes both properties in px and marks the nav ready", () => {
    const nav = fake();
    applyPill(nav as never, { y: 40, height: 34 });
    expect(nav.style.setProperty).toHaveBeenCalledWith("--pill-y", "40px");
    expect(nav.style.setProperty).toHaveBeenCalledWith("--pill-h", "34px");
    expect(nav.setAttribute).toHaveBeenCalledWith("data-pill", "ready");
  });
  test("null removes the marker", () => {
    const nav = fake();
    applyPill(nav as never, null);
    expect(nav.removeAttribute).toHaveBeenCalledWith("data-pill");
    expect(nav.style.setProperty).not.toHaveBeenCalled();
  });
});

describe("Sidebar", () => {
  const item = (label: string, current: boolean) => createElement(NavItem, { key: label, icon: "home", label, current, shortcut: "Ctrl+1", onSelect: noop });
  const markup = html(createElement(Sidebar, {
    status: createElement(ConnectionStatus, { tone: "success", label: "Local runtime connected", live: true }),
    current: "home", collapsed: false, onToggle: noop, onSearch: noop,
    children: [
      createElement(NavSection, { key: "a", id: "workspace", label: "Workspace", children: [item("Home", true), item("Board", false)] }),
      createElement(NavSection, { key: "b", id: "general", label: "General", children: [item("Help", false)] }),
    ],
  }));
  test("one labelled nav with exactly one pill and one current item", () => {
    expect(markup).toContain('<nav class="sidebar-nav" aria-label="Views">');
    expect(markup.match(/class="nav-pill" aria-hidden="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });
  test("each section list points at an existing label", () => {
    for (const [, id] of markup.matchAll(/<ul[^>]*aria-labelledby="([^"]+)"/g)) expect(markup).toContain(`id="${id}"`);
    expect(markup.match(/<ul[^>]*aria-labelledby/g)).toHaveLength(2);
  });
  test("keeps the palette trigger and puts the status in the footer", () => {
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toMatch(/<div class="sidebar-footer"><span class="connection"[^>]*role="status"/);
  });
});

describe("ConnectionStatus", () => {
  test("live adds data-live; otherwise it is absent", () => {
    const live = html(createElement(ConnectionStatus, { tone: "success", label: "x", live: true }));
    expect(live).toContain("data-live");
    expect(live).toContain('data-tone="success"');
    expect(html(createElement(ConnectionStatus, { tone: "neutral", label: "x" }))).not.toContain("data-live");
  });
});

describe("ViewSlot and AppShell", () => {
  test("a hidden entering slot carries both attributes", () => {
    const markup = html(createElement(ViewSlot, { hidden: true, entering: true, children: "x" }));
    expect(markup).toContain('hidden=""');
    expect(markup).toContain("data-entering");
    expect(html(createElement(ViewSlot, { hidden: false, children: "x" }))).not.toContain("data-entering");
  });
  test("the shell exposes its motion, the skip link and the main landmark", () => {
    const markup = html(createElement(AppShell, { collapsed: false, sidebar: null, motion: "css", children: "x" }));
    expect(markup).toContain('data-view-motion="css"');
    expect(markup).toContain('href="#main"');
    expect(markup).toContain('id="main"');
  });
});
