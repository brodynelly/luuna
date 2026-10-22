import type { DependencyOverride, TaskRole } from "@luuna/api-client";
import { TASK_ROLES, advisoryRole } from "@luuna/api-client";
import { Box, Button, Checkbox, FieldRow, Hint, options, RecordItem, RecordList, SelectField, TextField } from "../ui";
import type { TaskRow } from "./model";
import { OverridesEditor } from "./OverridesEditor";
import type { Patch, RunSettings } from "./settings";

interface Props {
  settings: RunSettings;
  update: (patch: Patch<RunSettings>) => void;
  repositoryId: string;
  repositoryIds: string[];
  /** The last refusal: a relationship refusal opens the overrides editor. */
  error: string;
}

const ADVISORY_NOTE = " (an advisory role reads only and records findings, proposed tasks and risks)";

/** One task row: repository, role, paths, writes, derivation and the rows it waits for. */
function TaskRowFields({ row, index, rows, repositoryIds, change, remove }: { row: TaskRow; index: number; rows: TaskRow[]; repositoryIds: string[]; change: (patch: Partial<TaskRow>) => void; remove: () => void }) {
  const advisory = advisoryRole(row.role);
  return <RecordItem className="task-row field-row">
    <SelectField label="Repository" aria-label={`Task ${index + 1} repository`} value={row.repository_id} onChange={(event) => change({ repository_id: event.target.value })} options={options([...new Set([...repositoryIds, row.repository_id])])} />
    <SelectField label="Role" aria-label={`Task ${index + 1} role`} value={row.role ?? "implementer"} onChange={(event) => change({ role: event.target.value as TaskRole, write: advisoryRole(event.target.value) ? false : row.write })} options={options(TASK_ROLES, (role) => role.replace(/_/g, " "))} />
    <TextField label="Writer paths (comma separated)" mono value={row.paths} onChange={(event) => change({ paths: event.target.value })} />
    <Checkbox className="checkbox" label={`allow writes${advisory ? ADVISORY_NOTE : ""}`} checked={row.write && !advisory} disabled={advisory} onChange={(event) => change({ write: event.target.checked })} />
    <TextField label="Derived from advisory task" mono value={row.derived_from_task ?? ""} onChange={(event) => change({ derived_from_task: event.target.value })} placeholder="task id of an earlier revision" />
    <span className="task-dependencies" role="group" aria-label={`Task ${index + 1} waits for`}>after: {rows.filter((_, i) => i !== index).map((other) => <Checkbox key={other.repository_id} className="checkbox" label={other.repository_id}
      checked={row.depends_on.includes(other.repository_id)}
      onChange={(event) => change({ depends_on: event.target.checked ? [...row.depends_on, other.repository_id] : row.depends_on.filter((id) => id !== other.repository_id) })} />)}</span>
    <Button variant="text" onClick={remove}>Remove task {index + 1}</Button>
  </RecordItem>;
}

/** The task graph of the next plan (ADR 0017): one task per repository, its dependencies and the concurrent writers. */
export function TaskGraphEditor({ settings, update, repositoryId, repositoryIds, error }: Props) {
  const rows = settings.taskRows;
  const setRows = (next: (rows: TaskRow[]) => TaskRow[]) => update((current) => ({ taskRows: next(current.taskRows) }));
  const setOverrides = (next: (rows: DependencyOverride[]) => DependencyOverride[]) => update((current) => ({ overrideRows: next(current.overrideRows) }));
  return <Box className="plan-task-graph" id="plan-task-graph">
    <RecordList className="task-rows" label="Plan tasks">{rows.map((row, index) => <TaskRowFields key={index} row={row} index={index} rows={rows} repositoryIds={repositoryIds}
      change={(patch) => setRows((all) => all.map((item, i) => i === index ? { ...item, ...patch } : item))}
      remove={() => setRows((all) => all.filter((_, i) => i !== index).map((item) => ({ ...item, depends_on: item.depends_on.filter((id) => id !== row.repository_id) })))} />)}</RecordList>
    <FieldRow>
      <Button variant="text" onClick={() => setRows((all) => [...all, { repository_id: repositoryIds.find((id) => !all.some((row) => row.repository_id === id)) ?? repositoryId, paths: "src", write: true, depends_on: [] }])}>Add task</Button>
      <TextField label="Concurrent writers" type="number" inputMode="numeric" min={1} max={Math.min(4, Math.max(1, rows.length))} step={1} value={settings.maxWorkers} onChange={(event) => update({ maxWorkers: event.target.value })} aria-describedby="plan-workers-note" />
      <TextField label="Approver" value={settings.approver} onChange={(event) => update({ approver: event.target.value })} />
      <Button variant="text" onClick={() => update({ taskRows: [] })}>Back to one task</Button>
    </FieldRow>
    <Hint id="plan-workers-note">Each task targets a distinct repository; a task runs after the tasks it waits for, and the runtime binds their exact candidates into its writer and checks. Writers run concurrently up to this many (1 to the number of tasks, at most 4). A repository lead or project orchestrator reads only and records findings, proposed tasks and risks; a task derived from such a proposal names it, so the assignment trace keeps its parent.</Hint>
    {(settings.overrideRows.length > 0 || /dependency_overrides/.test(error)) && <OverridesEditor rows={settings.overrideRows} tasks={rows} onChange={setOverrides} />}
  </Box>;
}
