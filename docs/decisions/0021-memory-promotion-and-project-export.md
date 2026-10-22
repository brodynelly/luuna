# ADR 0021: scoped memory promotion and scope-safe project export

Date: 2026-10-21. Status: accepted; extends ADR 0014's bounded M6 slice toward
R14 (scoped user, project and process memory) and acceptance scenarios A28 and
A29 (private memory from another project is excluded; a project export carries
no credentials, personal memory or required absolute paths).

## Context

ADR 0014 gave Atlas memory three explicit scopes (`process`, `project`, `user`),
provenance, lexical retrieval (`GET …/memory?q=`), explicit user opt-in on
listing and selection, and reconciled deletion. Two M6 obligations stayed open:
a developer could not widen a memory's scope without retyping it under a new
provenance, and nothing produced a project artifact another machine or person
could receive while proving that user memory, credentials and this host's paths
stayed home. The desktop's component status deliberately shows the private
workspace path; an export must not.

## Decision

1. **Promotion widens scope one step, never narrows it.** `POST
   /api/v1/projects/{id}/memory/{memory_id}/promote` with `{idempotency_key,
   expected_hash, to_scope}` accepts only `process -> project` and `project ->
   user`. It refuses a stale displayed hash (409), a skipped or backward step
   (422) and a deleted memory (404). It creates the record in the wider Atlas
   store with provenance `promoted from <scope> memory <id>: <original
   provenance>` (clipped to the 1000-byte bound), then deletes the narrower
   record through the existing reconciled delete. Both steps run under the
   durable component-operation ledger of ADR 0014: the promotion intent is
   recorded first, the create uses the derived key `<key>:promote-create`, and
   a retry after a crash between the two steps finishes the promotion from the
   recorded create instead of duplicating it; a tombstoned source with no
   recorded create fails closed with the next step named. Replaying the key
   returns the recorded response. Narrowing is an ordinary delete plus a new
   record, because a narrower copy of a wider memory would create two
   independently writable records of one fact.
2. **Export fails closed.** `GET /api/v1/projects/{id}/export` returns the
   confirmed machine-independent manifest, the project's ticket projections,
   its `project` and `process` memory and the current rendered prompts, with
   an `omitted` list naming user memory, credentials, machine-registry paths,
   worktrees and private artifacts. Before answering, the runtime walks every
   string of the export and refuses (409, "Export refused: it would include …")
   any that contains a known credential value (the API token, provider keys and
   credential-shaped environment values the repair redaction already knows),
   the data directory, a registered checkout path, the home directory, an
   absolute path of this host's shapes, or a memory record whose `scope` is
   `user`. Refusal is preferred to redaction: a redacted export would still
   prove that private text reached the export path.
3. **Clients.** Both clients expose promotion beside deletion with the same
   displayed-hash acknowledgment and show the export as a download of the
   returned JSON; neither client composes an export itself.

## Consequences

- R14's promotion/deletion obligation is implemented and reconciled; retrieval
  stays lexical (substring over content and provenance), as ADR 0014 bounded it.
- A29 has a runtime guard and a real-CLI regression
  (`components_real_promotion_widens_scope_and_export_keeps_private_memory_home`)
  that promotes a process memory to project and then to user, checks the lists,
  exports with a user memory present, and shows an export refused when a ticket
  quotes a host path. The pure guard has its own unit test.
- Export is a read model; importing an export on another machine (registering
  the repositories there and reconciling tickets against a Missions store) is
  not implemented and is recorded as remaining M6 work with browser/TUI parity
  of every cataloged action (ADR 0020).
