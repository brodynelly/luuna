import { describe, expect, test, vi } from "vitest";
import { changeView, viewMotion } from "./viewTransition";
import type { TransitionHandle, TransitionHost } from "./viewTransition";

function handle() {
  return { finished: Promise.resolve(), ready: Promise.resolve(), skipTransition: vi.fn<() => void>() } satisfies TransitionHandle;
}
function host() {
  const start = vi.fn((update: () => void) => { update(); return handle(); });
  return { startViewTransition: start } satisfies TransitionHost;
}

describe("viewMotion", () => {
  const api = host();
  test("reduced motion beats support", () => expect(viewMotion(api, true, true)).toBe("none"));
  test("native needs the function and the CSS", () => {
    expect(viewMotion(api, true, false)).toBe("native");
    expect(viewMotion(api, false, false)).toBe("css");
    expect(viewMotion({}, true, false)).toBe("css");
    expect(viewMotion(undefined, true, false)).toBe("css");
  });
});

describe("changeView", () => {
  test.each(["css", "none"] as const)("%s updates once and never starts a transition", (motion) => {
    const target = host();
    const update = vi.fn();
    expect(changeView(target, motion, update)).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    expect(target.startViewTransition).not.toHaveBeenCalled();
  });
  test("native starts one transition, updates once and skips the previous one", () => {
    const target = host();
    const update = vi.fn();
    const previous = handle();
    expect(changeView(target, "native", update, previous)).not.toBeNull();
    expect(target.startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(previous.skipTransition).toHaveBeenCalledTimes(1);
  });
  test("a throwing API still updates once", () => {
    const update = vi.fn();
    expect(changeView({ startViewTransition: () => { throw new Error("no"); } }, "native", update)).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });
  test("a hidden document bypasses the API", () => {
    const target = { ...host(), hidden: true };
    const update = vi.fn();
    expect(changeView(target, "native", update)).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    expect(target.startViewTransition).not.toHaveBeenCalled();
  });
  test("a missing API updates directly", () => {
    const update = vi.fn();
    expect(changeView({}, "native", update)).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });
  test("a rejected finished or ready promise is handled", () => {
    const caught = vi.fn();
    const watched = { catch: caught } as unknown as Promise<unknown>;
    changeView({ startViewTransition: (update) => { update(); return { finished: watched, ready: watched, skipTransition: vi.fn<() => void>() }; } }, "native", () => undefined);
    expect(caught).toHaveBeenCalledTimes(2);
  });
});
