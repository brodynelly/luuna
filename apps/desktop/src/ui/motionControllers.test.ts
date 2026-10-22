import { describe, expect, it } from "vitest";
import { createCountUp, createGlowTracker, createRevealController } from "./motionControllers";

/** A manual frame queue and clock, like stickyScroll.test.ts. */
function clockRig() {
  let clock = 0;
  let nextHandle = 1;
  const queue = new Map<number, () => void>();
  const requested: number[] = [];
  const frames = {
    requestFrame: (callback: () => void) => { const id = nextHandle++; queue.set(id, callback); requested.push(id); return id; },
    cancelFrame: (id: number) => { queue.delete(id); },
    now: () => clock,
  };
  function frame(ms = 16): void {
    clock += ms;
    const pending = [...queue.values()];
    queue.clear();
    for (const callback of pending) callback();
  }
  return { frames, queue, requested, frame, advance: (ms: number) => { clock += ms; } };
}

describe("createCountUp", () => {
  const format = (value: number) => `#${value}`;

  it("writes monotonically increasing values and finishes exactly on format(value)", () => {
    const rig = clockRig();
    const node = { nodeValue: "#1234" as string | null };
    createCountUp({ node, value: 1234, format, durationMs: 800, ...rig.frames });
    expect(node.nodeValue).toBe("#0");
    const seen: number[] = [];
    for (let guard = 0; rig.queue.size && guard < 200; guard++) {
      rig.frame();
      seen.push(Number(node.nodeValue!.slice(1)));
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((value, index) => index === 0 || value >= seen[index - 1]!)).toBe(true);
    expect(node.nodeValue).toBe("#1234");
  });

  it("keeps the target's decimal places", () => {
    const rig = clockRig();
    const node = { nodeValue: "" as string | null };
    createCountUp({ node, value: 12.5, format: String, durationMs: 800, ...rig.frames });
    rig.frame(200);
    expect(/^\d+(\.\d)?$/.test(node.nodeValue!)).toBe(true);
    rig.frame(2000);
    expect(node.nodeValue).toBe("12.5");
  });

  it("duration 0 writes the final value once and requests no frame", () => {
    const rig = clockRig();
    const node = { nodeValue: "x" as string | null };
    createCountUp({ node, value: 7, format, durationMs: 0, ...rig.frames });
    expect(node.nodeValue).toBe("#7");
    expect(rig.requested).toEqual([]);
  });

  it("dispose cancels the pending frame and stops further writes", () => {
    const rig = clockRig();
    const node = { nodeValue: "" as string | null };
    const run = createCountUp({ node, value: 100, format, durationMs: 800, ...rig.frames });
    rig.frame();
    const before = node.nodeValue;
    run.dispose();
    expect(rig.queue.size).toBe(0);
    rig.frame(5000);
    expect(node.nodeValue).toBe(before);
  });
});

describe("createGlowTracker", () => {
  function target() {
    const log: string[] = [];
    const listeners = new Map<string, (event: never) => void>();
    let rectReads = 0;
    return {
      log, listeners, reads: () => rectReads,
      element: {
        getBoundingClientRect: () => { rectReads += 1; return { left: 100, top: 50 }; },
        style: { setProperty: (name: string, value: string) => { log.push(`${name}=${value}`); } },
        addEventListener: (type: string, listener: (event: never) => void) => { listeners.set(type, listener); },
        removeEventListener: (type: string) => { listeners.delete(type); },
      },
    };
  }
  const move = (t: ReturnType<typeof target>, x: number, y: number) => (t.listeners.get("pointermove") as unknown as (event: { clientX: number; clientY: number }) => void)({ clientX: x, clientY: y });

  it("coalesces many moves into one write per frame, relative to the rect read on enter", () => {
    const rig = clockRig();
    const t = target();
    createGlowTracker(t.element, rig.frames);
    (t.listeners.get("pointerenter") as unknown as () => void)();
    for (let index = 0; index < 50; index++) move(t, 110 + index, 80);
    expect(t.log).toEqual([]);
    rig.frame();
    expect(t.log).toEqual(["--mx=59px", "--my=30px"]);
    expect(t.reads()).toBe(1);
    move(t, 120, 70);
    rig.frame();
    expect(t.log.slice(2)).toEqual(["--mx=20px", "--my=20px"]);
    expect(t.reads()).toBe(1);
  });

  it("re-reads the rect on resize only, and removes its listeners on dispose", () => {
    const rig = clockRig();
    const t = target();
    let resize: (() => void) | undefined;
    const run = createGlowTracker(t.element, rig.frames, { add: (listener) => { resize = listener; }, remove: () => { resize = undefined; } });
    resize!();
    expect(t.reads()).toBe(1);
    move(t, 150, 90);
    run.dispose();
    expect([...t.listeners.keys()]).toEqual([]);
    expect(resize).toBeUndefined();
    expect(rig.queue.size).toBe(0);
    rig.frame();
    expect(t.log).toEqual([]);
  });
});

describe("createRevealController", () => {
  function parent(count: number) {
    const written: Array<[number, string]> = [];
    const attributes: string[] = [];
    const children = Array.from({ length: count }, (_, index) => ({ style: { setProperty: (name: string, value: string) => { if (name === "--i") written.push([index, value]); } } }));
    return { written, attributes, node: { children, setAttribute: (name: string) => { attributes.push(name); } } };
  }
  function timers() {
    const pending = new Map<number, { callback: () => void; ms: number }>();
    let next = 1;
    return { pending, options: { stepMs: 35, durationMs: 340, setTimer: (callback: () => void, ms: number) => { pending.set(next, { callback, ms }); return next++; }, clearTimer: (handle: number) => { pending.delete(handle); } } };
  }

  it("numbers children with --i capped at 10 and marks revealed after count x step + duration", () => {
    const p = parent(14);
    const t = timers();
    createRevealController(p.node, t.options);
    expect(p.written.map(([, value]) => value)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "10", "10", "10"]);
    const [timer] = [...t.pending.values()];
    expect(timer!.ms).toBe(10 * 35 + 340);
    expect(p.attributes).toEqual([]);
    timer!.callback();
    expect(p.attributes).toEqual(["data-revealed"]);
  });

  it("never touches children added afterwards, and dispose clears the timer", () => {
    const p = parent(2);
    const t = timers();
    const run = createRevealController(p.node, t.options);
    p.node.children.push({ style: { setProperty: () => { throw new Error("late child touched"); } } });
    run.dispose();
    expect(t.pending.size).toBe(0);
    expect(p.written.length).toBe(2);
  });

  it("an empty parent is revealed after the bare duration", () => {
    const p = parent(0);
    const t = timers();
    createRevealController(p.node, t.options);
    expect([...t.pending.values()][0]!.ms).toBe(340);
  });
});
