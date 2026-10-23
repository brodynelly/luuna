import { useState } from "react";
import type { MemoryRecord } from "@luuna/api-client";
import { Button, Checkbox, Form, FormFooter, Hint, Id, Inline, ListGroup, ListRow, Meta, Stack, submitted, TextArea, ShortId, shortId } from "@luuna/ui";
import { promotionTarget } from "./model";

/**
 * Corrects one record in place at its displayed hash: the record keeps its identity and scope,
 * and the runtime names the correction and the replaced hash in its provenance. A corrected
 * record selected by an approved plan makes that plan stale; the form says so.
 */
export function MemoryCorrection({ record, busy, onSave, onCancel }: { record: MemoryRecord; busy: boolean; onSave: (content: string) => void; onCancel: () => void }) {
  const [content, setContent] = useState(record.content);
  const changed = content.trim() !== "" && content.trim() !== record.content;
  return <Form className="memory-correction form-group" onSubmit={submitted(() => { if (changed) onSave(content.trim()); })} disabled={busy}>
    <TextArea label={<>Corrected content for <Id>{shortId(record.id)}</Id></>} value={content} onChange={(event) => setContent(event.target.value)} required rows={3} maxLength={16000} />
    <Hint>Replaces the content at hash <ShortId value={record.hash} kind="content hash" />; the record keeps its {record.scope} scope and its provenance records the correction. An approved plan that selected this record can no longer be implemented until it is re-planned.</Hint>
    <FormFooter>
      <Button variant="primary" submit disabled={!changed} data-capability="memory.update">Save correction</Button>
      <Button variant="text" onClick={onCancel}>Cancel correction</Button>
    </FormFooter>
  </Form>;
}

/** Atlas records with their scope and provenance; none is selected until the developer ticks it. */
export function MemorySelection({ records, selected, busy, onToggle, onDelete, onPromote, onCorrect }: {
  records: MemoryRecord[]; selected: string[]; busy: boolean;
  onToggle: (record: MemoryRecord) => void; onDelete: (record: MemoryRecord) => void;
  onPromote?: (record: MemoryRecord, toScope: "project" | "user") => void; onCorrect?: (record: MemoryRecord, content: string) => void;
}) {
  const [correcting, setCorrecting] = useState<string | null>(null);
  return <ListGroup className="component-records" aria-label="Atlas memory records">{records.map((record) => {
    const target = promotionTarget(record.scope);
    return <ListRow key={record.id} title={<span className="component-content">{record.content}</span>}
      meta={<Hint>{record.scope === "user" ? "Private user memory" : `${record.scope} memory`} · provenance: {record.provenance}</Hint>}
      detail={<Stack gap={2}>
        <Checkbox className="component-selection" label="Include this memory in the next plan" checked={selected.includes(record.id)} disabled={busy} onChange={() => onToggle(record)} />
        <Meta block className="component-record-meta"><ShortId value={record.id} kind="memory id" /></Meta>
        <Inline gap={1} align="center" wrap className="component-record-actions">
          <Button variant="text" disabled={busy} data-capability="memory.delete" onClick={() => onDelete(record)}>Delete memory</Button>
          {onPromote && target && <Button variant="text" disabled={busy} data-capability="memory.promote" onClick={() => onPromote(record, target)}>Promote to {target} memory</Button>}
          {onCorrect && correcting !== record.id && <Button variant="text" disabled={busy} onClick={() => setCorrecting(record.id)}>Correct memory</Button>}
        </Inline>
        {onCorrect && correcting === record.id && <MemoryCorrection key={record.hash} record={record} busy={busy} onSave={(content) => { setCorrecting(null); onCorrect(record, content); }} onCancel={() => setCorrecting(null)} />}
      </Stack>} />;
  })}</ListGroup>;
}
