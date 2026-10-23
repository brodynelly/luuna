import type { LuunaClient } from "@luuna/api-client";
import { viewInfo } from "./content/views";
import { Box, Button, EmptyState, ErrorBanner, Loading, Page, Section, SelectField, StatusLine, copyText, useNotify } from "@luuna/ui";
import { executionSummary } from "./orbit/orbit-model";
import { OrbitForms, RepositoryChoice } from "./orbit/OrbitForms";
import { OrbitResults } from "./orbit/OrbitResults";
import { SandboxPanel } from "./orbit/OrbitSandbox";
import { OrbitStatusTable } from "./orbit/OrbitStatus";
import { useOrbit } from "./orbit/useOrbit";

/**
 * Orbit (ADR 0036): every registered repository of one project at once. Status is read-only;
 * exec, recipe and sync are the developer's own commands run by the runtime's supervised
 * executor, never agent actions and never evidence. The sandbox plan comes from the runtime and
 * opens from a terminal, since a browser view cannot host one.
 */
export function Orbit({ client, connectionEpoch = 0, refreshEpoch = 0 }: { client: LuunaClient | null; connectionEpoch?: number; refreshEpoch?: number }) {
  const state = useOrbit(client, connectionEpoch, refreshEpoch);
  const notify = useNotify();
  const info = viewInfo("orbit");
  const { view, projectId, busy } = state;
  const copy = (command: string) => void copyText(command).then(() => notify("Sandbox command copied"), () => state.setError("Copy refused: the clipboard is not available. Select the command and copy it yourself."));
  const actions = <Box className="orbit-toolbar">
    {state.projects.length > 0 && <SelectField label="Project" value={projectId ?? ""} disabled={busy} onChange={(event) => state.setProjectId(event.target.value)} options={state.projects.map((project) => ({ value: project.id, label: project.name }))} />}
    <Button variant="text" disabled={!client || !projectId || state.loading} data-capability="orbit.status" onClick={state.refresh}>Refresh</Button>
  </Box>;

  return <Page id="orbit" title={info.label} description={info.description} actions={actions} className="orbit-panel">
    {state.error && <ErrorBanner message={state.error} onDismiss={() => state.setError("")} />}
    {!client ? <EmptyState boxed>Connect to the runtime to see a project's repositories together.</EmptyState>
      : state.projects.length === 0 ? <EmptyState boxed title="No project yet">Register a project in Projects; Orbit then shows all of its repositories together.</EmptyState>
        : <>
          <Section id="orbit-status-heading" title="Status" className="orbit-status-section" data-capability="orbit.status">
            {view ? <OrbitStatusTable view={view} /> : <Loading label="Reading each repository's status…" rows={4} />}
          </Section>
          {view && <Section id="orbit-actions-heading" title="Commands" className="orbit-actions">
            <RepositoryChoice view={view} selected={state.selected} parallel={state.parallel} disabled={busy} onSelected={state.setSelected} onParallel={state.setParallel} />
            <OrbitForms key={view.project_id} view={view} disabled={busy} actions={state.actions} />
            <StatusLine className="orbit-live">{busy ? "Running in the selected repositories…" : state.execution ? executionSummary(state.execution) : ""}</StatusLine>
          </Section>}
          {state.execution && <Section id="orbit-results-heading" title="Latest results" className="orbit-results-section">
            <OrbitResults execution={state.execution} />
          </Section>}
          {projectId && <Section id="orbit-sandbox-heading" title="Sandbox" className="orbit-sandbox-section" data-capability="orbit.sandbox">
            <SandboxPanel projectId={projectId} network={state.network} plan={state.plan} busy={busy} onNetwork={state.setNetwork} onCopy={copy} />
          </Section>}
        </>}
  </Page>;
}
