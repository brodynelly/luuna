import type { CandidateView, LuunaClient, PlanRevision, RunRecord, Ticket, TicketSourceStatus, WorktreeLease } from "@luuna/api-client";
import { advanceWorkflowReplay, workflowNeedsRefresh } from "../workflow-state";

/** Events are read after each workflow's cursor, at most this many per request. */
const EVENT_PAGE = 1000;

/** What the panel last read for one workflow run; events are only ever read after `cursor`. */
export interface RunSnapshot {
  revision: number;
  updated: string;
  cursor: number;
  reason: string;
  leases: WorktreeLease[];
  candidate: CandidateView;
}

export interface TicketState {
  list: Ticket[];
  sources: Record<string, TicketSourceStatus>;
  plans: Record<string, PlanRevision[]>;
}

export const NO_TICKETS: TicketState = { list: [], sources: {}, plans: {} };

/**
 * One read of a project's workflows. A poll re-reads only workflows that are active; when any
 * workflow moved (or `full` asks for it) tickets, plans and every candidate are re-read, because
 * one workflow's transition can change another's decisions (one writer per repository). Events
 * are always read after each workflow's last cursor, never replayed from the start.
 */
export async function readWorkflows(client: LuunaClient, projectId: string, known: Map<string, RunSnapshot>, full: boolean, signal: AbortSignal): Promise<{ runs: RunRecord[]; snapshots: Map<string, RunSnapshot>; tickets: TicketState | null } | null> {
  const all = await client.listRuns(signal);
  if (signal.aborted) return null;
  const runs = all.filter((run) => run.metadata.kind === "workflow" && run.project_id === projectId);
  const moved = (run: RunRecord) => { const seen = known.get(run.id); return !seen || seen.revision !== run.revision || seen.updated !== run.updated_at; };
  const transition = full || runs.length !== known.size || runs.some(moved);
  const stale = runs.filter((run) => transition || workflowNeedsRefresh(run, known.get(run.id)?.candidate));
  const [tickets, fresh] = await Promise.all([
    transition ? readTickets(client, projectId, signal) : Promise.resolve(null),
    boundedMap(stale, async (run) => {
      const seen = known.get(run.id);
      const [leases, replay, candidate] = await Promise.all([
        client.worktrees(run.id, signal),
        readWorkflowReplay(client, run.id, seen, signal),
        client.candidate(run.id, signal),
      ]);
      return { run, leases, replay, candidate };
    }),
  ]);
  if (signal.aborted) return null;
  const snapshots = new Map<string, RunSnapshot>();
  for (const run of runs) {
    const seen = known.get(run.id);
    const read = fresh.find((item) => item.run.id === run.id);
    if (!read) { if (seen) snapshots.set(run.id, seen); continue; }
    snapshots.set(run.id, { revision: run.revision, updated: run.updated_at, cursor: read.replay.cursor, reason: read.replay.reason, leases: read.leases, candidate: read.candidate });
  }
  return { runs, snapshots, tickets };
}

/** Reduce and release each bounded page before requesting more history. */
export async function readWorkflowReplay(client: Pick<LuunaClient, "events">, runId: string, seen: Pick<RunSnapshot, "cursor" | "reason"> | undefined, signal: AbortSignal) {
  let replay = { cursor: seen?.cursor ?? 0, reason: seen?.reason ?? "" };
  for (;;) {
    signal.throwIfAborted();
    const page = await client.events(runId, replay.cursor, signal, { limit: EVENT_PAGE });
    signal.throwIfAborted();
    if (!page.length) return replay;
    const next = advanceWorkflowReplay(runId, replay, page);
    if (next.cursor <= replay.cursor) throw new Error("Workflow event page did not advance its cursor.");
    replay = next;
  }
}

/** Run `task` over `items` with at most four requests in flight, keeping input order. */
export async function boundedMap<T, R>(items: T[], task: (item: T) => Promise<R>, limit = 4): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
  }));
  return results;
}

/** Every ticket of the project with its plans and, for a Missions ticket, its source status. */
export async function readTickets(client: LuunaClient, projectId: string, signal: AbortSignal): Promise<TicketState> {
  const list = await client.listTickets(projectId, signal);
  const details = await boundedMap(list, (ticket) => Promise.all([
    client.listPlans(ticket.id, signal),
    client.ticket(ticket.id, signal),
    ticket.source === "missions" ? client.ticketSource(ticket.id, signal) : Promise.resolve(null),
  ]));
  const planLists = details.map(([plans]) => plans);
  const sources = details.map(([, , source]) => source);
  return {
    list: details.map(([, ticket]) => ticket),
    sources: Object.fromEntries(list.flatMap((ticket, index) => sources[index] ? [[ticket.id, sources[index]!]] : [])),
    plans: Object.fromEntries(list.map((ticket, index) => [ticket.id, planLists[index]])),
  };
}
