import { useState } from "react";
import type { Ticket, UpdateTicketRequest } from "@luuna/api-client";
import { Button, Disclosure, Form, FormFooter, TextArea, TextField, submitted } from "../ui";
import { TEXT_LIMITS, ticketEditRequest, ticketTextSizes, tooLong } from "./model";
import type { TicketDraft } from "./model";
import { ByteCount } from "./PlanReview";
import { RepositoryScope } from "./RepositoryScope";

/**
 * Edits a ticket at the revision shown. The runtime advances the revision, so every plan made
 * for the earlier revision is stale and must be re-planned; the form says so before saving.
 */
export function TicketEditor({ ticket, repositoryIds, busy, latestRevision, onSave }: { ticket: Ticket; repositoryIds: string[]; busy: boolean; latestRevision?: number; onSave: (request: UpdateTicketRequest) => void }) {
  const [draft, setDraft] = useState<TicketDraft>({ title: ticket.title, intent: ticket.intent, criteria: ticket.acceptance_criteria.join("\n"), repositoryIds: ticket.repository_ids });
  const request = ticketEditRequest(ticket, draft);
  const sizes = ticketTextSizes(draft.title, draft.intent, draft.criteria.split("\n"));
  const blocked = tooLong(sizes);
  const choices = [...new Set([...repositoryIds, ...ticket.repository_ids])];
  const hint = latestRevision
    ? `Saving advances the ticket to r${ticket.revision + 1}: plan r${latestRevision} was made for r${ticket.revision} and must be re-planned before any further implementation, validation or publication.`
    : `Saving advances the ticket to r${ticket.revision}; its plans bind to the revision they were made for.`;
  return <Disclosure className="ticket-editor" summary={`Edit ticket r${ticket.revision}`}>
    <Form className="form-group" disabled={busy} onSubmit={submitted(() => { if (request && !blocked) onSave(request); })}>
      <TextField label="Revised title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required aria-describedby={`edit-title-bytes-${ticket.id}`} />
      <ByteCount id={`edit-title-bytes-${ticket.id}`} bytes={sizes.title} limit={TEXT_LIMITS.title} />
      <TextArea label="Revised intent" value={draft.intent} onChange={(event) => setDraft({ ...draft, intent: event.target.value })} required rows={3} aria-describedby={`edit-intent-bytes-${ticket.id}`} />
      <ByteCount id={`edit-intent-bytes-${ticket.id}`} bytes={sizes.intent} limit={TEXT_LIMITS.intent} />
      <TextArea label="Revised acceptance criteria (one per line)" value={draft.criteria} onChange={(event) => setDraft({ ...draft, criteria: event.target.value })} required rows={2} aria-describedby={`edit-criteria-bytes-${ticket.id}`} />
      <ByteCount id={`edit-criteria-bytes-${ticket.id}`} prefix="Longest criterion: " bytes={sizes.criterion} limit={TEXT_LIMITS.criterion} />
      {choices.length > 1 && <RepositoryScope choices={choices} selected={draft.repositoryIds} onChange={(repositoryIds) => setDraft({ ...draft, repositoryIds })} />}
      <FormFooter hint={hint}>
        <Button variant="primary" submit disabled={!request || blocked} data-capability="tickets.update">Save ticket r{ticket.revision + 1}</Button>
      </FormFooter>
    </Form>
  </Disclosure>;
}
