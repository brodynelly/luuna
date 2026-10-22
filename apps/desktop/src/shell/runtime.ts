import { ApiError } from "@luuna/api-client";
import type { LuunaClient, RunRecord, RunState } from "@luuna/api-client";

/** Session history shows the most recent runs; older ones stay in the runtime. */
export const HISTORY_LIMIT = 200;
export const ACTIVE_STATES: RunState[] = ["queued", "running", "implementing", "validating", "reviewing"];

/** Keep selection on the displayed history page so its controls and replay agree. */
export function historySelection(selected: string | null, runs: RunRecord[]): string | null {
  return runs.some((run) => run.id === selected) ? selected : runs[0]?.id ?? null;
}

/** A rejected token never recovers by waiting: the developer has to enter the current one. */
export function authenticationLost(failure: unknown): boolean {
  return failure instanceof ApiError && failure.status === 401;
}

/**
 * The announced session status: the connection and the run's state, so a screen reader hears
 * transitions rather than every replayed event sequence.
 */
export function sessionStatus(live: string, state: RunState): string {
  return live === "Connected" ? `Connected · session ${state.replace(/_/g, " ")}` : live;
}

/** Resolves after `milliseconds`, or rejects when the signal aborts first. */
export function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/**
 * Lists runs until aborted. An outage is retried, because the runtime comes back by itself; a
 * rejected token ends the loop, because only the developer can supply the current one.
 */
export async function watchRuns(
  client: Pick<LuunaClient, "listRuns"> & Partial<Pick<LuunaClient, "runsPage">>,
  signal: AbortSignal,
  on: { listed: (runs: RunRecord[]) => void; outage: (failure: unknown) => void; rejected: (failure: unknown) => void },
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void> = pause,
  before?: string,
): Promise<void> {
  while (!signal.aborted) {
    try {
      // An older history page is a keyset page ending before the given run (ADR 0015).
      const next = before && client.runsPage ? await client.runsPage(before, undefined, signal) : await client.listRuns(signal, { limit: HISTORY_LIMIT });
      if (signal.aborted) return;
      on.listed(next);
      // Settled history is polled less often than a page with active work.
      await wait(next.some((run) => ACTIVE_STATES.includes(run.state)) ? 2000 : 5000, signal);
    } catch (failure) {
      if (signal.aborted) return;
      if (authenticationLost(failure)) { on.rejected(failure); return; }
      on.outage(failure);
      await wait(3000, signal).catch(() => undefined);
    }
  }
}

/** A recorded time in the viewer's locale, or the raw value when it does not parse. */
export function localTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

/** The history card's title: what the run is, in the words of its kind. */
export function runTitle(run: RunRecord): string {
  const meta = run.metadata;
  if (meta.kind === "baseline") return `Baseline · ${String(meta.repository_id ?? "")} · manifest r${String(meta.manifest_revision ?? "?")}`;
  if (meta.kind === "workflow") return `Workflow · ${String(meta.plan_id ?? "")} r${String(meta.plan_revision ?? "?")}`;
  return typeof meta.prompt === "string" ? meta.prompt : run.id;
}
