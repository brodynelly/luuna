import type { ProjectRecord } from "@luuna/api-client";
import { copyText, Disclosure, Id, ListGroup, ListRow, Stack, StatusBadge, useNotify, manifestTone } from "@luuna/ui";
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
  return <Stack className="projects-rail" gap={3}>
    {projects.length > 0 && <ListGroup className="project-list" aria-label="Registered projects" data-capability="projects.list">
      {projects.map((project) => <ListRow key={project.id} className="run-card" data-capability="projects.show"
        selected={selected === project.id} onOpen={() => actions.selectProject(project.id)}
        title={project.name} meta={<Id>{project.id}</Id>} trailing={<ManifestBadge revision={project.revision} />}
        menuLabel={`Actions for ${project.name}`} commands={() => [
          { label: "Open project", onSelect: () => actions.selectProject(project.id) },
          { label: "Copy project ID", group: true, onSelect: () => void copyText(project.id).then(() => notify("Project ID copied")) },
        ]} />)}
    </ListGroup>}
    <Disclosure className="add-project" summary="Add a project" open={projects.length === 0}>
      <RegisterForm disabled={disabled} onRegister={actions.register} />
    </Disclosure>
    <Disclosure className="import" summary="Import from another machine">
      <ImportForm disabled={disabled} onImport={actions.importProject} />
    </Disclosure>
    <Disclosure className="scaffold" summary="Create from a stack profile">
      <ScaffoldForm disabled={disabled} busy={busy} actions={actions.scaffold} />
    </Disclosure>
  </Stack>;
}
