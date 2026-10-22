import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunRecord, Ticket } from "@luuna/api-client";
import { TicketList, shownTicket } from "./TicketList";

const run = () => undefined;

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
