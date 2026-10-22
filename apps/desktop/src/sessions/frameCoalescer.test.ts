import { describe, expect, it, vi } from "vitest";
import { animationFrameScheduler, createFrameCoalescer } from "./frameCoalescer";
import type { FrameScheduler } from "./frameCoalescer";

function manualScheduler() {
  const frames = new Map<number, () => void>();
  let next = 0;
  const scheduler: FrameScheduler = {
    request: (callback) => { frames.set(++next, callback); return next; },
    cancel: (handle) => { frames.delete(handle as number); },
  };
  return { scheduler, frames, run: () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } } };
}

describe("frame coalescer", () => {
  it("commits everything pushed before a frame once, in order", () => {
    const { scheduler, frames, run } = manualScheduler();
    const commit = vi.fn();
    const coalescer = createFrameCoalescer<number>({ scheduler, commit });
    [1, 2, 3].forEach((item) => coalescer.push(item));
    expect(frames.size).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    run();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([1, 2, 3]);
    coalescer.push(4);
    run();
    expect(commit).toHaveBeenLastCalledWith([4]);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("flushes synchronously and cancels the scheduled frame; an empty flush is a no-op", () => {
    const { scheduler, frames, run } = manualScheduler();
    const commit = vi.fn();
    const coalescer = createFrameCoalescer<number>({ scheduler, commit });
    coalescer.flush();
    expect(commit).not.toHaveBeenCalled();
    coalescer.push(1);
    coalescer.flush();
    expect(commit).toHaveBeenCalledWith([1]);
    expect(frames.size).toBe(0);
    run();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("stops all commits after cancel, including a scheduled frame", () => {
    const { scheduler, frames, run } = manualScheduler();
    const commit = vi.fn();
    const coalescer = createFrameCoalescer<number>({ scheduler, commit });
    coalescer.push(1);
    coalescer.cancel();
    coalescer.cancel();
    expect(frames.size).toBe(0);
    coalescer.push(2);
    coalescer.flush();
    run();
    expect(commit).not.toHaveBeenCalled();
    expect(coalescer.pending).toBe(0);
  });

  it("flushes synchronously when maxPending is reached", () => {
    const { scheduler } = manualScheduler();
    const commit = vi.fn();
    const coalescer = createFrameCoalescer<number>({ scheduler, commit, maxPending: 3 });
    coalescer.push(1);
    coalescer.push(2);
    expect(commit).not.toHaveBeenCalled();
    coalescer.push(3);
    expect(commit).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("routes a throwing commit to onError and drops the batch", () => {
    const { scheduler } = manualScheduler();
    const failure = new Error("bad batch");
    const onError = vi.fn();
    const coalescer = createFrameCoalescer<number>({ scheduler, commit: () => { throw failure; }, onError });
    coalescer.push(1);
    coalescer.flush();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(coalescer.pending).toBe(0);
  });

  it("the default scheduler works without requestAnimationFrame", async () => {
    vi.useFakeTimers();
    try {
      const commit = vi.fn();
      const coalescer = createFrameCoalescer<number>({ scheduler: animationFrameScheduler(), commit });
      coalescer.push(1);
      coalescer.push(2);
      await vi.advanceTimersByTimeAsync(16);
      expect(commit).toHaveBeenCalledWith([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });
});
