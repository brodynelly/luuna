import { Box, Button, Disclosure, ErrorBanner, Hint, Id, Section, StatusLine } from "../ui";
import { AtlasMemory } from "./AtlasMemory";
import { BeaconPrompts } from "./Prompts";
import { useComponents } from "./useComponents";
import type { ComponentsProps } from "./useComponents";

/** A project's components: tickets in Missions, knowledge in Atlas, prompts in Beacon. The runtime owns component storage, authority and resource identity. */
export function ProjectComponents(props: ComponentsProps) {
  const state = useComponents(props);
  const { client, projectId, status, busy, loading, selectedMemory, selectedPrompt } = state;
  const enable = () => void state.guarded("Component activation", async (signal) => {
    const next = await client!.enableComponents(projectId, signal);
    if (signal.aborted) return;
    state.setStatus(next); state.onStatusChange(next);
  });
  return <Section id="components-heading" variant="subpanel" className="project-components" title="Project components"
    description="Tickets in Missions, chosen knowledge in Atlas and versioned prompts in Beacon. What you select here is bound into the plan you approve."
    accessory={<Button variant="text" disabled={!client || busy || loading} data-capability="components.status" onClick={() => state.setRefreshTick((value) => value + 1)}>Refresh components</Button>}>
    {state.error && <ErrorBanner message={state.error} onDismiss={() => state.setError("")} />}
    <StatusLine className="component-status">{loading ? "Refreshing component state…" : status?.enabled ? "Project components enabled" : status?.reason ?? "Project components are not enabled."}</StatusLine>
    {!status?.enabled && <Button variant="primary" disabled={!client || busy || loading || status === null} data-capability="components.enable" onClick={enable}>Enable project components</Button>}
    {status?.enabled && <>
      {status.workspace_path && <Disclosure section={false} className="component-location" summary="Component data location">
        <Id>{status.workspace_path}</Id>
        <Hint>Managed local stores support external CLI edits; refresh and reconcile before re-planning a changed ticket.</Hint>
      </Disclosure>}
      <Box className="component-columns">
        <AtlasMemory state={state} />
        <BeaconPrompts state={state} />
      </Box>
      <StatusLine className="component-context">
        Next plan: {selectedMemory.length} selected memory record(s){selectedPrompt ? ` · ${selectedPrompt.name} v${selectedPrompt.version}` : " · no prompt selected"}. Selected content and provenance appear in the plan for review and are sent to the writer and reviewer only after approval. Private user memory requires explicit selection.
      </StatusLine>
    </>}
  </Section>;
}
