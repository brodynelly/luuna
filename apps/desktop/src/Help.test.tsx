import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCUMENTS, Help, REPOSITORY_URL, SHORTCUTS } from "./Help";
import { VIEWS, viewShortcut } from "./content/views";

test("Help renders the shortcuts topic with one key cap per view plus the global shortcuts, and every document link", () => {
  const html = renderToStaticMarkup(<Help />);
  expect(html).toContain('data-surface="help"');
  expect(html).toContain('id="help-shortcuts"');
  const keys = [...html.matchAll(/<kbd class="kbd">([^<]+)<\/kbd>/g)].map((match) => match[1]);
  expect(keys).toEqual([...VIEWS.map((view) => viewShortcut(view.id)), "Ctrl+K", "Ctrl+\\"]);
  expect(keys).toContain("Ctrl+,");
  expect(SHORTCUTS.map((shortcut) => shortcut.action)).toContain("Collapse sidebar");
  for (const document of DOCUMENTS) expect(html).toContain(`${REPOSITORY_URL}/${document.path}`);
});
