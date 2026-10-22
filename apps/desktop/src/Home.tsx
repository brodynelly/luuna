import { useEffect, useState } from "react";
import type { BaselineEvidence, HomeBlocker, HomeSummary, LuunaClient, ProjectView, RunRecord, Ticket } from "@luuna/api-client";
import { homeSummary } from "@luuna/api-client";
import { boundedMap } from "./Workflows";
import { describeFailure } from "./failures";
import { StatusBadge } from "./design/StatusBadge";
import { baselineTone, manifestTone, runTone } from "./design/tone";

/** Where a Home control sends the developer: the project's panel, its ticket form, or one ticket. */
export interface OpenRequest { projectId: string; ticketId?: string; ticketForm?: boolean }

/**
 * One read of everything the Home summary projects (docs/09-experience.md): every project's view
 * (with its testing-setup offers), its recorded baselines and tickets, and the run listing. The
 * runtime's records are projected by `homeSummary`, the same projection `luuna-tui home` prints.
 */
export async function readHome(client: Pick<LuunaClient, "listProjects" | "project" | "listBaselines" | "listTickets" | "listRuns">, signal: AbortSignal): Promise<HomeSummary> {
  const [projects, runs] = await Promise.all([client.listProjects(signal), client.listRuns(signal)]);
  const details = await boundedMap(projects, (project) => Promise.all([client.project(project.id, signal), client.listBaselines(project.id, signal), client.listTickets(project.id, signal)]));
  const views: ProjectView[] = details.map(([view]) => view);
  const baselines: Record<string, BaselineEvidence[]> = Object.fromEntries(details.map(([view, recorded]) => [view.project.id, recorded]));
  const tickets: Record<string, Ticket[]> = Object.fromEntries(details.map(([view, , listed]) => [view.project.id, listed]));
  return homeSummary({ projects: views, baselines, tickets, runs: runs as RunRecord[] });
}

function blockerTone(blocker: HomeBlocker) {
  return blocker.kind === "prerequisite" || !blocker.state ? "attention" : runTone[blocker.state];
}

/** The summary as rendered; pure, so a fixture summary renders without a runtime. */
export function HomeSummaryView({ summary, busy, onOpen }: { summary: HomeSummary; busy: boolean; onOpen: (request: OpenRequest) => void }) {
  if (summary.projects.length === 0) return <p className="empty empty-box">No projects registered. Register a repository in the Projects panel below to start.</p>;
  return <>
    <ul className="home-projects record-list" aria-label="Projects and validation health">{summary.projects.map((project) => <li key={project.id} className="record home-project">
      <div className="home-project-head"><strong>{project.name}</strong><StatusBadge tone={manifestTone(project.revision)}>{project.revision > 0 ? `manifest r${project.revision}` : "unconfirmed"}</StatusBadge><code>{project.id}</code><small className="meta">{project.tickets} ticket(s) · {project.active_workflows} active workflow(s)</small></div>
      <ul className="home-repositories" aria-label={`Validation health of ${project.name}`}>{project.repositories.map((repository) => <li key={repository.repository_id}>
        <code>{repository.repository_id}</code>
        {repository.baseline ? <StatusBadge tone={baselineTone[repository.baseline.status]}>{repository.baseline.status}</StatusBadge> : <StatusBadge tone="attention">no baseline</StatusBadge>}
        {repository.baseline && <small className="meta">manifest r{repository.baseline.manifest_revision} · commit <code>{repository.baseline.commit.slice(0, 12)}</code></small>}
        {repository.prerequisite && <StatusBadge tone="attention">testing setup needed</StatusBadge>}
      </li>)}</ul>
      <div className="home-project-actions actions">
        <button type="button" disabled={busy} onClick={() => onOpen({ projectId: project.id })}>Open project {project.name}</button>
        <button type="button" className="text-button" disabled={busy || project.revision === 0} onClick={() => onOpen({ projectId: project.id, ticketForm: true })}>Create a ticket in {project.name}</button>
      </div>
    </li>)}</ul>
    {summary.blockers.length > 0 ? <ul className="home-blockers record-list" aria-label="Blockers waiting on you">{summary.blockers.map((blocker, index) => <li key={`${blocker.project_id}-${blocker.run_id ?? blocker.repository_id ?? index}`} className="record record-headed home-blocker" data-tone={blockerTone(blocker)}>
      <StatusBadge tone={blockerTone(blocker)}>{blocker.state ? blocker.state.replace(/_/g, " ") : "testing setup"}</StatusBadge>
      <strong>{blocker.title}</strong>
      <small className="meta">{blocker.project_id}{blocker.run_id && <> · workflow <code>{blocker.run_id}</code></>}{blocker.repository_id && <> · repository <code>{blocker.repository_id}</code></>}</small>
      <small className="failure-note" data-tone={blockerTone(blocker)}>{blocker.detail}</small>
      <div className="actions"><button type="button" className="text-button" disabled={busy} onClick={() => onOpen({ projectId: blocker.project_id, ticketId: blocker.ticket_id })}>Open in Projects</button></div>
    </li>)}</ul> : <p className="empty">No blockers: no testing-setup prerequisite is offered and no workflow is failed, paused, interrupted or testing blocked.</p>}
  </>;
}

/**
 * The Home summary of docs/09-experience.md (ADR 0027 point 4): projects, validation health (the
 * latest baseline per repository), blockers (testing-setup prerequisites and workflows that wait
 * on the developer) and the create-ticket shortcut. A projection only: every control opens the
 * existing Projects panel, where the cataloged actions live.
 */
export function Home({ client, connectionEpoch = 0, refreshEpoch = 0, onOpen }: { client: LuunaClient | null; connectionEpoch?: number; refreshEpoch?: number; onOpen: (request: OpenRequest) => void }) {
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setSummary(null);
    setError("");
    if (!client) return;
    const controller = new AbortController();
    setBusy(true);
    readHome(client, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setSummary(next);
      setError("");
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(describeFailure(failure));
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [client, connectionEpoch, refreshEpoch, tick]);

  return <section className="panel home-panel" aria-labelledby="home-heading" data-surface="home">
    <div className="panel-heading"><h2 id="home-heading">Home</h2><span className="tag">Projects · validation health · blockers</span><button type="button" className="text-button" disabled={!client || busy} onClick={() => setTick((value) => value + 1)}>Refresh home</button></div>
    <p className="scope">A summary of the runtime's records: each project's latest baseline per repository, and what waits on you. Everything here opens the Projects panel, where the actions live; nothing is decided on this page.</p>
    {error && <div className="error" role="alert">{error}<button className="text-button" type="button" onClick={() => setError("")}>Dismiss</button></div>}
    {client ? summary ? <HomeSummaryView summary={summary} busy={busy} onOpen={onOpen} /> : !error && <p className="empty">Reading the runtime's projects, baselines and workflows…</p> : <p className="empty empty-box">Connect to the runtime to see your projects, their validation health and blockers.</p>}
  </section>;
}
