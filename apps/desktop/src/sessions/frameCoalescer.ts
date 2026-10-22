/** Schedules one callback at the next display frame; the handle is opaque to the coalescer. */
export type FrameScheduler = { request(callback: () => void): unknown; cancel(handle: unknown): void };

/** requestAnimationFrame when the WebView has it; a 16 ms timer elsewhere (Node, tests). */
export function animationFrameScheduler(): FrameScheduler {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  if (typeof raf === "function" && typeof caf === "function") {
    return { request: (callback) => raf.call(globalThis, () => callback()), cancel: (handle) => caf.call(globalThis, handle as number) };
  }
  return { request: (callback) => setTimeout(callback, 16), cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
}

export type FrameCoalescer<T> = { push(item: T): void; flush(): void; cancel(): void; readonly pending: number };

/**
 * Collects items and hands everything that arrived within one frame to `commit` as one batch, so
 * rendering follows display frames instead of network arrival. `flush` commits synchronously;
 * `cancel` drops the pending frame and disables the coalescer for good.
 */
export function createFrameCoalescer<T>(options: {
  scheduler: FrameScheduler;
  commit: (batch: T[]) => void;
  maxPending?: number;
  onError?: (error: unknown) => void;
}): FrameCoalescer<T> {
  const maxPending = options.maxPending ?? 1000;
  let batch: T[] = [];
  let handle: unknown;
  let scheduled = false;
  let cancelled = false;

  const unschedule = () => {
    if (!scheduled) return;
    scheduled = false;
    options.scheduler.cancel(handle);
  };
  const flush = () => {
    if (cancelled) return;
    unschedule();
    if (batch.length === 0) return;
    const ready = batch;
    batch = [];
    try {
      options.commit(ready);
    } catch (error) {
      options.onError?.(error);
    }
  };
  return {
    push(item) {
      if (cancelled) return;
      batch.push(item);
      if (batch.length >= maxPending) { flush(); return; }
      if (scheduled) return;
      scheduled = true;
      handle = options.scheduler.request(() => { scheduled = false; flush(); });
    },
    flush,
    cancel() {
      if (cancelled) return;
      unschedule();
      cancelled = true;
      batch = [];
    },
    get pending() { return batch.length; },
  };
}
