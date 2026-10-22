import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, EmptyState, SettingsRow, StatGrid, StatTile, StatusBadge, StatusIndicator, Switch } from "./index";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("SettingsRow is a labelled group: title, optional badge and description, optional trailing control", () => {
  const plain = html(<SettingsRow title="Runtime" />);
  const id = /id="([^"]+)"/.exec(plain)![1];
  expect(plain).toBe(`<div class="settings-row" role="group" aria-labelledby="${id}"><div class="settings-row-text"><span class="settings-row-title" id="${id}">Runtime</span></div></div>`);
  const full = html(<SettingsRow title="Git" badge={<StatusBadge tone="success">ready</StatusBadge>} description="git 2.45" control={<Button>Check</Button>} className="doctor" data-capability="settings.doctor" />);
  const fullId = /id="([^"]+)"/.exec(full)![1];
  expect(full).toBe(`<div class="settings-row doctor" role="group" aria-labelledby="${fullId}" data-capability="settings.doctor"><div class="settings-row-text"><span class="settings-row-title" id="${fullId}">Git<span class="state" data-tone="success">ready</span></span><span class="settings-row-desc">git 2.45</span></div><div class="settings-row-control"><button type="button">Check</button></div></div>`);
});

test("a stacked SettingsRow adds its class and renders children under the text", () => {
  const markup = html(<SettingsRow title="Env" stacked><code>x</code></SettingsRow>);
  expect(markup).toContain('class="settings-row settings-row-stacked"');
  expect(markup).toContain('</span><code>x</code></div></div>');
});

test("a switch can be the row control and is named by the row title", () => {
  const id = "row-title";
  const markup = html(<SettingsRow title="Follow output" control={<Switch label={<span className="visually-hidden">Follow output</span>} aria-labelledby={id} />} />);
  expect(markup).toContain('role="switch"');
  expect(markup).toContain(`aria-labelledby="${id}"`);
  expect(markup).toContain('class="settings-row-control"');
});

test("StatusIndicator pairs a shape mark with a word, with optional detail and a polite live region", () => {
  expect(html(<StatusIndicator tone="success" label="Connected" />)).toBe('<span class="status-indicator"><i class="tone-mark" aria-hidden="true" data-tone="success"></i><span class="status-label">Connected</span></span>');
  expect(html(<StatusIndicator tone="interrupted" label="Reconnecting" detail="attempt 2" live />)).toBe('<span class="status-indicator" role="status" aria-live="polite"><i class="tone-mark" aria-hidden="true" data-tone="interrupted"></i><span class="status-label">Reconnecting</span><span class="status-detail">attempt 2</span></span>');
  expect(html(<StatusIndicator label="Unknown" />)).not.toContain("data-tone");
});

test("StatTile shows a static number or string, with an optional comparison", () => {
  expect(html(<StatTile term="Projects" value={3} />)).toBe('<div class="stat-tile"><dt>Projects</dt><dd class="stat-value">3</dd></div>');
  expect(html(<StatTile term="Health" value="92%" comparison="+3 since yesterday" />)).toBe('<div class="stat-tile"><dt>Health</dt><dd class="stat-value">92%</dd><dd class="stat-comparison">+3 since yesterday</dd></div>');
  expect(html(<StatGrid label="Summary"><StatTile term="A" value={0} /></StatGrid>)).toContain('<dl class="stat-grid" aria-label="Summary">');
});

test("EmptyState has no aurora and a boxed, titled state keeps its action last", () => {
  const markup = html(<EmptyState boxed title="No projects" action={<Button variant="primary">Add</Button>}>Add a repository.</EmptyState>);
  expect(markup).toBe('<div class="empty-state empty-box"><p class="empty-title">No projects</p><p class="empty">Add a repository.</p><button type="button" class="primary">Add</button></div>');
  expect(markup).not.toContain("aurora");
});
