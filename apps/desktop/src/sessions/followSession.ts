import { EventWindow, isTerminal } from "@luuna/api-client";
import type { EventEnvelope, LuunaClient, RunState } from "@luuna/api-client";
import { describeFailure } from "../failures";
import { pause } from "../shell/runtime";
import { animationFrameScheduler, createFrameCoalescer } from "./frameCoalescer";
import type { FrameCoalescer } from "./frameCoalescer";

export type FollowSink = {
  commit(events: EventEnvelope[], text: string): void;
  candidate(active: boolean): void;
  live(text: string): void;
};

export type FollowOptions = {
  signal: AbortSignal;
  isWorkflow: boolean;
  runState: () => RunState | undefined;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  createCoalescer?: (commit: (batch: EventEnvelope[]) => void, onError: (error: unknown) => void) => FrameCoalescer<EventEnvelope>;
};

type FollowClient = Pick<LuunaClient, "streamEvents" | "eventPage" | "candidate">;

const SSE_RETRY_MS = 2500;
const CANDIDATE_MS = 700;

/**
 * Follows a run until aborted. An unsettled run is read from the resumable SSE stream, with the
 * records of each animation frame applied as one batch; any stream failure, gap or end falls back
 * to cursor paging from the last committed sequence, which also repairs gaps (ADR 0015).
 */
export async function followSession(client: FollowClient, runId: string, options: FollowOptions, sink: FollowSink): Promise<void> {
  const { signal, isWorkflow, runState } = options;
  const wait = options.wait ?? pause;
  const now = options.now ?? Date.now;
  const make = options.createCoalescer
    ?? ((commit, onError) => createFrameCoalescer<EventEnvelope>({ scheduler: animationFrameScheduler(), commit, onError }));
  const replay = new EventWindow();
  let sseRetryAt = 0;
  let announced = false;

  const reconnecting = (failure: unknown) => sink.live(`Reconnecting · replay will resume from sequence ${replay.cursor} · ${describeFailure(failure)}`);

  const candidateTicker = async (legSignal: AbortSignal): Promise<void> => {
    while (!legSignal.aborted) {
      try {
        const candidate = await client.candidate(runId, legSignal);
        if (legSignal.aborted) return;
        sink.candidate(candidate?.active ?? false);
        await wait(CANDIDATE_MS, legSignal);
      } catch (failure) {
        if (legSignal.aborted) return;
        reconnecting(failure);
        await wait(SSE_RETRY_MS, legSignal).catch(() => undefined);
      }
    }
  };

  /** One SSE connection; it flushes before returning and reports whether it ended abnormally. */
  const liveLeg = async (): Promise<{ failed: boolean }> => {
    const leg = new AbortController();
    const abortLeg = () => leg.abort(signal.reason);
    signal.addEventListener("abort", abortLeg, { once: true });
    let failure: { error: unknown } | undefined;
    const fail = (error: unknown) => { failure ??= { error }; leg.abort(); };
    // A frame that fires between an abort and the stream's rejection must not commit.
    const coalescer = make((batch) => { if (!signal.aborted) sink.commit(replay.append(batch), replay.text); }, fail);
    let pendingCursor = replay.cursor;
    const ticker = isWorkflow ? candidateTicker(leg.signal) : Promise.resolve();
    try {
      for await (const record of client.streamEvents(runId, replay.cursor, leg.signal)) {
        if (record.run_id !== runId || record.sequence !== pendingCursor + 1) throw new Error("Runtime event stream has a gap or invalid identity.");
        pendingCursor = record.sequence;
        if (!announced) { announced = true; sink.live("Connected"); }
        coalescer.push(record);
      }
    } catch (error) {
      failure ??= { error };
    } finally {
      leg.abort();
      signal.removeEventListener("abort", abortLeg);
    }
    if (signal.aborted) { coalescer.cancel(); return { failed: false }; }
    coalescer.flush();
    coalescer.cancel();
    await ticker;
    if (signal.aborted) return { failed: false };
    if (!failure) return { failed: false };
    reconnecting(failure.error);
    return { failed: true };
  };

  /** The paging iteration: one page and the candidate, committed at once (pages are batched). */
  const pollOnce = async (): Promise<void> => {
    try {
      const [incoming, candidate] = await Promise.all([
        client.eventPage(runId, replay.cursor, undefined, signal),
        isWorkflow ? client.candidate(runId, signal) : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      if (incoming.length > 0) sink.commit(replay.append(incoming), replay.text);
      sink.candidate(candidate?.active ?? false);
      // Announced only when it changes: the connection, not every replayed sequence.
      sink.live("Connected");
      announced = true;
      // A page with events is followed by the next one at once; a settled run is still
      // followed (repair and re-validation continue on a failed workflow), just less often.
      const state = runState();
      const settled = state !== undefined && isTerminal(state) && !candidate?.active && incoming.length === 0;
      await wait(incoming.length > 0 ? 0 : settled ? 5000 : CANDIDATE_MS, signal);
    } catch (failure) {
      if (signal.aborted) return;
      reconnecting(failure);
      await wait(SSE_RETRY_MS, signal).catch(() => undefined);
    }
  };

  while (!signal.aborted) {
    const state = runState();
    if (state !== undefined && !isTerminal(state) && now() >= sseRetryAt) {
      const leg = await liveLeg();
      if (signal.aborted) return;
      if (leg.failed) sseRetryAt = now() + SSE_RETRY_MS;
    }
    await pollOnce();
  }
}
