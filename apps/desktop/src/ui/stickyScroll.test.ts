import { describe, expect, it } from "vitest";
import { createStickyScroll } from "./stickyScroll";

/** A scroll surface that logs every read and write, plus a manual frame queue and clock. */
function rig(options: { duration?: number; threshold?: number; height?: number; client?: number } = {}) {
  const log: string[] = [];
  const state = { top: 0, height: options.height ?? 1000, client: options.client ?? 200 };
  const surface = {
    get scrollTop() { log.push("read:top"); return state.top; },
    set scrollTop(value: number) { log.push("write"); state.top = value; },
    get scrollHeight() { log.push("read:height"); return state.height; },
    get clientHeight() { log.push("read:client"); return state.client; },
  };
  let clock = 0;
  let nextHandle = 1;
  const queue = new Map<number, () => void>();
  const tokens = { durationMs: options.duration ?? 160, thresholdPx: options.threshold ?? 48 };
  const sticky = createStickyScroll(surface, {
    requestFrame: (callback) => { const id = nextHandle++; queue.set(id, callback); return id; },
    cancelFrame: (id) => { queue.delete(id); },
    now: () => clock,
    devicePixelRatio: () => 1,
    readTokens: () => tokens,
  });
  function frame(): void {
    clock += 16;
    const pending = [...queue.values()];
    queue.clear();
    for (const callback of pending) callback();
  }
  function frames(limit = 200): number {
    let count = 0;
    while (queue.size && count < limit) { frame(); count += 1; }
    return count;
  }
  const bottom = () => state.height - state.client;
  return { sticky, state, log, queue, tokens, frame, frames, bottom };
}

/** Jumps through the first fill so later growth glides. */
function filled(options?: Parameters<typeof rig>[0]) {
  const r = rig(options);
  r.sticky.contentChanged();
  r.log.length = 0;
  return r;
}

describe("createStickyScroll", () => {
  it("jumps instantly for the first fill, without frames", () => {
    const r = rig();
    r.sticky.contentChanged();
    expect(r.state.top).toBe(r.bottom());
    expect(r.queue.size).toBe(0);
  });

  it("glides to the new bottom when content grows while pinned", () => {
    const r = filled();
    r.state.top = r.bottom();
    r.state.height += 300;
    r.sticky.contentChanged();
    expect(r.queue.size).toBe(1);
    r.frame();
    expect(r.state.top).toBeGreaterThan(800);
    expect(r.state.top).toBeLessThan(r.bottom());
    r.frames();
    expect(r.state.top).toBe(r.bottom());
    expect(r.queue.size).toBe(0);
  });

  it("reads before it writes and writes once per frame", () => {
    const r = filled();
    r.state.top = r.bottom();
    r.state.height += 300;
    r.sticky.contentChanged();
    r.log.length = 0;
    let frames = 0;
    while (r.queue.size) {
      const before = r.log.length;
      r.frame();
      frames += 1;
      const entries = r.log.slice(before);
      const firstWrite = entries.indexOf("write");
      expect(entries.filter((entry) => entry === "write")).toHaveLength(1);
      expect(entries.slice(firstWrite + 1).some((entry) => entry.startsWith("read"))).toBe(false);
    }
    expect(frames).toBeGreaterThan(2);
  });

  it("is instant with no frames when the duration is 0", () => {
    const r = filled({ duration: 0 });
    r.state.height += 300;
    r.sticky.contentChanged();
    expect(r.state.top).toBe(r.bottom());
    expect(r.queue.size).toBe(0);
  });

  it("cancels the glide on user intent and writes nothing more", () => {
    const r = filled();
    r.state.top = r.bottom();
    r.state.height += 300;
    r.sticky.contentChanged();
    r.frame();
    r.sticky.userIntent();
    expect(r.queue.size).toBe(0);
    r.log.length = 0;
    r.frame();
    expect(r.log).toEqual([]);
  });

  it("stops following when scrolled away and re-pins when back at the bottom", () => {
    const r = filled();
    r.state.top = 300;
    r.sticky.userIntent();
    r.sticky.scrolled();
    expect(r.sticky.isPinned()).toBe(false);
    r.state.height += 300;
    r.log.length = 0;
    r.sticky.contentChanged();
    expect(r.log).toEqual([]);
    expect(r.queue.size).toBe(0);
    r.state.top = r.bottom() - 10;
    r.sticky.scrolled();
    expect(r.sticky.isPinned()).toBe(true);
    r.state.height += 300;
    r.sticky.contentChanged();
    expect(r.queue.size).toBe(1);
  });

  it("does not unpin when scrollTop drops mid-glide without user intent (anchoring)", () => {
    const r = filled();
    r.state.top = r.bottom();
    r.state.height += 300;
    r.sticky.contentChanged();
    r.frame();
    r.state.top -= 40;
    r.sticky.scrolled();
    expect(r.sticky.isPinned()).toBe(true);
  });

  it("stops without fighting when scrollTop changed externally by more than 1 px", () => {
    const r = filled();
    r.state.top = r.bottom();
    r.state.height += 300;
    r.sticky.contentChanged();
    r.frame();
    r.state.top -= 40;
    r.log.length = 0;
    r.frame();
    expect(r.log).not.toContain("write");
    expect(r.queue.size).toBe(0);
  });

  it("stops writing when disabled, and re-enabling re-pins and jumps", () => {
    const r = filled();
    r.sticky.setEnabled(false);
    r.state.height += 300;
    r.log.length = 0;
    r.sticky.contentChanged();
    expect(r.log).toEqual([]);
    r.state.top = 0;
    r.sticky.setEnabled(true);
    expect(r.sticky.isPinned()).toBe(true);
    expect(r.state.top).toBe(r.bottom());
    expect(r.queue.size).toBe(0);
  });

  it("cancels the pending frame on dispose", () => {
    const r = filled();
    r.state.top = r.bottom();
    r.state.height += 300;
    r.sticky.contentChanged();
    expect(r.queue.size).toBe(1);
    r.sticky.dispose();
    expect(r.queue.size).toBe(0);
  });

  it("jumps again after reset", () => {
    const r = filled();
    r.sticky.reset();
    r.state.height += 300;
    r.sticky.contentChanged();
    expect(r.state.top).toBe(r.bottom());
    expect(r.queue.size).toBe(0);
  });

  it("does not write when the content is shorter than the region", () => {
    const r = rig({ height: 100, client: 200 });
    r.sticky.contentChanged();
    expect(r.log).not.toContain("write");
  });
});
