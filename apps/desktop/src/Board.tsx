import { useEffect, useState } from "react";
import type { BoardCard, BoardProjection, LuunaClient, RunRecord } from "@luuna/api-client";
import { boardProjection } from "@luuna/api-client";
import type { OpenRequest } from "./Home";
import { boundedMap } from "./Workflows";
import { describeFailure } from "./failures";
import { runTone, BoardColumn, Button, copyText, EmptyState, ErrorBanner, Id, ListRow, Loading, Meta, Page, SimpleGrid, StatusBadge, useNotify, VisuallyHidden, shortId } from "@luuna/ui";
import { viewInfo } from "./content/views";

/** One read of what the board projects: every project view (with its offers), its tickets, and the run listing. */
export async function readBoard(client: Pick<LuunaClient, "listProjects" | "project" | "listTickets" | "listRuns">, signal: AbortSignal): Promise<BoardProjection> {
  const [projects, runs] = await Promise.all([client.listProjects(signal), client.listRuns(signal)]);
  const details = await boundedMap(projects, (project) => Promise.all([client.project(project.id, signal), client.listTickets(project.id, signal)]));
  return boardProjection({ projects: details.map(([view]) => view), tickets: details.flatMap(([, tickets]) => tickets), runs: runs as RunRecord[] });
}

function cardLabel(card: BoardCard): string {
  return card.kind === "prerequisite" ? `${card.title} in ${card.project_id}` : `${card.title} (${card.ticket_id} r${card.ticket_revision}) in ${card.project_id}`;
}

/** One card: the ticket (or offer) title, its run state through runTone, and its identities. */
function BoardCardView({ card, busy, onOpen }: { card: BoardCard; busy: boolean; onOpen: (request: OpenRequest) => void }) {
  const state = card.kind === "prerequisite" ? <StatusBadge tone="attention">testing setup</StatusBadge>
    : card.state ? <StatusBadge tone={runTone[card.state]}>{card.state.replace(/_/g, " ")}</StatusBadge> : <StatusBadge>no plan</StatusBadge>;
  const meta = <>
    {state}
    {card.purpose && <StatusBadge>{card.purpose.replace(/_/g, " ")}</StatusBadge>}
    <Id>{card.kind === "prerequisite" ? card.repository_id : shortId(card.ticket_id ?? "")}</Id>
    {card.plan_revision !== undefined && <span>plan r{card.plan_revision}</span>}
    <span>{card.project_id}</span>
  </>;
  const notify = useNotify();
  const id = card.kind === "prerequisite" ? card.repository_id : card.ticket_id;
  const open = () => onOpen({ projectId: card.project_id, ticketId: card.ticket_id });
  return <ListRow className="board-card" buttonLabel={`Open ${cardLabel(card)}`} onOpen={open} disabled={busy} title={card.title} meta={meta}
    menuLabel={`Actions for ${card.title}`} commands={() => [
      { label: card.kind === "prerequisite" ? "Open project" : "Open ticket", onSelect: open, disabled: busy },
      ...(card.kind === "prerequisite" ? [] : [{ label: "Open project", onSelect: () => onOpen({ projectId: card.project_id }), disabled: busy }]),
      ...(id ? [{ label: card.kind === "prerequisite" ? "Copy repository ID" : "Copy ticket ID", group: true, onSelect: () => void copyText(id).then(() => notify("Copied")) }] : []),
    ]} />;
}

/** The board as rendered; pure, so a fixture projection renders without a runtime. */
export function BoardView({ projection, busy, onOpen }: { projection: BoardProjection; busy: boolean; onOpen: (request: OpenRequest) => void }) {
  return <>
    <SimpleGrid className="board-columns" gap={3} role="group" aria-label="Kanban columns">{projection.columns.map(({ column, cards }) => <BoardColumn key={column.id} headingId={`board-column-${column.id}`} as={cards.length > 0 ? "ul" : "div"} bodyClassName="board-cards" title={column.title} count={cards.length} countLabel="card(s)" scope={column.description}>
      {cards.length > 0 ? cards.map((card) => <BoardCardView key={card.kind === "prerequisite" ? `offer-${card.project_id}-${card.repository_id}` : `ticket-${card.ticket_id}`} card={card} busy={busy} onOpen={onOpen} />) : <EmptyState>Nothing here.</EmptyState>}
    </BoardColumn>)}</SimpleGrid>
    <Meta block className="board-note">{projection.note}</Meta>
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
  const info = viewInfo("board");

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

  const refresh = <Button variant="text" disabled={!client || busy} onClick={() => setTick((value) => value + 1)}>Refresh<VisuallyHidden> Board</VisuallyHidden></Button>;
  return <Page id="board" title={info.label} description={info.description} actions={refresh} className="board-panel" data-surface="board">
    {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
    {client ? projection ? <BoardView projection={projection} busy={busy} onOpen={onOpen} />
      : !error && <Loading label="Reading the runtime's tickets and workflows…" rows={4} />
      : <EmptyState boxed>Connect to the runtime to see the board.</EmptyState>}
  </Page>;
}
