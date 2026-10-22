import { useEffect, useState } from "react";
import type { BoardCard, BoardProjection, LuunaClient, RunRecord } from "@luuna/api-client";
import { boardProjection } from "@luuna/api-client";
import type { OpenRequest } from "./Home";
import { boundedMap } from "./Workflows";
import { describeFailure } from "./failures";
import { StatusBadge } from "./design/StatusBadge";
import { runTone } from "./design/tone";

/** One read of what the board projects: every project view (with its offers), its tickets, and the run listing. */
export async function readBoard(client: Pick<LuunaClient, "listProjects" | "project" | "listTickets" | "listRuns">, signal: AbortSignal): Promise<BoardProjection> {
  const [projects, runs] = await Promise.all([client.listProjects(signal), client.listRuns(signal)]);
  const details = await boundedMap(projects, (project) => Promise.all([client.project(project.id, signal), client.listTickets(project.id, signal)]));
  return boardProjection({ projects: details.map(([view]) => view), tickets: details.flatMap(([, tickets]) => tickets), runs: runs as RunRecord[] });
}

function cardLabel(card: BoardCard): string {
  return card.kind === "prerequisite" ? `${card.title} in ${card.project_id}` : `${card.title} (${card.ticket_id} r${card.ticket_revision}) in ${card.project_id}`;
}

/** The board as rendered; pure, so a fixture projection renders without a runtime. */
export function BoardView({ projection, busy, onOpen }: { projection: BoardProjection; busy: boolean; onOpen: (request: OpenRequest) => void }) {
  return <>
    <ul className="board-columns" aria-label="Kanban columns">{projection.columns.map(({ column, cards }) => <li key={column.id} className="board-column">
      <h3 id={`board-${column.id}`}>{column.title} <span className="board-count" aria-label={`${cards.length} card(s)`}>{cards.length}</span></h3>
      <small className="board-column-scope">{column.description}</small>
      {cards.length > 0 ? <ul className="board-cards" aria-labelledby={`board-${column.id}`}>{cards.map((card) => <li key={card.kind === "prerequisite" ? `offer-${card.project_id}-${card.repository_id}` : `ticket-${card.ticket_id}`}>
        <button type="button" className="run-card" disabled={busy} aria-label={`Open ${cardLabel(card)}`} onClick={() => onOpen({ projectId: card.project_id, ticketId: card.ticket_id })}>
          <span className="run-prompt">{card.title}</span>
          <span className="run-meta">
            {card.kind === "prerequisite" ? <StatusBadge tone="attention">testing setup</StatusBadge> : card.state ? <StatusBadge tone={runTone[card.state]}>{card.state.replace(/_/g, " ")}</StatusBadge> : <StatusBadge>no plan</StatusBadge>}
            {card.purpose && <StatusBadge>{card.purpose.replace(/_/g, " ")}</StatusBadge>}
            <code>{card.kind === "prerequisite" ? card.repository_id : card.ticket_id}</code>
            {card.plan_revision !== undefined && <span>plan r{card.plan_revision}</span>}
            <span>{card.project_id}</span>
          </span>
        </button>
      </li>)}</ul> : <p className="empty">Nothing here.</p>}
    </li>)}</ul>
    <p className="meta" role="note">{projection.note}</p>
  </>;
}

/**
 * The Kanban projection of docs/09-experience.md (ADR 0027 point 4): the chapter's columns over
 * the runtime's recorded run states, read-only. A card opens its ticket in the Projects panel;
 * nothing is dragged, because a column can only be entered through the runtime's gates.
 */
export function Board({ client, connectionEpoch = 0, refreshEpoch = 0, onOpen }: { client: LuunaClient | null; connectionEpoch?: number; refreshEpoch?: number; onOpen: (request: OpenRequest) => void }) {
  const [projection, setProjection] = useState<BoardProjection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setProjection(null);
    setError("");
    if (!client) return;
    const controller = new AbortController();
    setBusy(true);
    readBoard(client, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setProjection(next);
      setError("");
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(describeFailure(failure));
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [client, connectionEpoch, refreshEpoch, tick]);

  return <section className="panel board-panel" aria-labelledby="board-heading" data-surface="board">
    <div className="panel-heading"><h2 id="board-heading">Board</h2><span className="tag">Projection of run state · read-only</span><button type="button" className="text-button" disabled={!client || busy} onClick={() => setTick((value) => value + 1)}>Refresh board</button></div>
    <p className="scope">Every ticket sits in the column of its latest plan revision's authoritative run state; a repository without a usable testing setup sits in Testing prerequisite. Cards open the ticket's own panel. Dragging is not implemented: moving a card can never bypass a validation gate or an approval.</p>
    {error && <div className="error" role="alert">{error}<button className="text-button" type="button" onClick={() => setError("")}>Dismiss</button></div>}
    {client ? projection ? <BoardView projection={projection} busy={busy} onOpen={onOpen} /> : !error && <p className="empty">Reading the runtime's tickets and workflows…</p> : <p className="empty empty-box">Connect to the runtime to see the board.</p>}
  </section>;
}
