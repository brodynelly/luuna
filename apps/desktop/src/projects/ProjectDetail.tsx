import type { LuunaClient } from "@luuna/api-client";
import { Actions, Button, Card, CodeBlock, Disclosure, DownloadLink, EmptyState, Facts, HeadingRow, Hint, Id, Meta } from "../ui";
import { Workflows } from "../Workflows";
import { ProjectComponents } from "../project-components/ProjectComponents";
import { BaselineList, RepositoryBaselines } from "./Baselines";
import { DiscoveryReview } from "./Discovery";
import { EventRecord } from "./EventRecord";
import { ManifestBadge } from "./ProjectRail";
import { RebindForm } from "./RebindForm";
import { jsonDataUrl } from "./project-model";
import type { ProjectActions } from "./project-actions";
import type { ProjectsState } from "./useProjects";

/** What the runtime observed at registration and the confirmed manifest, as exact identities. */
function ProjectFacts({ state }: { state: ProjectsState }) {
  const view = state.view!;
  const observation = view.repositories[0]!.observation!;
  const manifest = view.manifest;
  return <Facts className="project-facts" items={[
    { term: view.repositories.length > 1 ? "Repositories" : "Repository", value: view.repositories.map((repository, index) => <span key={repository.repository_id}>{index > 0 && " · "}<Id>{repository.repository_id}</Id> {repository.local_path}</span>) },
    { term: "Remote identity", value: <>{observation.identity.remote ?? "no portable origin"}{observation.identity.push_remote && ` · push ${observation.identity.push_remote}`}{observation.identity.shallow && " · shallow clone"}</> },
    { term: "HEAD at registration", value: <><Id>{observation.head_commit.slice(0, 12)}</Id> on {observation.branch ?? "detached HEAD"}</> },
    { term: "Dirty state", value: `${observation.dirty.staged} staged · ${observation.dirty.unstaged} unstaged · ${observation.dirty.untracked} untracked · ${observation.dirty.conflicted} conflicted` },
    { term: "Confirmed manifest", value: manifest ? <>revision {manifest.revision} · <Id>{manifest.hash.slice(0, 23)}…</Id> · base <Id>{Object.values(manifest.base_commits)[0]?.slice(0, 12)}</Id></> : "not yet confirmed" },
  ]} />;
}

/**
 * The selected project: its header and facts, the rebind form, its actions and baselines, the
 * discovery proposal, its components, its tickets and workflows, then its event record.
 */
export function ProjectDetail({ client, connectionEpoch, state, actions }: { client: LuunaClient | null; connectionEpoch: number; state: ProjectsState; actions: ProjectActions }) {
  const { view, busy, baselines, discovery, exported, selected } = state;
  const registration = view?.repositories[0];
  if (!view || !registration?.observation) {
    return <Card className="project-detail">
      <EmptyState boxed>{client ? state.projects.length ? "Select a project to see its checks, tickets and history." : "Add your first project to get started." : "Connect to the runtime to import a repository."}</EmptyState>
    </Card>;
  }
  const repositoryIds = view.repositories.map((repository) => repository.repository_id);
  const manifestConfirmed = view.manifest !== null && view.manifest !== undefined;
  // The baseline run in flight per repository: accepted and pending, or recorded as running.
  const running: Record<string, string | undefined> = Object.fromEntries(repositoryIds.map((id) => [id, state.pendingBaselineRuns[id] ?? baselines.find((baseline) => baseline.identity.repository_id === id && baseline.status === "running")?.run_id]));
  const shownLog = state.baselineLog && baselines.some((baseline) => baseline.run_id === state.baselineLog!.runId) ? state.baselineLog : null;
  return <Card className="project-detail">
    <HeadingRow level={3} id="project-detail-heading" className="project-header" title={view.project.name} accessory={<><ManifestBadge revision={view.project.revision} /><Id>{view.project.id}</Id></>} />
    <ProjectFacts state={state} />
    <RebindForm key={view.project.id} view={view} busy={busy} onRebind={actions.rebind} />
    <Actions className="project-actions">
      <Button disabled={busy} data-capability="projects.discover" onClick={actions.discover}>Discover proposed map</Button>
      <Button disabled={busy} data-capability="projects.export" onClick={actions.exportProject}>Export project</Button>
      <Hint>Discovery reads manifests and lockfiles without running anything. A baseline runs a repository's confirmed checks on a clean checkout; a feature across repositories needs each one's passing baseline.</Hint>
    </Actions>
    <RepositoryBaselines repositoryIds={repositoryIds} baselines={baselines} running={running} busy={busy} manifestConfirmed={manifestConfirmed} onRun={actions.runBaseline} onCancel={actions.cancelBaseline} />
    {exported && exported.project.id === selected && <Disclosure open className="project-export" summary={`Project export · omits ${exported.omitted.join(", ")}`}>
      <Meta block className="export-link"><DownloadLink href={jsonDataUrl(exported)} file={`luuna-${exported.project.id}-export.json`}>Save export JSON</DownloadLink> · {exported.tickets.length} tickets, {exported.memory.length} memories, {exported.prompts.length} prompts</Meta>
      <CodeBlock label="Project export">{JSON.stringify(exported, null, 2)}</CodeBlock>
    </Disclosure>}
    <BaselineList baselines={baselines} busy={busy} onLog={actions.viewBaselineLog} />
    {shownLog && <Disclosure open className="baseline-log" summary={<>Baseline log · <Id>{shownLog.artifactId}</Id></>}>
      <CodeBlock label="Baseline log">{shownLog.text || "Empty log."}</CodeBlock>
    </Disclosure>}
    {discovery && <DiscoveryReview discovery={discovery} view={view} draft={state.draft} busy={busy} onDraft={state.setDraft} onConfirm={actions.confirm} />}
    <ProjectComponents key={view.project.id} client={client} projectId={view.project.id} connectionEpoch={connectionEpoch} onContextChange={state.setComponentContext} onStatusChange={state.setComponentStatus} onChanged={() => state.setComponentEpoch((value) => value + 1)} />
    <Workflows focusTicket={state.requested?.projectId === view.project.id ? state.requested : null} client={client} projectId={view.project.id} repositoryId={registration.repository_id} repositoryIds={repositoryIds} prerequisites={view.prerequisites ?? []}
      manifestConfirmed={manifestConfirmed} connectionEpoch={connectionEpoch} componentContext={state.componentContext} componentsEnabled={state.componentStatus?.enabled ?? false} componentEpoch={state.componentEpoch}
      onChanged={() => { if (selected) void state.guarded("Refresh", (signal) => state.refresh(selected, signal)); }} />
    <Disclosure className="project-events" data-capability="projects.events" summary={`Project event record (${state.events.length})`}>
      <EventRecord label="Durable project events" events={state.events} />
    </Disclosure>
  </Card>;
}
