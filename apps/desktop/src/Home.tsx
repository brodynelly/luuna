import { useEffect, useState } from "react";
import type { BaselineEvidence, HomeBlocker, HomeSummary, LuunaClient, ProjectView, RunRecord, Ticket } from "@luuna/api-client";
import { homeSummary } from "@luuna/api-client";
import { boundedMap } from "./Workflows";
import { describeFailure } from "./failures";
import { baselineTone, manifestTone, runTone } from "./design/tone";
import { viewInfo } from "./content/views";
import type { View } from "./content/views";
import { Actions, Box, Button, ContextMenuArea, copyText, EmptyState, ErrorBanner, Id, Item, List, Loading, Meta, Page, ReasonNote, RecordItem, RecordList, Section, StatusBadge, useNotify, VisuallyHidden } from "./ui";

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

type Summary = { summary: HomeSummary; busy: boolean; onOpen: (request: OpenRequest) => void };

/** What waits on the developer: testing-setup offers and workflows that stopped. */
function Blockers({ summary, busy, onOpen }: Summary) {
  const count = summary.blockers.length;
  return <Section id="home-waiting" variant="plain" className="home-section" title={<>Waiting on you{count > 0 && <span className="home-count"> {count}</span>}</>}>
    {count > 0 ? <RecordList className="home-blockers" label="Blockers waiting on you">{summary.blockers.map((blocker, index) => {
      const tone = blockerTone(blocker);
      return <RecordItem key={`${blocker.project_id}-${blocker.run_id ?? blocker.repository_id ?? index}`} headed className="home-blocker" tone={tone}>
        <StatusBadge tone={tone}>{blocker.state ? blocker.state.replace(/_/g, " ") : "testing setup"}</StatusBadge>
        <strong>{blocker.title}</strong>
        <Meta>{blocker.project_id}{blocker.run_id && <> · workflow <Id>{blocker.run_id}</Id></>}{blocker.repository_id && <> · repository <Id>{blocker.repository_id}</Id></>}</Meta>
        <ReasonNote tone={tone} reason={blocker.detail} />
        <Actions><Button variant="text" disabled={busy} aria-label={`Open ${blocker.title}`} onClick={() => onOpen({ projectId: blocker.project_id, ticketId: blocker.ticket_id })}>Open</Button></Actions>
      </RecordItem>;
    })}</RecordList> : <EmptyState>Nothing is waiting on you.</EmptyState>}
  </Section>;
}

/** One record per project with its validation health: the latest baseline per repository. */
function ProjectHealth({ summary, busy, onOpen }: Summary) {
  const notify = useNotify();
  return <Section id="home-projects-heading" variant="plain" className="home-section" title="Projects">
    <RecordList className="home-projects" label="Projects and validation health">{summary.projects.map((project) => <RecordItem key={project.id} className="home-project">
      <ContextMenuArea label={`Actions for ${project.name}`} commands={() => [
        { label: "Open project", onSelect: () => onOpen({ projectId: project.id }), disabled: busy },
        { label: "New ticket", onSelect: () => onOpen({ projectId: project.id, ticketForm: true }), disabled: busy || project.revision === 0 },
        { label: "Copy project ID", group: true, onSelect: () => void copyText(project.id).then(() => notify("Project ID copied")) },
      ]}>
      <Box className="home-project-head">
        <strong>{project.name}</strong>
        <StatusBadge tone={manifestTone(project.revision)}>{project.revision > 0 ? `manifest r${project.revision}` : "unconfirmed"}</StatusBadge>
        <Id>{project.id}</Id>
        <Meta>{project.tickets} ticket(s) · {project.active_workflows} active workflow(s)</Meta>
      </Box>
      <List className="home-repositories" label={`Validation health of ${project.name}`}>{project.repositories.map((repository) => <Item key={repository.repository_id}>
        <Id>{repository.repository_id}</Id>
        {repository.baseline ? <StatusBadge tone={baselineTone[repository.baseline.status]}>{repository.baseline.status}</StatusBadge> : <StatusBadge tone="attention">no baseline</StatusBadge>}
        {repository.baseline && <Meta>manifest r{repository.baseline.manifest_revision} · commit <Id>{repository.baseline.commit.slice(0, 12)}</Id></Meta>}
        {repository.prerequisite && <StatusBadge tone="attention">testing setup needed</StatusBadge>}
      </Item>)}</List>
      <Actions className="home-project-actions">
        <Button disabled={busy} onClick={() => onOpen({ projectId: project.id })}>Open {project.name}</Button>
        <Button variant="text" disabled={busy || project.revision === 0} aria-label={`New ticket in ${project.name}`} onClick={() => onOpen({ projectId: project.id, ticketForm: true })}>New ticket</Button>
      </Actions>
      </ContextMenuArea>
    </RecordItem>)}</RecordList>
  </Section>;
}

/** The summary as rendered; pure, so a fixture summary renders without a runtime. */
export function HomeSummaryView({ summary, busy, onOpen, onAddProject }: Summary & { onAddProject?: () => void }) {
  if (summary.projects.length === 0) {
    return <EmptyState boxed title="No projects yet" action={onAddProject && <Button variant="primary" onClick={onAddProject}>Add a project…</Button>}>Add a repository in Projects to get started.</EmptyState>;
  }
  return <>
    <Blockers summary={summary} busy={busy} onOpen={onOpen} />
    <ProjectHealth summary={summary} busy={busy} onOpen={onOpen} />
  </>;
}

/**
 * The Home summary of docs/09-experience.md (ADR 0027 point 4): projects, validation health (the
 * latest baseline per repository), blockers (testing-setup prerequisites and workflows that wait
 * on the developer) and the create-ticket shortcut. A projection only: every control opens the
 * existing Projects panel, where the cataloged actions live.
 */
export function Home({ client, connectionEpoch = 0, refreshEpoch = 0, onOpen, onNavigate }: { client: LuunaClient | null; connectionEpoch?: number; refreshEpoch?: number; onOpen: (request: OpenRequest) => void; onNavigate?: (view: View) => void }) {
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const info = viewInfo("home");

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

  const refresh = <Button variant="text" disabled={!client || busy} onClick={() => setTick((value) => value + 1)}>Refresh<VisuallyHidden> Home</VisuallyHidden></Button>;
  return <Page id="home" title={info.label} description={info.description} actions={refresh} className="home-panel" data-surface="home">
    {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
    {client ? summary ? <HomeSummaryView summary={summary} busy={busy} onOpen={onOpen} onAddProject={onNavigate && (() => onNavigate("projects"))} />
      : !error && <Loading label="Reading the runtime's projects, baselines and workflows…" />
      : <EmptyState boxed>Connect to the runtime to see your projects, their validation health and blockers.</EmptyState>}
  </Page>;
}
