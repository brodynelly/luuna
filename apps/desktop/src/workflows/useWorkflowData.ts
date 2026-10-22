import { useEffect, useRef, useState } from "react";
import type { LuunaClient, RunRecord } from "@luuna/api-client";
import { workflowNeedsRefresh } from "../workflow-state";
import { describeFailure } from "../failures";
import { NO_TICKETS, readWorkflows } from "./read";
import type { RunSnapshot, TicketState } from "./read";

/**
 * The project's tickets, workflow runs and per-run snapshots, polled while any workflow is active.
 * A forced load re-reads tickets, plans and every candidate; a poll re-reads only what moved.
 * Polls are scheduled after each request settles so a slow request is never aborted by the
 * interval; a transient failure gets its own retry.
 */
export function useWorkflowData(client: LuunaClient | null, projectId: string, connectionEpoch: number, componentEpoch: number) {
  const [tickets, setTickets] = useState<TicketState>(NO_TICKETS);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [snapshots, setSnapshots] = useState<Map<string, RunSnapshot>>(new Map());
  const [loadError, setLoadError] = useState("");
  const [tick, setTick] = useState(0);
  const known = useRef(new Map<string, RunSnapshot>());
  const forced = useRef(true);

  function reload() {
    forced.current = true;
    setTick((value) => value + 1);
  }

  async function load(signal: AbortSignal): Promise<boolean> {
    if (!client) return false;
    const read = await readWorkflows(client, projectId, known.current, forced.current, signal);
    if (!read || signal.aborted) return false;
    known.current = read.snapshots;
    forced.current = false;
    setSnapshots(read.snapshots);
    setRuns(read.runs);
    if (read.tickets) setTickets(read.tickets);
    return read.runs.some((run) => workflowNeedsRefresh(run, read.snapshots.get(run.id)?.candidate));
  }

  useEffect(() => {
    setTickets(NO_TICKETS);
    setRuns([]);
    setSnapshots(new Map());
    setLoadError("");
    known.current = new Map();
    forced.current = true;
  }, [client, projectId]);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    load(controller.signal).then((follow) => {
      if (!controller.signal.aborted) setLoadError("");
      if (!controller.signal.aborted && follow) timer = setTimeout(() => setTick((value) => value + 1), 1500);
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      setLoadError(describeFailure(failure));
      timer = setTimeout(() => setTick((value) => value + 1), 3000);
    });
    return () => { controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, tick]);

  useEffect(() => {
    if (connectionEpoch > 0) reload();
  }, [connectionEpoch]);

  useEffect(() => { reload(); }, [componentEpoch]);

  return { tickets, runs, snapshots, loadError, clearLoadError: () => setLoadError(""), reload };
}
