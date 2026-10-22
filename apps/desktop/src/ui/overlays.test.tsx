import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunRecord, Ticket } from "@luuna/api-client";
import { CommandPalette, ContextMenuArea, filterCommands } from "./index";
import type { PaletteCommand } from "./index";
import { TicketList, shownTicket } from "../workflows/TicketList";

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

const ticket = (id: string, title: string): Ticket => ({ id, title, project_id: "p", revision: 1, intent: "", acceptance_criteria: [], repository_ids: ["app"], source: "local_sqlite_temporary" } as unknown as Ticket);

test("the ticket detail shows the ticket asked for, the one already shown, or the newest", () => {
  const tickets = [ticket("a", "First"), ticket("b", "Second")];
  expect(shownTicket(tickets, null)).toBe("b");
  expect(shownTicket(tickets, "a")).toBe("a");
  expect(shownTicket(tickets, "gone")).toBe("b");
  expect(shownTicket([], "a")).toBeNull();
});

test("the ticket list is one selectable row per ticket with its latest run state", () => {
  const rows = [{ ticket: ticket("a", "First"), run: { state: "plan_ready" } as RunRecord, planRevision: 2 }, { ticket: ticket("b", "Second") }];
  const html = renderToStaticMarkup(<TicketList rows={rows} selected="a" onSelect={run} />);
  expect(html).toContain('aria-label="Ticket list"');
  expect(html).toMatch(/aria-label="First, plan ready"[^>]*aria-pressed="true"/);
  expect(html).toMatch(/aria-label="Second, no plan"[^>]*aria-pressed="false"/);
  expect(html).toContain('<span class="state" data-tone="attention">plan ready</span>');
  expect(html).toContain("<span>plan r2</span>");
});
