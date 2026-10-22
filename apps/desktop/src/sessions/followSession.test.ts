import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@luuna/api-client";
import type { EventEnvelope, RunState } from "@luuna/api-client";
import { followSession } from "./followSession";
import type { FollowSink } from "./followSession";
import { createFrameCoalescer } from "./frameCoalescer";

const RUN = "run-1";

function event(sequence: number, delta = "", run = RUN): EventEnvelope {
  return {
    event_id: `e${run}-${sequence}`, run_id: run, sequence, type: "pi.message_update",
    payload: { assistantMessageEvent: { type: "text_delta", delta } },
  } as unknown as EventEnvelope;
}

function harness(options: { state?: RunState; workflow?: boolean } = {}) {
  const controller = new AbortController();
  const frames = new Map<number, () => void>();
  let id = 0;
  let clock = 0;
  const waits: number[] = [];
  const commits: { events: EventEnvelope[]; text: string }[] = [];
  const live: string[] = [];
  const candidates: boolean[] = [];
  const state = { current: options.state ?? ("running" as RunState) };
  const sink: FollowSink = {
    commit: (events, text) => commits.push({ events, text }),
    candidate: (active) => candidates.push(active),
    live: (text) => live.push(text),
  };
  const scheduler = {
    request: (callback: () => void) => { frames.set(++id, callback); return id; },
    cancel: (handle: unknown) => { frames.delete(handle as number); },
  };
  const run = (client: Parameters<typeof followSession>[0], stopAfterWaits = 1) =>
    followSession(client, RUN, {
      signal: controller.signal,
      isWorkflow: options.workflow ?? false,
      runState: () => state.current,
      now: () => clock,
      wait: async (ms) => { waits.push(ms); if (waits.length >= stopAfterWaits) controller.abort(); },
      createCoalescer: (commit, onError) => createFrameCoalescer<EventEnvelope>({ scheduler, commit, onError }),
    }, sink);
  return { controller, frames, waits, commits, live, candidates, state, run, advance: (ms: number) => { clock += ms; } };
}

async function* stream(...items: (EventEnvelope | Error)[]): AsyncGenerator<EventEnvelope> {
  for (const item of items) {
    if (item instanceof Error) throw item;
    yield item;
  }
}

const page = (records: EventEnvelope[]) => vi.fn(async () => records);
const none = vi.fn(async () => ({ active: false }));

function client(h: { streamEvents?: unknown; eventPage?: unknown; candidate?: unknown }) {
  return {
    streamEvents: h.streamEvents ?? vi.fn(() => stream()),
    eventPage: h.eventPage ?? page([]),
    candidate: h.candidate ?? none,
  } as unknown as Parameters<typeof followSession>[0];
}

describe("followSession", () => {
  it("coalesces many streamed deltas into one commit with the concatenated text", async () => {
    const h = harness();
    const records = Array.from({ length: 50 }, (_, index) => event(index + 1, `${index},`));
    const streamEvents = vi.fn(() => stream(...records));
    const eventPage = page([]);
    await h.run(client({ streamEvents, eventPage }));
    expect(streamEvents).toHaveBeenCalledWith(RUN, 0, expect.anything());
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].events).toHaveLength(50);
    expect(h.commits[0].text).toBe(records.map((_, index) => `${index},`).join(""));
    expect(h.live[0]).toBe("Connected");
  });

  it("commits once per frame when a frame fires between records", async () => {
    const h = harness();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    async function* gated() { yield event(1, "a"); yield event(2, "b"); await gate; yield event(3, "c"); }
    const done = h.run(client({ streamEvents: () => gated() }));
    await vi.waitFor(() => expect(h.frames.size).toBe(1));
    [...h.frames.values()][0]();
    expect(h.commits.map((commit) => commit.text)).toEqual(["ab"]);
    release();
    await done;
    expect(h.commits.map((commit) => commit.text)).toEqual(["ab", "abc"]);
  });

  it("falls back to paging from the committed cursor on a 429 and backs the stream off", async () => {
    const h = harness();
    const streamEvents = vi.fn(() => stream(new ApiError(429, "Too many event streams.")));
    const eventPage = page([event(1, "x")]);
    await h.run(client({ streamEvents, eventPage }));
    expect(h.live.some((text) => text.startsWith("Reconnecting · replay will resume from sequence 0 ·"))).toBe(true);
    expect(eventPage).toHaveBeenCalledWith(RUN, 0, undefined, expect.anything());
    expect(h.commits[0].events.map((record) => record.sequence)).toEqual([1]);
  });

  it("does not retry the stream until the 2500 ms backoff has elapsed", async () => {
    const h = harness();
    const streamEvents = vi.fn(() => stream(new Error("offline")));
    await h.run(client({ streamEvents }), 3);
    expect(streamEvents).toHaveBeenCalledTimes(1);
    h.advance(2500);
    const resumed = vi.fn(() => stream());
    const again = harness();
    again.advance(2500);
    await again.run(client({ streamEvents: resumed }), 1);
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it("flushes records received before a mid-stream failure, without loss or duplication", async () => {
    const h = harness();
    const streamEvents = vi.fn(() => stream(event(1, "a"), event(2, "b"), new Error("network down")));
    const eventPage = vi.fn(async (_run: string, after: number) => (after === 2 ? [event(3, "c")] : []));
    await h.run(client({ streamEvents, eventPage }), 1);
    expect(h.commits[0].events.map((record) => record.sequence)).toEqual([1, 2]);
    expect(eventPage).toHaveBeenCalledWith(RUN, 2, undefined, expect.anything());
    expect(h.commits[1].events.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(h.commits[1].text).toBe("abc");
    expect(h.live.some((text) => text.includes("resume from sequence 2"))).toBe(true);
  });

  it("flushes at a normal end and pages settled runs at 5000 ms without streaming", async () => {
    const h = harness();
    const streamEvents = vi.fn(() => {
      h.state.current = "completed" as RunState;
      return stream(event(1, "done"));
    });
    await h.run(client({ streamEvents }));
    expect(h.commits).toHaveLength(1);
    expect(h.waits).toEqual([5000]);

    const settled = harness({ state: "completed" as RunState });
    const unused = vi.fn(() => stream());
    await settled.run(client({ streamEvents: unused }));
    expect(unused).not.toHaveBeenCalled();
    expect(settled.waits).toEqual([5000]);
  });

  it("treats a non-contiguous record as a stream failure and never commits it", async () => {
    const h = harness();
    const streamEvents = vi.fn(() => stream(event(1, "a"), event(3, "gap")));
    await h.run(client({ streamEvents }));
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].events.map((record) => record.sequence)).toEqual([1]);
    expect(h.live.some((text) => text.startsWith("Reconnecting"))).toBe(true);
  });

  it("falls back when a frame commit fails validation", async () => {
    const h = harness();
    const duplicate = { ...event(2, "b"), event_id: `e${RUN}-1` };
    const streamEvents = vi.fn(() => stream(event(1, "a"), duplicate));
    await h.run(client({ streamEvents }));
    expect(h.commits).toHaveLength(0);
    expect(h.live.some((text) => text.startsWith("Reconnecting"))).toBe(true);
  });

  it("keeps reporting candidate activity while streaming a workflow", async () => {
    const h = harness({ workflow: true });
    const candidate = vi.fn(async () => ({ active: true }));
    await h.run(client({ streamEvents: () => stream(event(1, "a")), candidate }));
    expect(candidate).toHaveBeenCalled();
    expect(h.candidates).toContain(true);
  });

  it("starts with the stream from a resumed cursor", async () => {
    const h = harness();
    const streamEvents = vi.fn()
      .mockImplementationOnce(() => stream(event(1, "a")))
      .mockImplementation(() => stream(event(2, "b")));
    await h.run(client({ streamEvents }), 2);
    expect(streamEvents).toHaveBeenNthCalledWith(2, RUN, 1, expect.anything());
  });

  it("stops committing and reporting once aborted", async () => {
    const h = harness();
    async function* aborting() { yield event(1, "a"); h.controller.abort(); yield event(2, "b"); }
    await h.run(client({ streamEvents: () => aborting() }), 99);
    expect(h.commits).toHaveLength(0);
    expect(h.frames.size).toBe(0);
  });

  it("keeps the polling cadence of 0, 700, 5000 and 2500 ms", async () => {
    const polling = harness({ state: "completed" as RunState });
    const eventPage = vi.fn()
      .mockResolvedValueOnce([event(1, "a")])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([]);
    await polling.run(client({ eventPage }), 4);
    expect(polling.waits).toEqual([0, 5000, 2500, 5000]);

    const active = harness({ state: "running" as RunState });
    active.advance(0);
    const unsettled = vi.fn(() => stream(new Error("no stream")));
    await active.run(client({ streamEvents: unsettled }), 1);
    expect(active.waits).toEqual([700]);
  });
});
