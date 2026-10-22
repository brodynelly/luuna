import { Button, Checkbox, FieldRow, Hint, TextField, Tray } from "../ui";
import { TaskGraphEditor } from "./TaskGraphEditor";
import type { Patch, RunSettings as Settings } from "./settings";

interface Props {
  settings: Settings;
  update: (patch: Patch<Settings>) => void;
  repositoryId: string;
  repositoryIds: string[];
  error: string;
}

/** The settings the next plan, approval and action use: scope, budgets, provider and model, automatic repair. */
export function RunSettings({ settings, update, repositoryId, repositoryIds, error }: Props) {
  const openGraph = () => update({ taskRows: [
    { repository_id: repositoryId, paths: settings.paths, write: settings.write, depends_on: [] },
    { repository_id: repositoryIds.find((id) => id !== repositoryId) ?? repositoryId, paths: "src", write: true, depends_on: [] },
  ] });
  return <Tray className="run-settings">
    {settings.taskRows.length === 0 ? <FieldRow className="plan-controls">
      <TextField label="Writer paths (comma separated)" mono value={settings.paths} onChange={(event) => update({ paths: event.target.value })} />
      <Checkbox className="checkbox" label="allow writes" checked={settings.write} onChange={(event) => update({ write: event.target.checked })} />
      <TextField label="Approver" value={settings.approver} onChange={(event) => update({ approver: event.target.value })} />
      {repositoryIds.length > 1 && <Button variant="text" onClick={openGraph}>Plan a task graph across repositories</Button>}
    </FieldRow> : <TaskGraphEditor settings={settings} update={update} repositoryId={repositoryId} repositoryIds={repositoryIds} error={error} />}
    <FieldRow className="plan-budgets">
      <TextField label="Writer attempts" type="number" inputMode="numeric" min={1} max={10} step={1} value={settings.attempts} onChange={(event) => update({ attempts: event.target.value })} />
      <TextField label="Time budget (seconds)" type="number" inputMode="numeric" min={1} max={86400} step={1} value={settings.timeoutSeconds} onChange={(event) => update({ timeoutSeconds: event.target.value })} />
      <TextField label="Cost budget (USD)" type="number" inputMode="decimal" min={0.000001} max={1000} step="any" value={settings.costDollars} onChange={(event) => update({ costDollars: event.target.value })} />
      <Hint>Budgets for the next plan revision, approved with its hash: 1 to 10 writer attempts, up to 86400 seconds and $1000. Time and cost are cumulative across the writer, checks, independent review and repairs.</Hint>
    </FieldRow>
    <FieldRow className="model-fields workflow-models">
      <TextField label="Workflow provider" mono value={settings.provider} onChange={(event) => update({ provider: event.target.value })} placeholder="Runtime default" maxLength={128} />
      <TextField label="Workflow model" mono value={settings.model} onChange={(event) => update({ model: event.target.value })} placeholder="Runtime default" maxLength={256} />
      <Hint>Applies to the next writer, validation/reviewer or repair action. Every independent review uses a fresh session.</Hint>
    </FieldRow>
    <Checkbox className="workflow-auto-repair" label="Repair automatically within approved budgets" checked={settings.autoRepair} onChange={(event) => update({ autoRepair: event.target.checked })} />
  </Tray>;
}
