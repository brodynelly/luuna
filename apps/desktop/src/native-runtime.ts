import { invoke, isTauri } from "@tauri-apps/api/core";

export const nativeDesktop = () => isTauri();
export interface LocalConnection { url: string; token: string }
let pending: Promise<LocalConnection> | undefined;

/** Share concurrent StrictMode startup calls; retain no token after settlement. */
export function ensureLocalRuntime(): Promise<LocalConnection> {
  if (!nativeDesktop()) return Promise.reject(new Error("Open the native desktop app for automatic startup."));
  if (!pending) {
    pending = invoke<LocalConnection>("ensure_local_runtime")
      .catch((failure: unknown) => {
        throw failure instanceof Error ? failure : new Error(typeof failure === "string" ? failure : "Local runtime startup failed.");
      })
      .finally(() => { pending = undefined; });
  }
  return pending;
}
