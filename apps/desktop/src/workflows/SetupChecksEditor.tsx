import type { Ticket } from "@luuna/api-client";
import { Button, Id, Inline, Meta, RecordItem, RecordList, Stack, Surface, TextField } from "@luuna/ui";
import { EMPTY_CHECK_ROW } from "./model";
import type { CheckRow } from "./model";

/** The setup plan's check recipes (ADR 0022 point 3): the manifest-check shape, always required; the approver sees the exact recipes in the plan. */
export function SetupChecksEditor({ ticket, rows, busy, onChange }: { ticket: Ticket; rows: CheckRow[]; busy: boolean; onChange: (rows: CheckRow[]) => void }) {
  const update = (index: number, patch: Partial<CheckRow>) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <Surface level="muted" padded className="setup-checks" role="group" aria-label={`Setup check recipes for ${ticket.id}`}><Stack gap={2}>
    <Meta>This is a testing-setup ticket. Its plan proposes these required check recipes for <Id>{ticket.repository_ids[0]}</Id>; the setup candidate must pass them with at least one counted test, and after review you confirm them in the manifest and run the baseline. Left empty, the confirmed manifest's required recipes are used.</Meta>
    <RecordList className="check-rows" label="Check recipes">{rows.map((row, index) => <RecordItem key={index} className="check-row field-row">
      <TextField label="Recipe id" mono value={row.id} disabled={busy} onChange={(event) => update(index, { id: event.target.value })} />
      <TextField label="Executable" mono value={row.executable} disabled={busy} onChange={(event) => update(index, { executable: event.target.value })} placeholder="python" />
      <TextField label="Arguments (space separated)" mono value={row.args} disabled={busy} onChange={(event) => update(index, { args: event.target.value })} placeholder="-m unittest" />
      <TextField label="Working directory (relative; empty is the repository root)" mono value={row.cwd} disabled={busy} onChange={(event) => update(index, { cwd: event.target.value })} />
      <TextField label="Timeout (seconds)" type="number" inputMode="numeric" min={1} step={1} value={row.timeout} disabled={busy} onChange={(event) => update(index, { timeout: event.target.value })} />
      {rows.length > 1 && <Button variant="text" disabled={busy} onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove recipe {index + 1}</Button>}
    </RecordItem>)}</RecordList>
    <Inline><Button variant="text" disabled={busy} onClick={() => onChange([...rows, { ...EMPTY_CHECK_ROW, id: `check-${rows.length + 1}` }])}>Add recipe</Button></Inline>
  </Stack></Surface>;
}
