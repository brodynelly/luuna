import { useEffect, useRef, useState } from "react";
import { EventWindow, isTerminal } from "@luuna/api-client";
import type { EventEnvelope, LuunaClient, RunRecord } from "@luuna/api-client";
import { describeFailure } from "../failures";
import { pause } from "../shell/runtime";

/**
 * Follows the selected run's durable event record by authenticated cursor replay, which also
 * repairs gaps after sleep or disconnection. It keeps a bounded window of the newest events and
 * the assistant text, and whether a workflow's candidate is active (for its cancel control).
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
    let cursor = 0;
    const replay = new EventWindow();
    const follow = async () => {
      while (!controller.signal.aborted) {
        try {
          const [incoming, candidate] = await Promise.all([
            client.eventPage(selected, cursor, undefined, controller.signal),
            workflow ? client.candidate(selected, controller.signal) : Promise.resolve(null),
          ]);
          if (controller.signal.aborted) return;
          if (incoming.length > 0) {
            setEvents(replay.append(incoming));
            setOutput(replay.text);
            cursor = replay.cursor;
          }
          setCandidateActive(candidate?.active ?? false);
          // Announced only when it changes: the connection, not every replayed sequence.
          setLive("Connected");
          // A page with events is followed by the next one at once; a settled run is still
          // followed (repair and re-validation continue on a failed workflow), just less often.
          const state = runsRef.current.find((run) => run.id === selected)?.state;
          const settled = state !== undefined && isTerminal(state) && !candidate?.active && incoming.length === 0;
          await pause(incoming.length > 0 ? 0 : settled ? 5000 : 700, controller.signal);
        } catch (failure) {
          if (controller.signal.aborted) return;
          setLive(`Reconnecting · replay will resume from sequence ${cursor} · ${describeFailure(failure)}`);
          await pause(2500, controller.signal).catch(() => undefined);
        }
      }
    };
    void follow();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, selected, workflow, refresh]);

  return { events, output, candidateActive };
}
