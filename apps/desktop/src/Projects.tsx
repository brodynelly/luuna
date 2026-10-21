import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BaselineEvidence, CheckResult, ComponentContext, ComponentStatus, Discovery, EventEnvelope, LuunaClient, ProjectRecord, ProjectView } from "@luuna/api-client";
import { ApiError, isTerminal, mergeEvents, readEventPages } from "@luuna/api-client";
import { Workflows } from "./Workflows";
import { ProjectComponents } from "./ProjectComponents";
import { StatusBadge } from "./design/StatusBadge";
import { baselineTone, confidenceTone, manifestTone } from "./design/tone";
import { actionFailure, baselineStep, describeFailure, nextStep } from "./failures";
import { workflowReason } from "./workflow-state";

const message = describeFailure;
const EVENT_PAGE = 1000;
const ARTIFACT_ID = /^[A-Za-z0-9._-]+\.(stdout|stderr)$/;

/**
 * A stored discovery proposes the next manifest revision; once a revision is confirmed the
 * proposal is spent, and confirming it again would only be refused as a revision conflict.
 */
export function currentProposal(view: ProjectView): Discovery | null {
  return view.discovery && view.discovery.proposed_manifest.revision === view.project.revision + 1 ? view.discovery : null;
}

/**
 * The log identities of one baseline result. Results carry `<recipe>.<stream>` references; a
 * baseline recorded before that carries `artifact:` references, and the runtime serves its logs
 * under the same `<recipe>.<stream>` identity.
 */
export function baselineArtifacts(result: CheckResult): string[] {
  const recorded = result.artifact_refs.filter((id) => ARTIFACT_ID.test(id) && !id.includes(".."));
  if (recorded.length > 0) return recorded;
  return ["stdout", "stderr"].map((stream) => `${result.recipe_id}.${stream}`).filter((id) => ARTIFACT_ID.test(id) && !id.includes(".."));
}

/** The message for a baseline run that settled before any baseline record existed. */
export function baselineRunFailure(state: string, reason: string): string {
  if (!reason) return `Baseline run ${state} before a baseline was recorded; its events in Session history hold the details.`;
  const step = state === "interrupted" || state === "cancelled" ? baselineStep(state, reason) : nextStep(reason);
  return `Baseline run ${state}: ${reason}${step ? ` ${step}` : ""}`;
}

/** Recorded baselines with each recipe's result, the recorded reason and its logs. */
export function BaselineList({ baselines, busy, onLog }: { baselines: BaselineEvidence[]; busy: boolean; onLog: (runId: string, artifactId: string) => void }) {
  if (baselines.length === 0) return null;
  return <ul className="baselines record-list" aria-label="Recorded baselines">{baselines.map((baseline) => {
    const step = baseline.reason ? baselineStep(baseline.status, baseline.reason) : "";
    return <li key={baseline.id} className="record record-headed baseline-record" data-tone={baselineTone[baseline.status]}>
      <StatusBadge tone={baselineTone[baseline.status]}>{baseline.status}</StatusBadge>
      <span className="baseline-summary meta">manifest r{baseline.manifest_revision} · commit <code>{baseline.identity.commit.slice(0, 12)}</code> · {baseline.results.length}/{baseline.required_checks.length} required results</span>
      {baseline.reason && <small className="failure-note" data-tone={baselineTone[baseline.status]}>{baseline.reason}{step && <> <span className="recovery-note">{step}</span></>}</small>}
      <small className="baseline-results meta">{baseline.results.map((result) => `${result.recipe_id}: ${result.status}${result.exit_code === null || result.exit_code === undefined ? "" : ` (exit ${result.exit_code})`}`).join(" · ")}</small>
      {baseline.results.length > 0 && <div className="baseline-logs actions">{baseline.results.flatMap((result) => baselineArtifacts(result).map((id) => <button type="button" key={`${result.id}-${id}`} disabled={busy} onClick={() => onLog(baseline.run_id, id)}>View {result.recipe_id} {id.endsWith(".stdout") ? "stdout" : "stderr"}</button>))}</div>}
    </li>;
  })}</ul>;
}

/**
 * M2a: register an existing repository, review the read-only discovery proposal
 * and confirm an exact manifest revision. The runtime inspects and validates;
 * this panel only displays authoritative state and submits the developer's confirmation.
 */
export function Projects({ client, connectionEpoch = 0 }: { client: LuunaClient | null; connectionEpoch?: number }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<ProjectView | null>(null);
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [repositoryId, setRepositoryId] = useState("app");
  const [path, setPath] = useState("");
  const [draft, setDraft] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [baselines, setBaselines] = useState<BaselineEvidence[]>([]);
  const [pendingBaselineRun, setPendingBaselineRun] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [componentContext, setComponentContext] = useState<ComponentContext>({ memory_ids: [] });
  const [componentStatus, setComponentStatus] = useState<ComponentStatus | null>(null);
  const [componentEpoch, setComponentEpoch] = useState(0);
  const [baselineLog, setBaselineLog] = useState<{ runId: string; artifactId: string; text: string } | null>(null);
  const [rebindPath, setRebindPath] = useState("");
  const [rebindConfirmed, setRebindConfirmed] = useState(false);
  const operation = useRef<AbortController | null>(null);
  // Closures created for an earlier connection (an action's late onChanged) compare against this.
  const currentClient = useRef(client);
  currentClient.current = client;
  const projectEvents = useRef<{ id: string; events: EventEnvelope[] } | null>(null);

  useEffect(() => () => operation.current?.abort(), []);

  /** The project's event record, read after the last sequence this panel holds. */
  async function readProjectEvents(id: string, signal: AbortSignal): Promise<EventEnvelope[]> {
    if (!client) return [];
    const known = projectEvents.current?.id === id ? projectEvents.current.events : [];
    const read = (after: number) => readEventPages((cursor, page) => client.projectEvents(id, cursor, signal, page), after, EVENT_PAGE);
    let merged: EventEnvelope[];
    try {
      merged = mergeEvents(known, await read(known.at(-1)?.sequence ?? 0));
    } catch (failure) {
      if (known.length === 0 || signal.aborted) throw failure;
      // The held record no longer lines up (another runtime, for example): replay it whole.
      merged = mergeEvents([], await read(0));
    }
    if (!signal.aborted) projectEvents.current = { id, events: merged };
    return merged;
  }

  useEffect(() => {
    // A request started against the previous runtime must not repopulate this one.
    operation.current?.abort();
    setBusy(false);
    setProjects([]);
    setSelected(null);
    setView(null);
    setDiscovery(null);
    setDraft("");
    setEvents([]);
    setBaselines([]);
    setBaselineLog(null);
    projectEvents.current = null;
    if (!client) return;
    const controller = new AbortController();
    client.listProjects(controller.signal).then((list) => {
      if (controller.signal.aborted) return;
      setProjects(list);
      setSelected((id) => id ?? list[0]?.id ?? null);
    }).catch((failure) => { if (!controller.signal.aborted) setError(message(failure)); });
    return () => controller.abort();
  }, [client]);

  useEffect(() => {
    setView(null);
    setEvents([]);
    setDiscovery(null);
    setDraft("");
    setBaselines([]);
    setPendingBaselineRun(null);
    setBaselineLog(null);
    setRebindPath("");
    setRebindConfirmed(false);
    setComponentContext({ memory_ids: [] });
    setComponentStatus(null);
    if (!client || !selected) return;
    const controller = new AbortController();
    Promise.all([client.project(selected, controller.signal), readProjectEvents(selected, controller.signal), client.listBaselines(selected, controller.signal)]).then(([next, replay, recorded]) => {
      if (controller.signal.aborted) return;
      setView(next);
      setEvents(replay);
      setBaselines(recorded);
      const proposal = currentProposal(next);
      if (proposal) {
        setDiscovery(proposal);
        setDraft(JSON.stringify(proposal.proposed_manifest, null, 2));
      }
    }).catch((failure) => { if (!controller.signal.aborted) setError(message(failure)); });
    return () => controller.abort();
  }, [client, selected]);

  async function guarded(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (!client || client !== currentClient.current) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(actionFailure(label, failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  // The runtime answered again after an outage: reload authoritative state
  // (a restart marks abandoned work interrupted) instead of showing stale panels.
  useEffect(() => {
    if (!client || !selected || connectionEpoch === 0) return;
    void guarded("Reload after reconnection", (signal) => refresh(selected, signal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionEpoch]);

  async function refresh(id: string, signal: AbortSignal) {
    if (!client) return;
    const [next, replay, list, recorded] = await Promise.all([client.project(id, signal), readProjectEvents(id, signal), client.listProjects(signal), client.listBaselines(id, signal)]);
    if (signal.aborted) return;
    setProjects(list);
    setView(next);
    setEvents(replay);
    setBaselines(recorded);
    setSelected(id);
  }

  // A baseline advances on the runtime: poll its durable record from the moment the
  // run is accepted (its record appears after inspection and probing) until it settles.
  const baselineInFlight = pendingBaselineRun !== null || baselines.some((baseline) => baseline.status === "running");
  useEffect(() => {
    if (!client || !selected || !baselineInFlight) return;
    const controller = new AbortController();
    const pending = pendingBaselineRun;
    const timer = setTimeout(() => {
      // A run can settle before any baseline record exists (inspection or identity
      // failure), so the run itself is polled too; otherwise the button never returns.
      Promise.all([
        client.listBaselines(selected, controller.signal),
        pending ? client.run(pending, controller.signal) : Promise.resolve(null),
      ]).then(async ([recorded, run]) => {
        if (controller.signal.aborted) return;
        setBaselines(recorded);
        if (!pending) return;
        const recordSettled = recorded.some((baseline) => baseline.run_id === pending && baseline.status !== "running");
        const runSettled = run !== null && isTerminal(run.state);
        if (recordSettled || runSettled) {
          if (!recordSettled && run !== null) {
            // Without a record, the run's terminal event carries the reason.
            const reason = workflowReason(await client.events(pending, 0, controller.signal));
            if (controller.signal.aborted) return;
            setError(baselineRunFailure(run.state, reason));
          }
          setPendingBaselineRun(null);
        }
      }).catch(() => {
        // A poll that fails (the runtime restarting, for example) is retried;
        // otherwise the record would stay "running" until a manual refresh.
        if (!controller.signal.aborted) setPollTick((value) => value + 1);
      });
    }, 1500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [client, selected, baselines, baselineInFlight, pendingBaselineRun, pollTick]);

  function runBaseline() {
    if (!selected || !view) return;
    const repository = view.repositories[0];
    if (!repository) return;
    void guarded("Baseline", async (signal) => {
      if (!client) return;
      const run = await client.startBaseline(selected, { repository_id: repository.repository_id }, signal);
      if (signal.aborted) return;
      setPendingBaselineRun(run.id);
      await refresh(selected, signal);
    });
  }

  function cancelBaseline(runId: string) {
    void guarded("Baseline cancellation", async (signal) => {
      if (!client || !selected) return;
      await client.cancelRun(runId, signal);
      if (signal.aborted) return;
      await refresh(selected, signal);
    });
  }

  function viewBaselineLog(runId: string, artifactId: string) {
    void guarded("Log inspection", async (signal) => {
      if (!client) return;
      const text = await client.artifact(runId, artifactId, signal);
      if (!signal.aborted) setBaselineLog({ runId, artifactId, text });
    });
  }

  function rebind(event: FormEvent) {
    event.preventDefault();
    if (!selected || !registration || !rebindConfirmed) return;
    const repository = registration.repository_id;
    void guarded("Rebind", async (signal) => {
      if (!client) return;
      await client.rebindRepository(selected, repository, rebindPath.trim() ? { local_path: rebindPath.trim() } : {}, signal);
      if (signal.aborted) return;
      setRebindPath("");
      setRebindConfirmed(false);
      await refresh(selected, signal);
    });
  }

  function register(event: FormEvent) {
    event.preventDefault();
    void guarded("Registration", async (signal) => {
      if (!client) return;
      const created = await client.registerProject({
        name: name.trim(),
        ...(projectId.trim() && { id: projectId.trim() }),
        repositories: [{ id: repositoryId.trim(), path: path.trim() }],
      }, signal);
      if (signal.aborted) return;
      setName("");
      setProjectId("");
      setPath("");
      await refresh(created.project.id, signal);
    });
  }

  function discover() {
    if (!selected) return;
    void guarded("Discovery", async (signal) => {
      if (!client) return;
      const proposal = await client.discover(selected, signal);
      if (signal.aborted) return;
      setDiscovery(proposal);
      setDraft(JSON.stringify(proposal.proposed_manifest, null, 2));
      await refresh(selected, signal);
    });
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    if (!selected || !view) return;
    void guarded("Manifest confirmation", async (signal) => {
      if (!client) return;
      let manifest: unknown;
      try {
        manifest = JSON.parse(draft);
      } catch {
        throw new Error("The manifest draft is not valid JSON.");
      }
      if (!manifest || typeof manifest !== "object") throw new Error("The manifest draft must be a JSON object.");
      try {
        await client.confirmManifest(selected, view.project.revision, manifest as Parameters<LuunaClient["confirmManifest"]>[2], signal);
      } catch (failure) {
        // A runtime that answers a shape error without a JSON reason still gets a useful sentence.
        if (failure instanceof ApiError && failure.status === 422 && !failure.fromRuntime) throw new Error("The runtime could not read the manifest draft: a field is missing, misspelled or of the wrong type (for example a quoted true). Compare the draft with schemas/project.schema.json, then confirm again.");
        throw failure;
      }
      if (signal.aborted) return;
      await refresh(selected, signal);
      // The confirmed proposal is spent; a new discovery produces the next revision's draft.
      setDiscovery(null);
      setDraft("");
    });
  }

  const registration = view?.repositories[0];
  const observation = registration?.observation;
  const runningBaseline = pendingBaselineRun ?? baselines.find((baseline) => baseline.status === "running")?.run_id ?? null;
  const shownLog = baselineLog && baselines.some((baseline) => baseline.run_id === baselineLog.runId) ? baselineLog : null;

  function selectProject(id: string) {
    if (id === selected) return;
    setView(null);
    setComponentContext({ memory_ids: [] });
    setComponentStatus(null);
    setSelected(id);
  }

  return <section className="panel projects-panel" aria-labelledby="projects-heading">
    <div className="panel-heading"><h2 id="projects-heading">Projects</h2><span className="tag">Import · baseline · candidate workflow</span></div>
    <p className="scope">Register an existing repository root. The runtime observes identity, base commit and dirty state without touching the checkout, proposes check recipes from its manifests, and records an immutable manifest revision only when you confirm it.</p>
    {error && <div className="error" role="alert">{error}<button className="text-button" type="button" onClick={() => setError("")}>Dismiss</button></div>}

    <div className="projects-layout">
      <div className="projects-rail">
        <form onSubmit={register} className="register-form form-group">
          <fieldset disabled={!client || busy}>
            <label>Project name<input value={name} onChange={(event) => setName(event.target.value)} required placeholder="My product" /></label>
            <label>Project ID<input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="derived from the name" spellCheck={false} pattern="[a-z][a-z0-9\-]{0,63}" /></label>
            <label>Repository ID<input value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} required spellCheck={false} pattern="[a-z][a-z0-9\-]{0,63}" /></label>
            <label>Repository root path<input value={path} onChange={(event) => setPath(event.target.value)} required spellCheck={false} placeholder="/absolute/path/to/checkout" /></label>
            <div className="form-footer"><small>Paths stay in the local machine registry; the manifest never contains them.</small><button className="primary" disabled={!name.trim() || !path.trim()}>Register repository</button></div>
          </fieldset>
        </form>
        {projects.length > 0 && <ul className="project-list" aria-label="Registered projects">{projects.map((project) => <li key={project.id}>
          <button type="button" className={`run-card ${selected === project.id ? "selected" : ""}`} aria-pressed={selected === project.id} onClick={() => selectProject(project.id)}>
            <span className="run-prompt">{project.name}</span>
            <span className="run-meta"><StatusBadge tone={manifestTone(project.revision)}>{project.revision > 0 ? `manifest r${project.revision}` : "unconfirmed"}</StatusBadge><code>{project.id}</code></span>
          </button>
        </li>)}</ul>}
      </div>

      <div className="project-detail">
        {view && registration && observation ? <>
          <dl className="facts project-facts">
            <div><dt>Repository</dt><dd><code>{registration.repository_id}</code> · {registration.local_path}</dd></div>
            <div><dt>Remote identity</dt><dd>{observation.identity.remote ?? "no portable origin"}{observation.identity.push_remote && ` · push ${observation.identity.push_remote}`}{observation.identity.shallow && " · shallow clone"}</dd></div>
            <div><dt>HEAD at registration</dt><dd><code>{observation.head_commit.slice(0, 12)}</code> on {observation.branch ?? "detached HEAD"}</dd></div>
            <div><dt>Dirty state</dt><dd>{observation.dirty.staged} staged · {observation.dirty.unstaged} unstaged · {observation.dirty.untracked} untracked · {observation.dirty.conflicted} conflicted</dd></div>
            <div><dt>Confirmed manifest</dt><dd>{view.manifest ? <>revision {view.manifest.revision} · <code>{view.manifest.hash.slice(0, 23)}…</code> · base <code>{Object.values(view.manifest.base_commits)[0]?.slice(0, 12)}</code></> : "not yet confirmed"}</dd></div>
          </dl>
          <details className="rebind section"><summary>Rebind repository</summary>
            <form onSubmit={rebind} className="rebind-form">
              <fieldset disabled={busy}>
                <label>New repository root path (empty re-inspects the registered path)<input value={rebindPath} onChange={(event) => setRebindPath(event.target.value)} spellCheck={false} placeholder={registration.local_path} /></label>
                <label className="checkbox"><input type="checkbox" checked={rebindConfirmed} onChange={(event) => setRebindConfirmed(event.target.checked)} /> I moved this checkout or changed its remote on purpose; bind {registration.repository_id} to it.</label>
                <div className="form-footer"><small>The runtime inspects the checkout read-only and records the old and new identity. Plans, baselines and approvals stay bound to exact commits; a manifest whose remote no longer matches must be confirmed again.</small><button className="primary" disabled={!rebindConfirmed}>Rebind repository</button></div>
              </fieldset>
            </form>
          </details>
          <div className="project-actions actions">
            <button type="button" disabled={busy} onClick={discover}>Discover proposed map</button>
            <button type="button" disabled={busy || !view.manifest || baselineInFlight} onClick={runBaseline}>Run baseline</button>
            {runningBaseline && <button type="button" className="danger" disabled={busy} onClick={() => cancelBaseline(runningBaseline)}>Cancel baseline</button>}
            <small>Discovery reads manifests and lockfiles; it never runs repository commands. A baseline runs the confirmed required recipes on a clean checkout and records exact evidence.</small>
          </div>
          <BaselineList baselines={baselines} busy={busy} onLog={viewBaselineLog} />
          {shownLog && <details open className="baseline-log section"><summary>Baseline log · <code>{shownLog.artifactId}</code></summary><pre aria-label="Baseline log" tabIndex={0}>{shownLog.text || "Empty log."}</pre></details>}
          {discovery && <>
            {discovery.questions.length > 0 && <ul className="project-questions questions callout" data-tone="attention" aria-label="Open questions">{discovery.questions.map((question, index) => <li key={index}><strong>{question.topic}</strong> {question.detail}</li>)}</ul>}
            {discovery.manifest_problems.length > 0 && <p className="failure-note manifest-problems" data-tone="attention">Proposal needs edits before confirmation: {discovery.manifest_problems.join("; ")}</p>}
            <ul className="recipes record-list" aria-label="Proposed check recipes">{discovery.repositories.flatMap((repo) => repo.proposed_checks.map((proposed) => <li key={`${repo.repository_id}-${proposed.check.id}`} className="record recipe-record">
              <code className="recipe-command">{proposed.check.executable} {proposed.check.args.join(" ")}</code>
              <StatusBadge tone={confidenceTone[proposed.confidence]}>{proposed.check.required ? "required" : "optional"} · {proposed.confidence}</StatusBadge>
              <small className="recipe-evidence meta">{proposed.evidence.join(" · ")}</small>
            </li>))}</ul>
            <form onSubmit={confirm} className="manifest-form">
              <fieldset disabled={busy}>
                <label>Manifest to confirm (revision {view.project.revision + 1})<textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={14} spellCheck={false} /></label>
                <div className="form-footer"><small>Confirmation re-checks identity, remote and default branch against the live checkout and records the exact base commit.</small><button className="primary">Confirm manifest</button></div>
              </fieldset>
            </form>
          </>}
          <ProjectComponents key={view.project.id} client={client} projectId={view.project.id} connectionEpoch={connectionEpoch} onContextChange={setComponentContext} onStatusChange={setComponentStatus} onChanged={() => setComponentEpoch((value) => value + 1)} />
          <Workflows client={client} projectId={view.project.id} repositoryId={registration.repository_id} manifestConfirmed={view.manifest !== null && view.manifest !== undefined} connectionEpoch={connectionEpoch} componentContext={componentContext} componentsEnabled={componentStatus?.enabled ?? false} componentEpoch={componentEpoch} onChanged={() => { if (selected) void guarded("Refresh", (signal) => refresh(selected, signal)); }} />
          <details className="project-events section"><summary>Project event record ({events.length})</summary>
            <ol className="events" aria-label="Durable project events" tabIndex={0}>{events.map((event) => <li key={event.event_id}><details><summary><span className="event-number">{event.sequence}</span><span>{event.type}</span></summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></li>)}</ol>
          </details>
        </> : <p className="empty empty-box">{client ? "Register a repository or select a project." : "Connect to the runtime to import a repository."}</p>}
      </div>
    </div>
  </section>;
}
