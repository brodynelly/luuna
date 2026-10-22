import { useEffect, useRef, useState } from "react";
import type { EventEnvelope, LuunaClient, RunRecord } from "@luuna/api-client";
import { followSession } from "./followSession";

/**
 * Follows the selected run: unsettled runs stream over resumable SSE with the records of each
 * animation frame committed as one React update, and cursor replay takes over after a failure,
 * a stream end or for settled history, which also repairs gaps after sleep or disconnection. It
 * keeps a bounded window of the newest events and the assistant text, and whether a workflow's
 * candidate is active (for its cancel control).
 */
export function useSessionReplay(client: LuunaClient | null, selected: string | null, runs: RunRecord[], refresh: number, setLive: (text: string) => void) {
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [output, setOutput] = useState("");
  const [candidateActive, setCandidateActive] = useState(false);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const workflow = runs.find((run) => run.id === selected)?.metadata.kind === "workflow";

  useEffect(() => {
    setEvents([]);
    setOutput("");
    setCandidateActive(false);
    if (!client || !selected) return;
    const controller = new AbortController();
    let text = "";
    void followSession(client, selected, {
      signal: controller.signal,
      isWorkflow: workflow,
      runState: () => runsRef.current.find((run) => run.id === selected)?.state,
    }, {
      commit: (records, next) => {
        setEvents(records);
        if (next !== text) { text = next; setOutput(next); }
      },
      candidate: setCandidateActive,
      live: setLive,
    });
    // Aborting cancels the pending frame inside followSession: nothing commits after cleanup.
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, selected, workflow, refresh]);

  return { events, output, candidateActive };
}
