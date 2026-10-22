import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPalette, ContextMenuArea, filterCommands } from "./index";
import type { PaletteCommand } from "./index";

const run = () => undefined;
const commands: PaletteCommand[] = [
  { id: "view:home", label: "Go to Home", group: "View", run },
  { id: "view:projects", label: "Go to Projects", group: "View", run },
  { id: "project:walk", label: "Open Walkthrough", group: "Project", keywords: "walkthrough", run },
  { id: "ticket:t1", label: "Implement the greeting", group: "Ticket in Walkthrough", keywords: "ticket-1", run },
];

test("the palette finds commands by every word of the query, label prefixes first", () => {
  expect(filterCommands(commands, "").map((command) => command.id)).toEqual(commands.map((command) => command.id));
  expect(filterCommands(commands, "go pro").map((command) => command.id)).toEqual(["view:projects"]);
  expect(filterCommands(commands, "walkthrough").map((command) => command.id)).toEqual(["project:walk", "ticket:t1"]);
  expect(filterCommands(commands, "ticket-1").map((command) => command.id)).toEqual(["ticket:t1"]);
  expect(filterCommands(commands, "greeting").map((command) => command.id)).toEqual(["ticket:t1"]);
  expect(filterCommands(commands, "nothing like this")).toEqual([]);
});

test("the palette is a labelled modal dialog with a combobox over a listbox of commands", () => {
  const html = renderToStaticMarkup(<CommandPalette open={false} commands={commands} onClose={run} />);
  expect(html).toContain('<dialog class="palette" aria-label="Command palette"');
  expect(html).toMatch(/role="combobox"[^>]*aria-expanded="true"/);
  expect(html).toContain('role="listbox" aria-label="Commands"');
  expect(html.match(/role="option"/g)).toHaveLength(commands.length);
  expect(html).toContain('aria-selected="true"');
});

test("an item with a context menu renders exactly its content until the menu opens", () => {
  const html = renderToStaticMarkup(<ContextMenuArea label="Actions" commands={() => [{ label: "Copy", onSelect: run }]}><span>card</span></ContextMenuArea>);
  expect(html).toBe('<div class="context-area"><span>card</span></div>');
});
