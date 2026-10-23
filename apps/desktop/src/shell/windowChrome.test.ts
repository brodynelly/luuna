import { describe, expect, test, vi } from "vitest";
import { insideTauri, usesCustomTitleBar, watchMaximized, windowCommands, windowsPlatform } from "./windowChrome";
import type { WindowHandle } from "./windowChrome";

const WINDOWS = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0" };
const MAC = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15" };
const LINUX = { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" };
const TAURI = { __TAURI_INTERNALS__: {} };

describe("detection", () => {
  test("reads Windows from the client hint first and the user agent otherwise", () => {
    expect(windowsPlatform(WINDOWS)).toBe(true);
    expect(windowsPlatform({ userAgent: MAC.userAgent, userAgentData: { platform: "Windows" } })).toBe(true);
    expect(windowsPlatform({ userAgent: WINDOWS.userAgent, userAgentData: { platform: "macOS" } })).toBe(false);
    expect(windowsPlatform(MAC)).toBe(false);
    expect(windowsPlatform(LINUX)).toBe(false);
    expect(windowsPlatform({})).toBe(false);
  });
  test("recognises the Tauri web view by its injected internals", () => {
    expect(insideTauri(TAURI)).toBe(true);
    expect(insideTauri({})).toBe(false);
  });
  test("only a Tauri window on Windows draws its own title bar", () => {
    expect(usesCustomTitleBar(TAURI, WINDOWS)).toBe(true);
    expect(usesCustomTitleBar({}, WINDOWS)).toBe(false);
    expect(usesCustomTitleBar(TAURI, MAC)).toBe(false);
    expect(usesCustomTitleBar(TAURI, LINUX)).toBe(false);
  });
});

function handle(overrides: Partial<WindowHandle> = {}): WindowHandle {
  return { minimize: vi.fn(async () => undefined), toggleMaximize: vi.fn(async () => undefined), close: vi.fn(async () => undefined), isMaximized: vi.fn(async () => false), ...overrides };
}

describe("window commands", () => {
  test("load the window handle lazily and once", async () => {
    const window = handle();
    const load = vi.fn(async () => window);
    const commands = windowCommands(load);
    expect(load).not.toHaveBeenCalled();
    commands.minimize();
    commands.toggleMaximize();
    commands.close();
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect(window.minimize).toHaveBeenCalledTimes(1);
    expect(window.toggleMaximize).toHaveBeenCalledTimes(1);
  });
  test("a refused command or a failed load changes nothing and throws nothing", async () => {
    const refusing = windowCommands(async () => handle({ close: vi.fn(async () => { throw new Error("denied"); }) }));
    expect(() => refusing.close()).not.toThrow();
    const broken = windowCommands(async () => { throw new Error("no window"); });
    expect(() => broken.minimize()).not.toThrow();
    await expect(broken.isMaximized()).resolves.toBe(false);
  });
});

describe("watchMaximized", () => {
  function setup(values: boolean[]) {
    const listeners = new Set<() => void>();
    const source = { addEventListener: (_: "resize", listener: () => void) => { listeners.add(listener); }, removeEventListener: (_: "resize", listener: () => void) => { listeners.delete(listener); } };
    const frames: Array<() => void> = [];
    const frame = (callback: () => void) => frames.push(callback);
    const cancel = vi.fn();
    const reads = [...values];
    const seen: boolean[] = [];
    const stop = watchMaximized({ isMaximized: async () => reads.shift() ?? false }, (value) => seen.push(value), source, frame, cancel);
    return { listeners, frames, seen, stop, cancel };
  }
  test("reads the initial state, then once per frame after resizes", async () => {
    const { listeners, frames, seen } = setup([false, true]);
    await vi.waitFor(() => expect(seen).toEqual([false]));
    for (const listener of listeners) { listener(); listener(); listener(); }
    expect(frames).toHaveLength(1);
    frames.shift()!();
    await vi.waitFor(() => expect(seen).toEqual([false, true]));
  });
  test("stops listening, cancels a pending frame and ignores a late read", async () => {
    const { listeners, frames, seen, stop, cancel } = setup([false, true]);
    await vi.waitFor(() => expect(seen).toEqual([false]));
    for (const listener of listeners) listener();
    stop();
    expect(listeners.size).toBe(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    frames.shift()!();
    await Promise.resolve();
    expect(seen).toEqual([false]);
  });
});
