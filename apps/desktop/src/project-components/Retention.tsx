import { Button, Checkbox, Disclosure, FieldRow, Form, FormFooter, Hint, StatusLine, submitted, TextField } from "../ui";
import { retentionPolicyFromForm } from "./model";
import type { ComponentsState } from "./useComponents";

/**
 * Memory retention: a saved policy deletes nothing; applying it deletes every project or process
 * record older than the limit, after an explicit acknowledgment. User memory is never subject to it.
 */
export function MemoryRetention({ state }: { state: ComponentsState }) {
  const { client, projectId, retention, busy, guarded, processDays, projectDays } = state;
  const summary = `Memory retention${retention ? ` · process ${retention.process_max_age_days ?? "kept"} · project ${retention.project_max_age_days ?? "kept"}` : ""}`;
  const save = () => void guarded("Retention policy", async (signal) => {
    const saved = await client!.setMemoryRetention(projectId, retentionPolicyFromForm(processDays, projectDays), signal);
    if (!signal.aborted) state.setRetention(saved);
  });
  const reload = () => void guarded("Retention policy inspection", async (signal) => {
    const policy = await client!.memoryRetention(projectId, signal);
    if (!signal.aborted) state.setRetention(policy);
  });
  const apply = () => void guarded("Retention", async (signal) => {
    const result = await client!.applyMemoryRetention(projectId, { idempotency_key: `retention-${projectId}-${Date.now()}` }, signal);
    if (signal.aborted) return;
    state.setRetentionApplied(result);
    state.setRetentionAcknowledged(false);
    state.setSelectedMemory((ids) => ids.filter((id) => !result.deleted.some((record) => record.id === id)));
  });
  const applied = state.retentionApplied;
  const nothingToApply = !retention || (retention.process_max_age_days === null && retention.project_max_age_days === null);
  return <Disclosure className="memory-retention" summary={summary}>
    <Form className="form-group" onSubmit={submitted(save)} disabled={busy || !client}>
      <FieldRow>
        <TextField label="Process memory max age (days)" type="number" inputMode="numeric" min={1} max={3650} step={1} value={processDays} onChange={(event) => state.setProcessDays(event.target.value)} placeholder="kept" />
        <TextField label="Project memory max age (days)" type="number" inputMode="numeric" min={1} max={3650} step={1} value={projectDays} onChange={(event) => state.setProjectDays(event.target.value)} placeholder="kept" />
      </FieldRow>
      <Hint>An empty field keeps that scope's records. Saving the policy deletes nothing; applying it deletes every project or process record older than the limit through the adapter and records what was deleted. Private user memory is never subject to a project policy.</Hint>
      <FormFooter>
        <Button variant="text" disabled={busy} data-capability="memory.retention.show" onClick={reload}>Reload policy</Button>
        <Button variant="primary" submit data-capability="memory.retention.set">Save retention policy</Button>
      </FormFooter>
    </Form>
    <Checkbox className="acknowledgment" label="Delete every project and process memory record older than the saved policy allows" checked={state.retentionAcknowledged} disabled={busy} onChange={(event) => state.setRetentionAcknowledged(event.target.checked)} />
    <Button variant="danger" disabled={busy || !state.retentionAcknowledged || nothingToApply} data-capability="memory.retention.apply" onClick={apply}>Apply retention now</Button>
    {applied && <StatusLine>{applied.deleted.length === 0
      ? `No memory record exceeded the policy at ${applied.applied_at}.`
      : `Deleted ${applied.deleted.length} expired record(s) at ${applied.applied_at}: ${applied.deleted.map((record) => `${record.id} (${record.scope})`).join(", ")}.`}</StatusLine>}
  </Disclosure>;
}
