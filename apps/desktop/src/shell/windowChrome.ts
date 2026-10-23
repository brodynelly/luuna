/**
 * Platform glue for the Windows title bar (ADR 0036). The library's `WindowControls` is presentational; this
 * file decides whether the app is the Windows desktop window and runs the window commands. The Tauri window
 * API is imported only when the first command or state read is needed, so the browser build, macOS, Linux and
 * the tests never load it.
 */

type PlatformSource = { userAgent?: string; userAgentData?: { platform?: string } };

/** True on Windows, from the client hint when the browser offers one and the user agent otherwise. */
export function windowsPlatform(source: PlatformSource | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  return /windows/i.test(source?.userAgentData?.platform || source?.userAgent || "");
}

/** Tauri injects `__TAURI_INTERNALS__` into its web view; a plain browser has none. */
export function insideTauri(host: object | undefined = typeof window === "undefined" ? undefined : window): boolean {
  return host !== undefined && "__TAURI_INTERNALS__" in host;
}

/** Only the Tauri window on Windows draws its own title bar; every other target keeps what it has. */
export function usesCustomTitleBar(host?: object, source?: PlatformSource): boolean {
  return insideTauri(host) && windowsPlatform(source);
}

/** The slice of Tauri's window handle the title bar uses. */
export interface WindowHandle {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
}

export type WindowLoader = () => Promise<WindowHandle>;

const loadCurrentWindow: WindowLoader = () => import("@tauri-apps/api/window").then((module) => module.getCurrentWindow());

// A refused or failed window command leaves the window as it is; there is nothing for the page to report.
const ignore = () => undefined;

export interface WindowCommands {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
}

/** The window commands behind the controls; the handle loads on first use and is shared afterwards. */
export function windowCommands(load: WindowLoader = loadCurrentWindow): WindowCommands {
  let handle: Promise<WindowHandle> | undefined;
  const current = () => (handle ??= load());
  return {
    minimize: () => { current().then((window) => window.minimize()).catch(ignore); },
    toggleMaximize: () => { current().then((window) => window.toggleMaximize()).catch(ignore); },
    close: () => { current().then((window) => window.close()).catch(ignore); },
    isMaximized: () => current().then((window) => window.isMaximized()).catch(() => false),
  };
}

interface ResizeSource {
  addEventListener(type: "resize", listener: () => void): void;
  removeEventListener(type: "resize", listener: () => void): void;
}

/**
 * Reports the maximized state now and again after each resize (at most one read per frame). A DOM resize
 * covers the maximize button, a double-click on the drag region, Win+Up and Snap, so the page needs no
 * event permission. Returns the stop function.
 */
export function watchMaximized(
  commands: Pick<WindowCommands, "isMaximized">,
  onChange: (maximized: boolean) => void,
  source: ResizeSource = window,
  frame: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
): () => void {
  let live = true;
  let pending = 0;
  const read = () => { commands.isMaximized().then((value) => { if (live) onChange(value); }, ignore); };
  const resized = () => {
    if (pending) return;
    pending = frame(() => { pending = 0; read(); });
  };
  read();
  source.addEventListener("resize", resized);
  return () => {
    live = false;
    if (pending) cancel(pending);
    source.removeEventListener("resize", resized);
  };
}
