import { useEffect, useRef, useState } from "react";
import { LuunaClient } from "@luuna/api-client";
import type { Health, RunRecord } from "@luuna/api-client";
import { sameRuns } from "../workflow-state";
import { actionFailure, describeFailure } from "../failures";
import { ensureLocalRuntime, nativeDesktop } from "../native-runtime";
import { HISTORY_LIMIT, historySelection, pause, watchRuns } from "./runtime";

/**
 * The connection to the runtime and its run history: the one place the client holds its token
 * (in memory only, never in browser storage), follows outages and recoveries, and pages the
 * history. A recovery bumps `connectionEpoch` so every view reloads authoritative state.
 */
export function useRuntime() {
  const [url, setUrl] = useState("http://127.0.0.1:4242");
  const [token, setToken] = useState("");
  const [client, setClient] = useState<LuunaClient | null>(null);
  const [reachable, setReachable] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("Disconnected");
  const [refresh, setRefresh] = useState(0);
  // A lost runtime is an outage, not an action failure: it is shown beside the content and clears
  // itself when the runtime answers again.
  const [outage, setOutage] = useState("");
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [nativeStartup, setNativeStartup] = useState(0);
  const [historyPages, setHistoryPages] = useState<string[]>([]);
  const native = nativeDesktop();
  const outageRef = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const historyBefore = historyPages.at(-1);

  useEffect(() => () => operation.current?.abort(), []);

  /** Runs an action as the window's one operation; a later one or a disconnect aborts it. */
  async function perform(action: (signal: AbortSignal) => Promise<void>, failed: (failure: unknown) => string) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failed(failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  /** Adopts a client that answered: its health, its first history page, and live status. */
  async function adopt(next: LuunaClient, signal: AbortSignal, address?: string) {
    const [status, saved] = await Promise.all([next.health(signal), next.listRuns(signal, { limit: HISTORY_LIMIT })]);
    if (signal.aborted) return;
    if (address) setUrl(address);
    setHealth(status);
    setRuns(saved);
    setSelected(saved[0]?.id ?? null);
    setHistoryPages([]);
    setClient(next);
    setReachable(true);
    setLive("Connected");
    setToken("");
  }

  useEffect(() => {
    if (!native) return;
    setLive("Starting local runtime…");
    void perform(async (signal) => {
      const connection = await ensureLocalRuntime();
      if (!signal.aborted) await adopt(new LuunaClient(connection.url, connection.token), signal, connection.url);
    }, (failure) => actionFailure("Local startup", failure));
    return () => operation.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, nativeStartup]);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    void watchRuns(client, controller.signal, {
      listed: (next) => {
        setReachable(true);
        if (outageRef.current) {
          outageRef.current = false;
          setOutage("");
          setConnectionEpoch((value) => value + 1);
        }
        // An unchanged listing keeps its identity, so the views do not re-render.
        setRuns((previous) => sameRuns(previous, next) ? previous : next);
        setSelected((id) => historySelection(id, next));
      },
      outage: (failure) => {
        setReachable(false);
        outageRef.current = true;
        setOutage(describeFailure(failure));
      },
      // A restarted runtime with another token: show the connect page, not "reconnecting".
      rejected: (failure) => {
        disconnect();
        setError(actionFailure("Connection", failure));
      },
    }, pause, historyBefore);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, refresh, historyBefore]);

  function connect() {
    void perform((signal) => adopt(new LuunaClient(url, token.trim()), signal), (failure) => actionFailure("Connection", failure));
  }

  function disconnect() {
    operation.current?.abort();
    setClient(null);
    setReachable(false);
    outageRef.current = false;
    setOutage("");
    setHealth(null);
    setToken("");
    setHistoryPages([]);
    setRuns([]);
    setSelected(null);
    setError("");
    setBusy(false);
    setLive("Disconnected");
  }

  /** An orderly stop (ADR 0010): runs, candidates and worktrees stay durable; Luuna reconnects when it starts again. */
  function stopRuntime() {
    if (client) void perform(async (signal) => { await client.shutdown(signal); }, (failure) => actionFailure("Shutdown", failure));
  }

  return {
    url, setUrl, token, setToken, client, reachable, health, runs, setRuns, selected, setSelected,
    error, setError, busy, live, setLive, refresh, outage, connectionEpoch, native,
    connectionState: client ? reachable ? "connected" as const : "reconnecting" as const : "offline" as const,
    connect, disconnect, stopRuntime, perform,
    startNative: () => setNativeStartup((value) => value + 1),
    reload: () => setRefresh((value) => value + 1),
    history: {
      newer: historyPages.length > 0,
      showNewer: () => setHistoryPages((pages) => pages.slice(0, -1)),
      showOlder: (before: string) => setHistoryPages((pages) => [...pages, before]),
      reset: () => setHistoryPages([]),
    },
  };
}

export type Runtime = ReturnType<typeof useRuntime>;
