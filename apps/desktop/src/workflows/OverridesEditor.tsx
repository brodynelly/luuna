import type { DependencyOverride } from "@luuna/api-client";
import { Box, Button, Hint, options, RecordItem, RecordList, SelectField, TextField } from "../ui";
import type { TaskRow } from "./model";

const ACTIONS = options(["waive", "add"]);

/** The task ids an override may name: the row's own value and every planned task. */
function taskChoices(current: string, tasks: TaskRow[]) {
  return options([...new Set([current, ...tasks.map((task) => task.repository_id)])].filter(Boolean));
}

/**
 * Departures from the confirmed repository relationships, hashed with the plan (ADR 0023): waive a
 * dependency a confirmed relationship implies, or add one between repositories with none.
 */
export function OverridesEditor({ rows, tasks, onChange }: { rows: DependencyOverride[]; tasks: TaskRow[]; onChange: (next: (rows: DependencyOverride[]) => DependencyOverride[]) => void }) {
  const change = (index: number, patch: Partial<DependencyOverride>) => onChange((all) => all.map((item, i) => i === index ? { ...item, ...patch } : item));
  return <Box className="plan-overrides" role="group" aria-label="Dependency overrides">
    <Hint>Departures from the confirmed repository relationships, hashed with the plan (ADR 0023): waive a dependency a confirmed relationship implies, or add one between repositories with no confirmed relationship. The runtime refuses an override that applies to nothing and names the override a refused plan needs.</Hint>
    <RecordList className="override-rows" label="Dependency override rows">{rows.map((row, index) => <RecordItem key={index} className="override-row field-row">
      <SelectField label="Consumer task" aria-label={`Override ${index + 1} consumer`} value={row.consumer} onChange={(event) => change(index, { consumer: event.target.value })} options={taskChoices(row.consumer, tasks)} />
      <SelectField label="Producer task" aria-label={`Override ${index + 1} producer`} value={row.producer} onChange={(event) => change(index, { producer: event.target.value })} options={taskChoices(row.producer, tasks)} />
      <SelectField label="Action" aria-label={`Override ${index + 1} action`} value={row.action} onChange={(event) => change(index, { action: event.target.value as DependencyOverride["action"] })} options={ACTIONS} />
      <TextField label="Justification" value={row.justification} onChange={(event) => change(index, { justification: event.target.value })} required placeholder="why this plan departs from the confirmed relationship" />
      <Button variant="text" onClick={() => onChange((all) => all.filter((_, i) => i !== index))}>Remove override {index + 1}</Button>
    </RecordItem>)}</RecordList>
    <Button variant="text" onClick={() => onChange((all) => [...all, { consumer: tasks[0]?.repository_id ?? "", producer: tasks[1]?.repository_id ?? "", action: "waive", justification: "" }])}>Add override</Button>
  </Box>;
}
