import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, EventWindow, LuunaClient, isTerminal } from "@luuna/api-client";
import type { EventEnvelope, Health, RunRecord, RunState } from "@luuna/api-client";
import { canCancel, sameRuns } from "./workflow-state";
import { Projects } from "./Projects";
import { actionFailure, describeFailure } from "./failures";
import { ensureLocalRuntime, nativeDesktop } from "./native-runtime";
import { StatusBadge } from "./design/StatusBadge";
import { connectionTone, runTone } from "./design/tone";

const message = describeFailure;
/** Session history shows the most recent runs; older ones stay in the runtime. */
const HISTORY_LIMIT = 200;
const ACTIVE_STATES: RunState[] = ["queued", "running", "implementing", "validating", "reviewing"];

/** Keep selection on the displayed history page so its controls and replay agree. */
export function historySelection(selected: string | null, runs: RunRecord[]): string | null {
  return runs.some((run) => run.id === selected) ? selected : runs[0]?.id ?? null;
}

/** A rejected token never recovers by waiting: the developer has to enter the current one. */
export function authenticationLost(failure: unknown): boolean {
  return failure instanceof ApiError && failure.status === 401;
}

/**
 * The announced session status: the connection and the run's state, so a screen reader hears
 * transitions rather than every replayed event sequence.
 */
export function sessionStatus(live: string, state: RunState): string {
  return live === "Connected" ? `Connected · session ${state.replace(/_/g, " ")}` : live;
}

/**
 * Lists runs until aborted. An outage is retried, because the runtime comes back by itself; a
 * rejected token ends the loop, because only the developer can supply the current one.
 */
export async function watchRuns(client: Pick<LuunaClient, "listRuns"> & Partial<Pick<LuunaClient, "runsPage">>, signal: AbortSignal, on: { listed: (runs: RunRecord[]) => void; outage: (failure: unknown) => void; rejected: (failure: unknown) => void }, wait: (milliseconds: number, signal: AbortSignal) => Promise<void> = pause, before?: string): Promise<void> {
  while (!signal.aborted) {
    try {
      // An older history page is a keyset page ending before the given run (ADR 0015).
      const next = before && client.runsPage ? await client.runsPage(before, undefined, signal) : await client.listRuns(signal, { limit: HISTORY_LIMIT });
      if (signal.aborted) return;
      on.listed(next);
      // Settled history is polled less often than a page with active work.
      await wait(next.some((run) => ACTIVE_STATES.includes(run.state)) ? 2000 : 5000, signal);
    } catch (failure) {
      if (signal.aborted) return;
      if (authenticationLost(failure)) { on.rejected(failure); return; }
      on.outage(failure);
      await wait(3000, signal).catch(() => undefined);
    }
  }
}

const ProjectPanel = memo(Projects);

const EventRow = memo(function EventRow({ event }: { event: EventEnvelope }) {
  const [open, setOpen] = useState(event.type.includes("error") || event.type === "run.failed");
  const payload = useMemo(() => open ? JSON.stringify(event.payload, null, 2) : "", [event, open]);
  return <li><details open={open} onToggle={(toggle) => setOpen(toggle.currentTarget.open)}><summary><span className="event-number">{event.sequence}</span><span>{event.type}</span><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString()}</time></summary>{open && <pre>{payload}</pre>}</details></li>;
});

const EventList = memo(function EventList({ events, client, runId }: { events: EventEnvelope[]; client: LuunaClient; runId: string }) {
  const [page, setPage] = useState<EventEnvelope[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const shown = page ?? events;
  const first = shown[0]?.sequence ?? 1;
  const last = shown.at(-1)?.sequence ?? 0;
  async function browse(earlier: boolean) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true); setError("");
    try {
      const result = await client.eventPage(runId, earlier ? 0 : last, earlier ? first : undefined, controller.signal);
      if (!controller.signal.aborted && result.length) setPage(result);
    } catch (failure) { if (!controller.signal.aborted) setError(message(failure)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <>
    {(first > 1 || page !== null) && <div className="panel-heading">
      <span className="meta">Events {first}–{last}</span>
      <button className="text-button" disabled={loading || first === 1} onClick={() => void browse(true)}>Earlier events</button>
      <button className="text-button" disabled={loading || last >= (events.at(-1)?.sequence ?? 0)} onClick={() => void browse(false)}>Later events</button>
      <button className="text-button" disabled={page === null} onClick={() => { operation.current?.abort(); setLoading(false); setPage(null); }}>Latest events</button>
    </div>}
    {error && <p role="alert">{error}<button className="text-button" onClick={() => setError("")}>Dismiss</button></p>}
    <ol className="events" aria-label="Durable session events" tabIndex={0}>{shown.map((event) => <EventRow key={event.event_id} event={event} />)}</ol>
  </>;
});

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** This development shell holds its token only in memory, never in browser storage. */
export function App() {
  const [url, setUrl] = useState("http://127.0.0.1:4242");
  const [token, setToken] = useState("");
  const [client, setClient] = useState<LuunaClient | null>(null);
  const [reachable, setReachable] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [candidateActive, setCandidateActive] = useState(false);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("Disconnected");
  const [refresh, setRefresh] = useState(0);
  // A lost runtime is an outage, not an action failure: it is shown next to the
  // connection state and clears itself when the runtime answers again. Each
  // recovery bumps the epoch so every panel reloads authoritative state.
  const [outage, setOutage] = useState("");
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [nativeStartup, setNativeStartup] = useState(0);
  const native = nativeDesktop();
  const outageRef = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const active = runs.find((run) => run.id === selected);
  const selectedWorkflow = active?.metadata.kind === "workflow";
  const [output, setOutput] = useState("");
  const [historyPages, setHistoryPages] = useState<string[]>([]);
  const historyBefore = historyPages.at(-1);
  const connectionState = client ? reachable ? "connected" : "reconnecting" : "offline";

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    if (!native) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setLive("Starting local runtime…");
    void (async () => {
      try {
        const connection = await ensureLocalRuntime();
        if (controller.signal.aborted) return;
        const next = new LuunaClient(connection.url, connection.token);
        const [status, saved] = await Promise.all([next.health(controller.signal), next.listRuns(controller.signal, { limit: HISTORY_LIMIT })]);
        if (controller.signal.aborted) return;
        setUrl(connection.url);
        setHealth(status);
        setRuns(saved);
        setSelected(saved[0]?.id ?? null);
        setHistoryPages([]);
      setClient(next);
        setReachable(true);
        setLive("Connected");
        setToken("");
      } catch (failure) {
        if (!controller.signal.aborted) setError(actionFailure("Local startup", failure));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
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
        // An unchanged listing keeps its identity, so the panels below do not re-render.
        setRuns((previous) => sameRuns(previous, next) ? previous : next);
        setSelected((id) => historySelection(id, next));
      },
      outage: (failure) => {
        setReachable(false);
        outageRef.current = true;
        setOutage(message(failure));
      },
      // A restarted runtime with another token: show the connection form, not "reconnecting".
      rejected: (failure) => {
        disconnect();
        setError(actionFailure("Connection", failure));
      },
    }, pause, historyBefore);
    return () => controller.abort();
  }, [client, refresh, historyBefore]);

  useEffect(() => {
    setEvents([]);
    setOutput("");
    setCandidateActive(false);
    if (!client || !selected) return;
    const controller = new AbortController();
    let cursor = 0;
    const replay = new EventWindow();
    const follow = async () => {
      while (!controller.signal.aborted) {
        try {
          // Authenticated cursor replay also repairs gaps after sleep or disconnection.
          const [incoming, candidate] = await Promise.all([
            client.eventPage(selected, cursor, undefined, controller.signal),
            selectedWorkflow ? client.candidate(selected, controller.signal) : Promise.resolve(null),
          ]);
          if (controller.signal.aborted) return;
          // A bounded window: the newest events and the assistant text only, with gaps rejected.
          if (incoming.length > 0) {
            setEvents(replay.append(incoming));
            setOutput(replay.text);
            cursor = replay.cursor;
          }
          setCandidateActive(candidate?.active ?? false);
          // Announced only when it changes: the connection, not every replayed sequence.
          setLive("Connected");
          // A page with events is followed by the next one at once; a settled run is still
          // followed (repair and re-validation continue on a failed workflow), just less often.
          const state = runsRef.current.find((run) => run.id === selected)?.state;
          const settled = state !== undefined && isTerminal(state) && !candidate?.active && incoming.length === 0;
          await pause(incoming.length > 0 ? 0 : settled ? 5000 : 700, controller.signal);
        } catch (failure) {
          if (controller.signal.aborted) return;
          setLive(`Reconnecting · replay will resume from sequence ${cursor} · ${message(failure)}`);
          await pause(2500, controller.signal).catch(() => undefined);
        }
      }
    };
    void follow();
    return () => controller.abort();
  }, [client, selected, selectedWorkflow, refresh]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const next = new LuunaClient(url, token.trim());
      const [status, saved] = await Promise.all([next.health(controller.signal), next.listRuns(controller.signal, { limit: HISTORY_LIMIT })]);
      if (controller.signal.aborted) return;
      setHealth(status);
      setRuns(saved);
      setSelected(saved[0]?.id ?? null);
      setHistoryPages([]);
      setClient(next);
      setReachable(true);
      setLive("Connected");
      setToken("");
    } catch (failure) {
      if (!controller.signal.aborted) setError(actionFailure("Connection", failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
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
    setEvents([]);
    setError("");
    setBusy(false);
    setLive("Disconnected");
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!client || !prompt.trim()) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const run = await client.startRun({
        prompt: prompt.trim(),
        ...(provider.trim() && { provider: provider.trim() }),
        ...(model.trim() && { model: model.trim() }),
      }, controller.signal);
      if (controller.signal.aborted) return;
      setHistoryPages([]);
      setRefresh((value) => value + 1);
      setRuns((previous) => [run, ...previous.filter((item) => item.id !== run.id)].slice(0, 200));
      setSelected(run.id);
      setPrompt("");
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function cancel() {
    if (!client || !active) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const run = await client.cancelRun(active.id, controller.signal);
      if (!controller.signal.aborted) setRuns((previous) => previous.map((item) => item.id === run.id ? run : item));
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="app">
    <a className="skip-link" href="#main">Skip to main content</a>
    <header className="topbar">
      <a className="wordmark" href="#main" aria-label="Luuna home"><svg className="wordmark-mark" viewBox="0 0 292 292" aria-hidden="true" focusable="false"><circle cx="146" cy="146" r="146" /><path d="M146 0a146 146 0 0 0 0 292z" /></svg> luuna</a>
      <span className="stage">Development foundation</span>
      <span className="connection" data-tone={connectionTone[connectionState]} role="status" aria-live="polite"><i className="tone-mark" aria-hidden="true" data-tone={connectionTone[connectionState]} />{client ? reachable ? "Local runtime connected" : "Reconnecting to runtime" : "Local runtime offline"}</span>
    </header>

    <main id="main" tabIndex={-1}>
      <div className="intro"><p className="eyebrow">Your local workbench</p><h1>A clear starting point.</h1><p>Connect to your runtime, launch a real Pi session, and follow the durable event record.</p></div>

      {error && <div className="error" role="alert">{error}<button className="text-button" onClick={() => setError("")}>Dismiss</button></div>}

      <section className="panel connection-panel" aria-labelledby="runtime-heading">
        <div className="connection-summary"><h2 id="runtime-heading">Runtime connection</h2><p className="meta">{client ? `${client.baseUrl} · Required Pi version ${health?.pi_version ?? "unknown"}` : native ? "Luuna starts your local runtime and connects automatically. Closing the app leaves your runtime running." : "Start the Rust service separately, then enter its local address and token."}</p></div>
        {client ? <button onClick={disconnect}>Disconnect</button> : <form onSubmit={(event) => void connect(event)} className="connection-form">
          <label>Service URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required spellCheck={false} /></label>
          <label>Service token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required placeholder="Session token" /></label>
          <button className="primary" disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
          <small>The token stays in memory and is cleared when you disconnect or reload.</small>
          {native && <button type="button" disabled={busy} onClick={() => setNativeStartup((value) => value + 1)}>{busy ? "Starting local runtime…" : "Connect automatically"}</button>}
        </form>}
        {client && outage && <p className="outage callout" data-tone="interrupted" role="status">{outage} Runs, candidates and worktrees are durable in the runtime; nothing is lost while this panel waits.</p>}
      </section>

      <ProjectPanel client={client} connectionEpoch={connectionEpoch} />

      <div className="workspace">
        <aside className="panel history" aria-labelledby="history-heading">
          <div className="panel-heading"><h2 id="history-heading">Session history</h2><button className="text-button" disabled={!client} onClick={() => setRefresh((value) => value + 1)}>Refresh</button></div>
          {runs.length ? <ul className="history-list">{runs.map((run) => <li key={run.id}><button className={`run-card ${selected === run.id ? "selected" : ""}`} onClick={() => setSelected(run.id)} aria-pressed={selected === run.id}>
            <span className="run-prompt">{run.metadata.kind === "baseline" ? `Baseline · ${String(run.metadata.repository_id ?? "")} · manifest r${String(run.metadata.manifest_revision ?? "?")}` : run.metadata.kind === "workflow" ? `Workflow · ${String(run.metadata.plan_id ?? "")} r${String(run.metadata.plan_revision ?? "?")}` : typeof run.metadata.prompt === "string" ? run.metadata.prompt : run.id}</span>
            <span className="run-meta"><StatusBadge tone={runTone[run.state]}>{run.state}</StatusBadge><time dateTime={run.created_at}>{date(run.created_at)}</time></span>
          </button></li>)}</ul> : <p className="empty">{client ? "No sessions yet. Start one to create a durable run record." : "Connect to see sessions saved by your runtime."}</p>}
          {client && <div className="panel-heading"><button disabled={!historyPages.length} onClick={() => setHistoryPages((pages) => pages.slice(0, -1))}>Newer sessions</button><button disabled={runs.length < 200} onClick={() => setHistoryPages((pages) => [...pages, runs[runs.length - 1].id])}>Older sessions</button></div>}
        </aside>

        <div className="main-column">
          <section className="panel start-panel" aria-labelledby="new-run-heading">
            <div className="panel-heading"><h2 id="new-run-heading">Start a Pi session</h2><span className="tag">Isolated demo</span></div>
            <p className="scope">This session runs Pi without repository tools. Use the project workflow above for approved edits, candidate checks and independent review.</p>
            <form onSubmit={(event) => void start(event)}>
              <fieldset disabled={!client || busy}>
                <div className="model-fields field-row"><label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Runtime default" spellCheck={false} /></label><label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Runtime default" spellCheck={false} /></label></div>
                <label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe a question for this session…" rows={4} maxLength={32000} required /></label>
                <div className="form-footer"><small>Uses the runtime’s configured model credentials.</small><button className="primary" disabled={!prompt.trim()}>Start session <span aria-hidden="true">↗</span></button></div>
              </fieldset>
            </form>
          </section>

          <section className="panel event-panel" aria-labelledby="events-heading">
            <div className="panel-heading"><h2 id="events-heading">{active ? "Session events" : "Live activity"}</h2>{active && <StatusBadge tone={runTone[active.state]}>{active.state}</StatusBadge>}</div>
            {active ? <>
              <div className="run-detail meta"><code>{active.id}</code><span role="status">{sessionStatus(live, active.state)}</span><span>event replay from sequence {events.at(-1)?.sequence ?? 0}</span>{canCancel(active.state, candidateActive) && <button className="danger" disabled={busy} onClick={() => void cancel()}>Cancel session</button>}</div>
              {active.state === "failed" && <p className="failure-note" data-tone="danger">This session failed. Open the final events below for the runtime’s recorded reason.</p>}
              {output && <div className="assistant-output"><h3>Pi response</h3><pre>{output}</pre></div>}
              <EventList key={selected} events={events} client={client!} runId={active.id} />
              {!events.length && <p className="empty">Waiting for the runtime’s event record…</p>}
              <p className="event-caption meta">Events replay from the last received sequence after a connection interruption. A completed session is not a validation result.</p>
            </> : <div className="activity-empty empty-box"><span aria-hidden="true">◌</span><p>Select a session or start a new one.</p><small>Live output and persisted event history appear here.</small></div>}
          </section>
        </div>
      </div>
    </main>
    <footer>Luuna · Local-first engineering workbench<span>Import · baseline · approved writer · candidate checks and review</span></footer>
  </div>;
}
