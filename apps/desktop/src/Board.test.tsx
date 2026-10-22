import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BOARD_COLUMNS, RUN_COLUMN, boardProjection } from "@luuna/api-client";
import type { RunState } from "@luuna/api-client";
import { BoardView, readBoard } from "./Board";
import { fixtureClient, runs, tickets, views } from "./Home.test";

test("the board projects every ticket into the column of its latest plan revision's run state, read-only, the same projection the TUI prints", async () => {
  const { client, calls } = fixtureClient();
  const projection = await readBoard(client, new AbortController().signal);
  expect(projection).toEqual(boardProjection({ projects: views, tickets: Object.values(tickets).flat(), runs }));
  expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  expect(projection.columns.map(({ column }) => column.id)).toEqual(BOARD_COLUMNS.map((column) => column.id));
  expect(projection.columns.map(({ column, cards }) => [column.id, cards.map((card) => card.ticket_id ?? card.repository_id)])).toEqual([["backlog", ["t2"]], ["testing_prerequisite", ["lib"]], ["plan", []], ["approval", []], ["implementation", ["t3"]], ["checks", []], ["review", ["t1"]], ["prs", []]]);
  // Every run state has exactly one column, so no card can be hidden by a state the board forgot.
  const states: RunState[] = ["queued", "running", "completed", "failed", "cancelled", "interrupted", "discovered", "exploring", "testing_blocked", "plan_ready", "approved", "implementing", "validating", "reviewing", "reviewed", "paused"];
  for (const state of states) expect(BOARD_COLUMNS.some((column) => column.id === RUN_COLUMN[state]), state).toBe(true);
  expect(RUN_COLUMN.plan_ready).toBe("approval");
  expect(RUN_COLUMN.reviewed).toBe("prs");
  expect(RUN_COLUMN.testing_blocked).toBe("testing_prerequisite");
  const html = renderToStaticMarkup(<BoardView projection={projection} busy={false} onOpen={() => {}} />);
  expect(html).toContain('aria-label="Kanban columns"');
  for (const column of BOARD_COLUMNS) expect(html).toContain(`${column.title} <span class="board-count"`);
  expect(html).toContain('aria-label="Open Greeting (t1 r1) in one"');
  expect(html).toMatch(/<span class="state" data-tone="attention">paused<\/span>/);
  expect(html).toContain('aria-label="Open Testing setup needed for lib in two"');
  expect(html).toContain("testing setup</span>");
  expect(html).toContain("<span>plan r2</span>");
  expect(html).toContain("dragging a card is not implemented");
  expect(html).not.toMatch(/draggable/);
  expect(html).toContain("Nothing here.");
});

test("Board cards stay unchanged buttons inside a reveal list that keeps its heading name", async () => {
  const { client } = fixtureClient();
  const projection = await readBoard(client, new AbortController().signal);
  const html = renderToStaticMarkup(<BoardView projection={projection} busy={false} onOpen={() => {}} />);
  expect(html).toMatch(/<ul class="reveal board-cards" aria-labelledby="board-[a-z_]+">/);
  expect(html).toContain('class="run-card');
  expect(html).not.toMatch(/draggable/);
});
