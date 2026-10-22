import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BaselineEvidence, CheckResult, ComponentContext, ComponentStatus, Discovery, EventEnvelope, LuunaClient, ProjectExport, ProjectImportResult, ProjectRecord, ProjectView, ScaffoldProfile, ScaffoldProposal, ScaffoldResult } from "@luuna/api-client";

/** What another panel (Home, Board) asks this one to show: a project, one of its tickets, or its ticket form. */
export interface ProjectRequest { projectId: string; ticketId?: string; ticketForm?: boolean; nonce: number }

/** The element a request lands on, in DOM order of the Projects panel. */
export function requestTarget(request: Pick<ProjectRequest, "ticketId" | "ticketForm">): string {
  return request.ticketId ? `ticket-${request.ticketId}` : request.ticketForm ? "ticket-title" : "projects-heading";
}
import { ApiError, isTerminal, mergeEvents, readEventPages, registerProjectRequest } from "@luuna/api-client";
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

/** One row of the registration form; a project registers several repositories at once (R05). */
export interface RepositoryRow { id: string; path: string }

/** The registration the desktop sends: every row, through the builder the TUI shares (R02). */
export function registrationRequest(name: string, projectId: string, rows: RepositoryRow[]) {
  return registerProjectRequest(name, rows, projectId);
}

/** The latest recorded baseline of each registered repository, by record order (newest last). */
export function latestBaselines(baselines: BaselineEvidence[], repositoryIds: string[]): Record<string, BaselineEvidence | undefined> {
  return Object.fromEntries(repositoryIds.map((id) => [id, baselines.filter((baseline) => baseline.identity.repository_id === id).at(-1)]));
}

/**
 * One baseline control per registered repository with that repository's latest status: a
 * multi-repository feature needs every repository's passing baseline, and one baseline per
 * repository runs at a time.
 */
export function RepositoryBaselines({ repositoryIds, baselines, running, busy, manifestConfirmed, onRun, onCancel }: {
  repositoryIds: string[]; baselines: BaselineEvidence[]; running: Record<string, string | undefined>; busy: boolean; manifestConfirmed: boolean;
  onRun: (repositoryId: string) => void; onCancel: (runId: string) => void;
}) {
  const latest = latestBaselines(baselines, repositoryIds);
  return <ul className="repository-baselines record-list" aria-label="Baseline per repository">{repositoryIds.map((id) => {
    const record = latest[id];
    const active = running[id];
    return <li key={id} className="record repository-baseline">
      <code>{id}</code>
      {record ? <StatusBadge tone={baselineTone[record.status]}>{record.status}</StatusBadge> : <StatusBadge tone="attention">no baseline</StatusBadge>}
      {record && <span className="meta">manifest r{record.manifest_revision} · commit <code>{record.identity.commit.slice(0, 12)}</code></span>}
      <button type="button" disabled={busy || !manifestConfirmed || active !== undefined} data-capability="baselines.start" onClick={() => onRun(id)}>Run baseline for {id}</button>
      {active && <button type="button" className="danger" disabled={busy} data-capability="runs.cancel" onClick={() => onCancel(active)}>Cancel baseline for {id}</button>}
    </li>;
  })}</ul>;
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
  return <ul className="baselines record-list" aria-label="Recorded baselines" data-capability="baselines.list">{baselines.map((baseline) => {
    const step = baseline.reason ? baselineStep(baseline.status, baseline.reason) : "";
    return <li key={baseline.id} className="record record-headed baseline-record" data-tone={baselineTone[baseline.status]}>
      <StatusBadge tone={baselineTone[baseline.status]}>{baseline.status}</StatusBadge>
      <span className="baseline-summary meta">manifest r{baseline.manifest_revision} · commit <code>{baseline.identity.commit.slice(0, 12)}</code> · {baseline.results.length}/{baseline.required_checks.length} required results</span>
      {baseline.reason && <small className="failure-note" data-tone={baselineTone[baseline.status]}>{baseline.reason}{step && !baseline.prerequisite && <> <span className="recovery-note">{step}</span></>}</small>}
      {baseline.prerequisite && <p className="callout baseline-offer" data-tone="attention" role="status">Testing setup needed for <code>{baseline.prerequisite.repository_id}</code>: {baseline.prerequisite.reason} <span className="recovery-note">{baseline.prerequisite.next} The ticket is created from the offer in the workflows below.</span></p>}
      <small className="baseline-results meta">{baseline.results.map((result) => `${result.recipe_id}: ${result.status}${result.exit_code === null || result.exit_code === undefined ? "" : ` (exit ${result.exit_code})`}`).join(" · ")}</small>
      {baseline.results.length > 0 && <div className="baseline-logs actions">{baseline.results.flatMap((result) => baselineArtifacts(result).map((id) => <button type="button" key={`${result.id}-${id}`} disabled={busy} data-capability="artifacts.read" onClick={() => onLog(baseline.run_id, id)}>View {result.recipe_id} {id.endsWith(".stdout") ? "stdout" : "stderr"}</button>))}</div>}
    </li>;
  })}</ul>;
}

/**
 * M2a: register an existing repository, review the read-only discovery proposal
 * and confirm an exact manifest revision. The runtime inspects and validates;
 * this panel only displays authoritative state and submits the developer's confirmation.
 */
export function Projects({ client, connectionEpoch = 0, requested = null }: { client: LuunaClient | null; connectionEpoch?: number; requested?: ProjectRequest | null }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<ProjectView | null>(null);
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<RepositoryRow[]>([{ id: "app", path: "" }]);
  const [draft, setDraft] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [baselines, setBaselines] = useState<BaselineEvidence[]>([]);
  // Baseline runs accepted by the runtime and not yet settled, by repository.
  const [pendingBaselineRuns, setPendingBaselineRuns] = useState<Record<string, string>>({});
  const [rebindRepository, setRebindRepository] = useState("");
  const [pollTick, setPollTick] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [componentContext, setComponentContext] = useState<ComponentContext>({ memory_ids: [] });
  const [componentStatus, setComponentStatus] = useState<ComponentStatus | null>(null);
  const [componentEpoch, setComponentEpoch] = useState(0);
  const [baselineLog, setBaselineLog] = useState<{ runId: string; artifactId: string; text: string } | null>(null);
  const [rebindPath, setRebindPath] = useState("");
  const [rebindConfirmed, setRebindConfirmed] = useState(false);
  const [exported, setExported] = useState<ProjectExport | null>(null);
  const [importText, setImportText] = useState("");
  const [importPaths, setImportPaths] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<ProjectImportResult | null>(null);
  const [scaffoldProfile, setScaffoldProfile] = useState<ScaffoldProfile>("python");
  const [scaffoldName, setScaffoldName] = useState("");
  const [scaffoldParent, setScaffoldParent] = useState("");
  const [proposal, setProposal] = useState<ScaffoldProposal | null>(null);
  const [proposalAcknowledged, setProposalAcknowledged] = useState(false);
  const [scaffoldResult, setScaffoldResult] = useState<ScaffoldResult | null>(null);
  const operation = useRef<AbortController | null>(null);
  // Closures created for an earlier connection (an action's late onChanged) compare against this.
  const currentClient = useRef(client);
  currentClient.current = client;
  const projectEvents = useRef<{ id: string; events: EventEnvelope[] } | null>(null);
  // A request from Home or the Board: select the project, then land on its ticket or form once it renders.
  const pendingRequest = useRef<ProjectRequest | null>(null);

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    if (!requested || !client) return;
    pendingRequest.current = requested;
    setSelected((current) => (current === requested.projectId ? current : requested.projectId));
    setView((current) => (current?.project.id === requested.projectId ? current : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  useEffect(() => {
    const pending = pendingRequest.current;
    if (!pending || !view || view.project.id !== pending.projectId || typeof document === "undefined") return;
    pendingRequest.current = null;
    // Tickets load after the view, so the landing is retried briefly; nothing else depends on it.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const land = (attempt: number) => {
      const target = document.getElementById(requestTarget(pending));
      if (target) {
        target.scrollIntoView?.({ block: "start" });
        if (pending.ticketForm || pending.ticketId) target.focus?.();
      } else if (attempt < 6) timers.push(setTimeout(() => land(attempt + 1), 500));
    };
    land(0);
    return () => timers.forEach(clearTimeout);
  }, [view]);

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
    setPendingBaselineRuns({});
    setBaselineLog(null);
    setRebindPath("");
    setRebindRepository("");
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
  const pendingList = Object.values(pendingBaselineRuns);
  const baselineInFlight = pendingList.length > 0 || baselines.some((baseline) => baseline.status === "running");
  useEffect(() => {
    if (!client || !selected || !baselineInFlight) return;
    const controller = new AbortController();
    const pending = pendingList;
    const timer = setTimeout(() => {
      // A run can settle before any baseline record exists (inspection or identity
      // failure), so each pending run itself is polled too; otherwise its button never returns.
      Promise.all([
        client.listBaselines(selected, controller.signal),
        Promise.all(pending.map((runId) => client.run(runId, controller.signal))),
      ]).then(async ([recorded, runs]) => {
        if (controller.signal.aborted) return;
        const settled: string[] = [];
        for (const run of runs) {
          const recordSettled = recorded.some((baseline) => baseline.run_id === run.id && baseline.status !== "running");
          if (recordSettled || isTerminal(run.state)) {
            if (!recordSettled) {
              // Without a record, the run's terminal event carries the reason.
              const reason = workflowReason(await client.events(run.id, 0, controller.signal));
              if (controller.signal.aborted) return;
              setError(baselineRunFailure(run.state, reason));
            }
            settled.push(run.id);
          }
        }
        if (settled.length) setPendingBaselineRuns((current) => Object.fromEntries(Object.entries(current).filter(([, runId]) => !settled.includes(runId))));
        // Updating an effect dependency aborts this request. Do it only after
        // the terminal reasons have been read, otherwise polling livelocks.
        setBaselines(recorded);
      }).catch(() => {
        // A poll that fails (the runtime restarting, for example) is retried;
        // otherwise the record would stay "running" until a manual refresh.
        if (!controller.signal.aborted) setPollTick((value) => value + 1);
      });
    }, 1500);
    return () => { controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, selected, baselines, baselineInFlight, pendingBaselineRuns, pollTick]);

  /** Baselines are per repository: each registered repository runs its own confirmed recipes. */
  function runBaseline(repositoryId: string) {
    if (!selected || !view) return;
    if (!view.repositories.some((repository) => repository.repository_id === repositoryId)) return;
    void guarded("Baseline", async (signal) => {
      if (!client) return;
      const run = await client.startBaseline(selected, { repository_id: repositoryId }, signal);
      if (signal.aborted) return;
      setPendingBaselineRuns((current) => ({ ...current, [repositoryId]: run.id }));
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
    const repository = rebindRepository || registration.repository_id;
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
      // Every row is sent; the shared builder refuses an incomplete or repeated row before any request.
      const created = await client.registerProject(registrationRequest(name, projectId, rows), signal);
      if (signal.aborted) return;
      setName("");
      setProjectId("");
      setRows([{ id: "app", path: "" }]);
      await refresh(created.project.id, signal);
    });
  }

  function exportProject() {
    if (!selected) return;
    void guarded("Project export", async (signal) => {
      if (!client) return;
      const value = await client.exportProject(selected, signal);
      if (!signal.aborted) setExported(value);
    });
  }

  // The pasted document is parsed locally only to list the repositories it names;
  // the runtime validates its hash, identities and content.
  const importDraft = useMemo<ProjectExport | null>(() => {
    if (!importText.trim()) return null;
    try {
      const value = JSON.parse(importText) as ProjectExport;
      // Only a document with the export kind and a manifest naming at least
      // one repository by id is rendered; the runtime validates the rest.
      const repositories = value && typeof value === "object" && value.manifest && typeof value.manifest === "object" ? value.manifest.repositories : undefined;
      const shaped = Array.isArray(repositories) && repositories.every((repository) => repository && typeof repository === "object" && typeof repository.id === "string" && repository.id.length > 0);
      return value && typeof value === "object" && value.kind === "luuna-project-export" && shaped ? value : null;
    } catch {
      return null;
    }
  }, [importText]);
  const importRepositories = importDraft?.manifest?.repositories.map((repository) => repository.id) ?? [];
  const importReady = importDraft !== null && importRepositories.length > 0 && importRepositories.every((id) => (importPaths[id] ?? "").trim());

  function importProject(event: FormEvent) {
    event.preventDefault();
    if (!importDraft || !importReady) return;
    const draft = importDraft;
    const repositories = importRepositories.map((id) => ({ id, path: (importPaths[id] ?? "").trim() }));
    void guarded("Project import", async (signal) => {
      if (!client) return;
      setImportResult(null);
      const result = await client.importProject({ export: draft, repositories, idempotency_key: `import-${(draft.export_hash ?? "").slice(7, 31) || draft.project.id}` }, signal);
      if (signal.aborted) return;
      setImportResult(result);
      setImportText("");
      setImportPaths({});
      await refresh(result.project.project.id, signal);
    });
  }

  function proposeScaffold(event: FormEvent) {
    event.preventDefault();
    void guarded("Scaffold proposal", async (signal) => {
      if (!client) return;
      setScaffoldResult(null);
      setProposalAcknowledged(false);
      const value = await client.proposeScaffold({ profile: scaffoldProfile, name: scaffoldName.trim(), parent_dir: scaffoldParent.trim() }, signal);
      if (!signal.aborted) setProposal(value);
    });
  }

  function confirmScaffold() {
    if (!proposal || !proposalAcknowledged) return;
    const hash = proposal.hash;
    const network = proposal.network_steps.length > 0;
    void guarded("Scaffolding", async (signal) => {
      if (!client) return;
      const result = await client.scaffold({ proposal_hash: hash, idempotency_key: `scaffold-${hash.slice(7, 31)}`, confirm: true, ...(network && { confirm_network: true }) }, signal);
      if (signal.aborted) return;
      setScaffoldResult(result);
      setProposal(null);
      setProposalAcknowledged(false);
      setScaffoldName("");
      await refresh(result.project.project.id, signal);
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
  const repositoryIds = view?.repositories.map((repository) => repository.repository_id) ?? [];
  // The baseline run in flight per repository: accepted and pending, or recorded as running.
  const runningBaselines: Record<string, string | undefined> = Object.fromEntries(repositoryIds.map((id) => [id, pendingBaselineRuns[id] ?? baselines.find((baseline) => baseline.identity.repository_id === id && baseline.status === "running")?.run_id]));
  const rebindTarget = view?.repositories.find((repository) => repository.repository_id === rebindRepository) ?? registration;
  const rowsComplete = rows.length > 0 && rows.every((row) => row.id.trim() && row.path.trim());
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
            <ul className="repository-rows record-list" aria-label="Repositories to register">{rows.map((row, index) => <li key={index} className="record repository-row field-row">
              <label>Repository ID<input value={row.id} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, id: event.target.value } : item))} required spellCheck={false} pattern="[a-z][a-z0-9\-]{0,63}" /></label>
              <label>Repository root path<input value={row.path} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, path: event.target.value } : item))} required spellCheck={false} placeholder="/absolute/path/to/checkout" /></label>
              {rows.length > 1 && <button type="button" className="text-button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>Remove repository {row.id || index + 1}</button>}
            </li>)}</ul>
            <button type="button" className="text-button" onClick={() => setRows((current) => [...current, { id: "", path: "" }])}>Add another repository</button>
            <div className="form-footer"><small>A project registers every related repository at once; paths stay in the local machine registry, and the manifest never contains them.</small><button className="primary" disabled={!name.trim() || !rowsComplete} data-capability="projects.register">Register {rows.length > 1 ? `${rows.length} repositories` : "repository"}</button></div>
          </fieldset>
        </form>
        <details className="import section"><summary>Import a project export from another machine</summary>
          <form onSubmit={importProject} className="form-group">
            <fieldset disabled={!client || busy}>
              <label>Export JSON<textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={4} spellCheck={false} placeholder='{"kind":"luuna-project-export", …}' aria-describedby="import-note" /></label>
              {importText.trim() && !importDraft && <p className="reason" role="status">The pasted text is not a Luuna project export.</p>}
              {importRepositories.map((id) => <label key={id}>Checkout of repository <code>{id}</code><input value={importPaths[id] ?? ""} onChange={(event) => setImportPaths({ ...importPaths, [id]: event.target.value })} required spellCheck={false} placeholder="/absolute/path/to/clone" /></label>)}
              <div className="form-footer"><small id="import-note">The runtime checks the export hash, matches each clone's remote and root commits against the exported identity, and refuses user memory, credentials and host paths. Tickets, project and process memory and prompts arrive through Missions, Atlas and Beacon.</small><button className="primary" disabled={!importReady} data-capability="projects.import">Import project</button></div>
            </fieldset>
          </form>
          {importResult && <p className="reason" role="status">Imported <code>{importResult.project.project.id}</code> at manifest <code>{importResult.manifest_hash.slice(0, 23)}…</code>: {importResult.counts.tickets} tickets, {importResult.counts.memory} memories, {importResult.counts.prompts} prompts{importResult.components_enabled ? "" : " (components not enabled on this host)"}{importResult.replayed ? " (replayed)" : ""}.</p>}
        </details>
        <details className="scaffold section"><summary>Create a new project from a stack profile</summary>
          <form onSubmit={proposeScaffold} className="form-group">
            <fieldset disabled={!client || busy}>
              <label>Stack profile<select aria-label="Stack profile" value={scaffoldProfile} onChange={(event) => setScaffoldProfile(event.target.value as ScaffoldProfile)}>
                {(["python", "node", "node-typescript", "react", "nextjs", "rust", "go", "flutter", "android", "ios"] as ScaffoldProfile[]).map((profile) => <option key={profile} value={profile}>{profile}</option>)}
              </select></label>
              <label>New project name<input value={scaffoldName} onChange={(event) => setScaffoldName(event.target.value)} required spellCheck={false} pattern="[a-z][a-z0-9\-]{0,63}" /></label>
              <label>Parent directory<input value={scaffoldParent} onChange={(event) => setScaffoldParent(event.target.value)} required spellCheck={false} placeholder="/absolute/existing/directory" /></label>
              <div className="form-footer"><small>A proposal lists every file, the baseline command and the tools this host lacks. Nothing is written until you confirm its exact hash.</small><button className="primary" disabled={!scaffoldName.trim() || !scaffoldParent.trim()} data-capability="projects.scaffold.propose">Propose scaffold</button></div>
            </fieldset>
          </form>
          {proposal && <div className="scaffold-proposal" aria-label="Scaffold proposal">
            <p><strong>{proposal.profile}</strong> in <code>{proposal.target_dir}</code> · <StatusBadge tone={proposal.status === "ready" ? "neutral" : "attention"}>{proposal.status}</StatusBadge></p>
            {proposal.blocked_reason && <p className="reason">{proposal.blocked_reason}</p>}
            <ul className="record-list" aria-label="Files the scaffold writes">{proposal.files.map((file) => <li key={file.path}><code>{file.path}</code></li>)}</ul>
            <p>Baseline: {proposal.baseline.map((check) => <code key={check.id}>{[check.executable, ...check.args].join(" ")}</code>)}</p>
            {proposal.required_tools.some((tool) => tool.status === "missing") && <p className="reason">Missing on this host: {proposal.required_tools.filter((tool) => tool.status === "missing").map((tool) => tool.tool).join(", ")}</p>}
            {proposal.network_steps.length > 0 && <p className="reason">Network steps you confirm with the hash: {proposal.network_steps.join("; ")}</p>}
            {proposal.questions.map((question, index) => <p key={index} className="reason">{question.topic}: {question.detail}</p>)}
            <p>Exact proposal hash: <code>{proposal.hash}</code></p>
            <label className="acknowledgment"><input type="checkbox" checked={proposalAcknowledged} disabled={busy || proposal.status !== "ready"} onChange={(event) => setProposalAcknowledged(event.target.checked)} /> I reviewed the files, baseline and hash above</label>
            <button type="button" className="primary" disabled={busy || proposal.status !== "ready" || !proposalAcknowledged} data-capability="projects.scaffold" onClick={confirmScaffold}>Create project and run its baseline</button>
          </div>}
          {scaffoldResult && <p className="reason" role="status">Scaffolded <code>{scaffoldResult.target_dir}</code> at commit <code>{scaffoldResult.commit.slice(0, 12)}</code>; baseline {scaffoldResult.check.status}{scaffoldResult.check.tests_detected !== null ? ` (${scaffoldResult.check.tests_detected} tests detected)` : ""}{scaffoldResult.replayed ? " (replayed)" : ""}.</p>}
        </details>
        {projects.length > 0 && <ul className="project-list" aria-label="Registered projects" data-capability="projects.list">{projects.map((project) => <li key={project.id}>
          <button type="button" className={`run-card ${selected === project.id ? "selected" : ""}`} aria-pressed={selected === project.id} data-capability="projects.show" onClick={() => selectProject(project.id)}>
            <span className="run-prompt">{project.name}</span>
            <span className="run-meta"><StatusBadge tone={manifestTone(project.revision)}>{project.revision > 0 ? `manifest r${project.revision}` : "unconfirmed"}</StatusBadge><code>{project.id}</code></span>
          </button>
        </li>)}</ul>}
      </div>

      <div className="project-detail">
        {view && registration && observation ? <>
          <dl className="facts project-facts">
            <div><dt>{view.repositories.length > 1 ? "Repositories" : "Repository"}</dt><dd>{view.repositories.map((repository, index) => <span key={repository.repository_id}>{index > 0 && " · "}<code>{repository.repository_id}</code> {repository.local_path}</span>)}</dd></div>
            <div><dt>Remote identity</dt><dd>{observation.identity.remote ?? "no portable origin"}{observation.identity.push_remote && ` · push ${observation.identity.push_remote}`}{observation.identity.shallow && " · shallow clone"}</dd></div>
            <div><dt>HEAD at registration</dt><dd><code>{observation.head_commit.slice(0, 12)}</code> on {observation.branch ?? "detached HEAD"}</dd></div>
            <div><dt>Dirty state</dt><dd>{observation.dirty.staged} staged · {observation.dirty.unstaged} unstaged · {observation.dirty.untracked} untracked · {observation.dirty.conflicted} conflicted</dd></div>
            <div><dt>Confirmed manifest</dt><dd>{view.manifest ? <>revision {view.manifest.revision} · <code>{view.manifest.hash.slice(0, 23)}…</code> · base <code>{Object.values(view.manifest.base_commits)[0]?.slice(0, 12)}</code></> : "not yet confirmed"}</dd></div>
          </dl>
          <details className="rebind section"><summary>Rebind repository</summary>
            <form onSubmit={rebind} className="rebind-form">
              <fieldset disabled={busy}>
                {view.repositories.length > 1 && <label>Repository to rebind<select aria-label="Repository to rebind" value={rebindTarget?.repository_id ?? ""} onChange={(event) => setRebindRepository(event.target.value)}>{view.repositories.map((repository) => <option key={repository.repository_id} value={repository.repository_id}>{repository.repository_id}</option>)}</select></label>}
                <label>New repository root path (empty re-inspects the registered path)<input value={rebindPath} onChange={(event) => setRebindPath(event.target.value)} spellCheck={false} placeholder={rebindTarget?.local_path ?? registration.local_path} /></label>
                <label className="checkbox"><input type="checkbox" checked={rebindConfirmed} onChange={(event) => setRebindConfirmed(event.target.checked)} /> I moved this checkout or changed its remote on purpose; bind {rebindTarget?.repository_id ?? registration.repository_id} to it.</label>
                <div className="form-footer"><small>The runtime inspects the checkout read-only and records the old and new identity. Plans, baselines and approvals stay bound to exact commits; a manifest whose remote no longer matches must be confirmed again.</small><button className="primary" disabled={!rebindConfirmed} data-capability="projects.repositories.rebind">Rebind repository</button></div>
              </fieldset>
            </form>
          </details>
          <div className="project-actions actions">
            <button type="button" disabled={busy} data-capability="projects.discover" onClick={discover}>Discover proposed map</button>
            <button type="button" disabled={busy} data-capability="projects.export" onClick={exportProject}>Export project</button>
            <small>Discovery reads manifests and lockfiles; it never runs repository commands. A baseline runs one repository's confirmed required recipes on a clean checkout and records exact evidence; a multi-repository feature needs every repository's passing baseline.</small>
          </div>
          <RepositoryBaselines repositoryIds={repositoryIds} baselines={baselines} running={runningBaselines} busy={busy} manifestConfirmed={view.manifest !== null && view.manifest !== undefined} onRun={runBaseline} onCancel={cancelBaseline} />
          {exported && exported.project.id === selected && <details open className="project-export section"><summary>Project export · omits {exported.omitted.join(", ")}</summary>
            <p><a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(exported, null, 2))}`} download={`luuna-${exported.project.id}-export.json`}>Save export JSON</a> · {exported.tickets.length} tickets, {exported.memory.length} memories, {exported.prompts.length} prompts</p>
            <pre aria-label="Project export" tabIndex={0}>{JSON.stringify(exported, null, 2)}</pre>
          </details>}
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
                <div className="form-footer"><small>Confirmation re-checks identity, remote and default branch against the live checkout and records the exact base commit.</small><button className="primary" data-capability="projects.manifest.confirm">Confirm manifest</button></div>
              </fieldset>
            </form>
          </>}
          <ProjectComponents key={view.project.id} client={client} projectId={view.project.id} connectionEpoch={connectionEpoch} onContextChange={setComponentContext} onStatusChange={setComponentStatus} onChanged={() => setComponentEpoch((value) => value + 1)} />
          <Workflows client={client} projectId={view.project.id} repositoryId={registration.repository_id} repositoryIds={repositoryIds} prerequisites={view.prerequisites ?? []} manifestConfirmed={view.manifest !== null && view.manifest !== undefined} connectionEpoch={connectionEpoch} componentContext={componentContext} componentsEnabled={componentStatus?.enabled ?? false} componentEpoch={componentEpoch} onChanged={() => { if (selected) void guarded("Refresh", (signal) => refresh(selected, signal)); }} />
          <details className="project-events section" data-capability="projects.events"><summary>Project event record ({events.length})</summary>
            <ol className="events" aria-label="Durable project events" tabIndex={0}>{events.map((event) => <li key={event.event_id}><details><summary><span className="event-number">{event.sequence}</span><span>{event.type}</span></summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></li>)}</ol>
          </details>
        </> : <p className="empty empty-box">{client ? "Register a repository or select a project." : "Connect to the runtime to import a repository."}</p>}
      </div>
    </div>
  </section>;
}
