import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { LuunaClient, assistantText, isTerminal, mergeEvents } from "@luuna/api-client";
import type { EventEnvelope, Health, RunRecord } from "@luuna/api-client";
import { canCancel } from "./workflow-state";
import { Projects } from "./Projects";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The runtime could not be reached.";
}

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
  const operation = useRef<AbortController | null>(null);
  const active = runs.find((run) => run.id === selected);
  const selectedWorkflow = active?.metadata.kind === "workflow";
  const output = assistantText(events);

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    const load = async () => {
      while (!controller.signal.aborted) {
        try {
          const next = await client.listRuns(controller.signal);
          if (controller.signal.aborted) return;
          setReachable(true);
          setRuns(next);
          setSelected((id) => id ?? next[0]?.id ?? null);
          await pause(2000, controller.signal);
        } catch (failure) {
          if (controller.signal.aborted) return;
          setReachable(false);
          setError(message(failure));
          await pause(3000, controller.signal).catch(() => undefined);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [client, refresh]);

  useEffect(() => {
    setEvents([]);
    setCandidateActive(false);
    if (!client || !selected) return;
    const controller = new AbortController();
    let cursor = 0;
    let received: EventEnvelope[] = [];
    const follow = async () => {
      while (!controller.signal.aborted) {
        try {
          // Authenticated cursor replay also repairs gaps after sleep or disconnection.
          const [incoming, candidate] = await Promise.all([
            client.events(selected, cursor, controller.signal),
            selectedWorkflow ? client.candidate(selected, controller.signal) : Promise.resolve(null),
          ]);
          if (controller.signal.aborted) return;
          received = mergeEvents(received, incoming);
          setEvents(received);
          setCandidateActive(candidate?.active ?? false);
          cursor = received.at(-1)?.sequence ?? 0;
          setLive("Connected · event replay");
          await pause(700, controller.signal);
        } catch (failure) {
          if (controller.signal.aborted) return;
          setLive(`Reconnecting · ${message(failure)}`);
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
      const [status, saved] = await Promise.all([next.health(controller.signal), next.listRuns(controller.signal)]);
      setHealth(status);
      setRuns(saved);
      setSelected(saved[0]?.id ?? null);
      setClient(next);
      setReachable(true);
      setLive("Connected");
      setToken("");
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function disconnect() {
    operation.current?.abort();
    setClient(null);
    setReachable(false);
    setHealth(null);
    setToken("");
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
      setRuns((previous) => [run, ...previous.filter((item) => item.id !== run.id)]);
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
    <header className="topbar">
      <a className="wordmark" href="#main" aria-label="Luuna home"><span aria-hidden="true">◒</span> luuna</a>
      <span className="stage">Development foundation</span>
      <span className={`connection ${client && reachable ? "online" : ""}`}><i aria-hidden="true" />{client ? reachable ? "Local runtime connected" : "Reconnecting to runtime" : "Local runtime offline"}</span>
    </header>

    <main id="main">
      <div className="intro"><p className="eyebrow">Your local workbench</p><h1>A clear starting point.</h1><p>Connect to your runtime, launch a real Pi session, and follow the durable event record.</p></div>

      {error && <div className="error" role="alert">{error}<button className="text-button" onClick={() => setError("")}>Dismiss</button></div>}

      <section className="panel connection-panel" aria-labelledby="runtime-heading">
        <div><h2 id="runtime-heading">Runtime connection</h2><p>{client ? `${client.baseUrl} · Required Pi version ${health?.pi_version ?? "unknown"}` : "Start the Rust service separately, then enter its local address and token."}</p></div>
        {client ? <button onClick={disconnect}>Disconnect</button> : <form onSubmit={(event) => void connect(event)} className="connection-form">
          <label>Service URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required spellCheck={false} /></label>
          <label>Service token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required placeholder="Session token" /></label>
          <button className="primary" disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
          <small>The token stays in memory and is cleared when you disconnect or reload.</small>
        </form>}
      </section>

      <Projects client={client} />

      <div className="workspace">
        <aside className="panel history" aria-labelledby="history-heading">
          <div className="panel-heading"><h2 id="history-heading">Session history</h2><button className="text-button" disabled={!client} onClick={() => setRefresh((value) => value + 1)}>Refresh</button></div>
          {runs.length ? <ul>{runs.map((run) => <li key={run.id}><button className={`run-card ${selected === run.id ? "selected" : ""}`} onClick={() => setSelected(run.id)} aria-pressed={selected === run.id}>
            <span className="run-prompt">{run.metadata.kind === "baseline" ? `Baseline · ${String(run.metadata.repository_id ?? "")} · manifest r${String(run.metadata.manifest_revision ?? "?")}` : run.metadata.kind === "workflow" ? `Workflow · ${String(run.metadata.plan_id ?? "")} r${String(run.metadata.plan_revision ?? "?")}` : typeof run.metadata.prompt === "string" ? run.metadata.prompt : run.id}</span>
            <span className="run-meta"><span className={`state ${run.state}`}>{run.state}</span><time dateTime={run.created_at}>{date(run.created_at)}</time></span>
          </button></li>)}</ul> : <p className="empty">{client ? "No sessions yet. Start one to create a durable run record." : "Connect to see sessions saved by your runtime."}</p>}
        </aside>

        <div className="main-column">
          <section className="panel" aria-labelledby="new-run-heading">
            <div className="panel-heading"><h2 id="new-run-heading">Start a Pi session</h2><span className="tag">Isolated demo</span></div>
            <p className="scope">This session runs Pi without repository tools. Use the project workflow above for approved edits, candidate checks and independent review.</p>
            <form onSubmit={(event) => void start(event)}>
              <fieldset disabled={!client || busy}>
                <div className="model-fields"><label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Runtime default" spellCheck={false} /></label><label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Runtime default" spellCheck={false} /></label></div>
                <label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe a question for this session…" rows={4} maxLength={32000} required /></label>
                <div className="form-footer"><small>Uses the runtime’s configured model credentials.</small><button className="primary" disabled={!prompt.trim()}>Start session <span aria-hidden="true">↗</span></button></div>
              </fieldset>
            </form>
          </section>

          <section className="panel event-panel" aria-labelledby="events-heading">
            <div className="panel-heading"><h2 id="events-heading">{active ? "Session events" : "Live activity"}</h2>{active && <span className={`state ${active.state}`}>{active.state}</span>}</div>
            {active ? <>
              <div className="run-detail"><code>{active.id}</code><span>{live}</span>{canCancel(active.state, candidateActive) && <button className="danger" disabled={busy} onClick={() => void cancel()}>Cancel session</button>}</div>
              {active.state === "failed" && <p className="failure-note">This session failed. Open the final events below for the runtime’s recorded reason.</p>}
              {output && <div className="assistant-output"><h3>Pi response</h3><pre aria-live="polite">{output}</pre></div>}
              <ol className="events" aria-label="Durable session events">{events.map((event) => <li key={event.event_id}>
                <details open={event.type.includes("error") || event.type === "run.failed"}><summary><span className="event-number">{event.sequence}</span><span>{event.type}</span><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString()}</time></summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>
              </li>)}</ol>
              {!events.length && <p className="empty">Waiting for the runtime’s event record…</p>}
              <p className="event-caption">Events replay from the last received sequence after a connection interruption. A completed session is not a validation result.</p>
            </> : <div className="activity-empty"><span aria-hidden="true">◌</span><p>Select a session or start a new one.</p><small>Live output and persisted event history appear here.</small></div>}
          </section>
        </div>
      </div>
    </main>
    <footer>Luuna · Local-first engineering workbench<span>Import · baseline · approved writer · candidate checks and review</span></footer>
  </div>;
}
