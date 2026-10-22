import type { ProjectRecord } from "@luuna/api-client";
import { Box, ContextMenuArea, copyText, Disclosure, Id, Item, RecordList, SelectableCard, StatusBadge, useNotify } from "../ui";
import { manifestTone } from "../design/tone";
import { ImportForm } from "./ImportForm";
import { RegisterForm } from "./RegisterForm";
import { ScaffoldForm } from "./ScaffoldForm";
import type { ProjectActions } from "./project-actions";

/** The manifest chip of a project: its confirmed revision, or that none is confirmed yet. */
export function ManifestBadge({ revision }: { revision: number }) {
  return <StatusBadge tone={manifestTone(revision)}>{revision > 0 ? `manifest r${revision}` : "unconfirmed"}</StatusBadge>;
}

/**
 * The rail: the registered projects first, then the ways to add one, folded away. "Add a
 * project" is open while no project exists, so the first screen is the form itself.
 */
export function ProjectRail({ projects, selected, disabled, busy, actions }: { projects: ProjectRecord[]; selected: string | null; disabled: boolean; busy: boolean; actions: ProjectActions }) {
  const notify = useNotify();
  return <Box className="projects-rail">
    {projects.length > 0 && <RecordList className="project-list" label="Registered projects" data-capability="projects.list">
      {projects.map((project) => <Item key={project.id}>
        <ContextMenuArea label={`Actions for ${project.name}`} commands={() => [
          { label: "Open project", onSelect: () => actions.selectProject(project.id) },
          { label: "Copy project ID", group: true, onSelect: () => void copyText(project.id).then(() => notify("Project ID copied")) },
        ]}>
          <SelectableCard selected={selected === project.id} data-capability="projects.show" onSelect={() => actions.selectProject(project.id)}
            title={project.name} meta={<><ManifestBadge revision={project.revision} /><Id>{project.id}</Id></>} />
        </ContextMenuArea>
      </Item>)}
    </RecordList>}
    <Disclosure className="add-project" summary="Add a project" open={projects.length === 0}>
      <RegisterForm disabled={disabled} onRegister={actions.register} />
    </Disclosure>
    <Disclosure className="import" summary="Import from another machine">
      <ImportForm disabled={disabled} onImport={actions.importProject} />
    </Disclosure>
    <Disclosure className="scaffold" summary="Create from a stack profile">
      <ScaffoldForm disabled={disabled} busy={busy} actions={actions.scaffold} />
    </Disclosure>
  </Box>;
}
