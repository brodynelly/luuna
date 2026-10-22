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
- Export is a read model; importing it on another machine was not part of the
  original decision and is added by the amendment below.

## Amendment (2026-10-22): import of an export

An audit (finding 7; R14, A29; docs/06-memory.md "a developer can move an
export between computers") found that an export had no receiving side: a
rebind re-points a registration on the same machine, it does not create a
project from a document. The runtime now implements the import, with the
export's own refusal rules and the ordinary adapters.

1. **The export is content-addressed.** `GET …/export` adds
   `repository_identities` (each registered repository's machine-independent
   identity: redacted remote, push remote, root commits, shallow flag) and
   `export_hash`, the `luuna-json-v1` hash of every other field. An import
   recomputes the hash and refuses a document that was edited or truncated;
   an export without the hash or the identities predates this amendment and
   is refused with a request to export again.
2. **`POST /api/v1/projects/import`** takes `{export, repositories: [{id,
   path}], idempotency_key}`. Before any write it validates the document
   (kind, schema version, hash, manifest, identities, bounded tickets/memory/
   prompts), walks it with the export guard (this host's credential values,
   data directory, home directory, the given checkout paths and any absolute
   path of the known shapes; a memory with `scope: user`) and refuses what the
   export would have refused, then inspects each given checkout read-only
   exactly as registration does and refuses one whose origin remote is not
   equivalent to the exported remote or whose root commits do not contain
   the exported roots. A path that is not a repository root, a checkout
   inside the data directory and a checkout another project registered are
   refused with registration's errors. A project ID that is already
   registered is refused: v1 never merges into an existing project.
3. **The steps are registration's, under one lock and one ledger entry.**
   The project is registered with the exported ID and name from the given
   checkouts (`project.registered`, `repository.registered`); the import
   intent is recorded in the component-operation ledger under the key with
   the export hash and checkout paths; the exported manifest is confirmed as
   revision 1 through the validation `PUT …/manifest` applies (identity,
   remote equivalence, default branch, confirmed relationships, required
   checks); every exported ticket is created as a revision-1 temporary ticket
   with its exported ID and timestamps under the derived key
   `<key>:ticket:<id>`; when the pinned toolchain is available the components
   are activated as `POST …/components` does, which migrates those tickets
   into Missions under the delivery reservation, and each memory and prompt
   is created through the Atlas and Beacon adapters under `<key>:memory:<id>`
   and `<key>:prompt:<name>`. Nothing writes a component store directly.
   Finally `project.imported` is recorded with the export hash, the counts
   and the mapping, and the response is stored as the ledger's answer.
4. **What is preserved and what is mapped.** Ticket IDs, titles, intent,
   acceptance criteria, repository IDs and creation timestamps are preserved;
   a ticket's revision restarts at 1 and the manifest's revision is 1 on the
   new machine (both recorded in `mapping`, so a manifest exported at a
   later revision hashes differently from the export). Memory records get
   new IDs with their exported scope, content and provenance; prompts get
   version 1 with the exported `guidance` section (a rendered body with
   several sections is kept whole as one guidance section and flagged
   `sections_flattened`). The mapping lists exported and imported IDs,
   versions and hashes.
5. **Idempotency.** The same key with the same export and checkouts returns
   the recorded result (`replayed: true`); a different export or different
   checkouts under a used key is refused (409). An import that stopped
   between steps resumes under its key: each step replays or reconciles by
   its derived key, so a retry never duplicates a ticket, memory or prompt.
   Without the component toolchain, an export that carries memory or prompts
   is refused (503) before any write; one that carries only tickets imports
   them as temporary tickets, to be migrated at activation.
6. **Clients.** The catalog gains `projects.import`; the TUI `import
   <export-file> <repository-id> <path>` and the desktop's "Import a project
   export" form (pasted JSON plus one checkout path per exported repository)
   call `importProject`.

Validation: synthetic API tests export a fixture project with a ticket and
import it into a second runtime from a fresh clone with the same remote and
root commits (equal manifest hash, preserved ticket, `project.imported`,
replay, refusal of a second key), and refuse a clone with another remote, a
tampered or missing hash, a host path, user memory, a missing checkout and a
checkout for an unexported repository. The real-CLI regression
`components_real_import_round_trips_tickets_memory_and_prompts_from_an_export`
registers, confirms, activates and writes a ticket, project and process
memory, a user memory and a prompt through the adapters, exports, imports into
a second runtime with the pinned CLIs and checks Missions, Atlas and Beacon
hold the exported records (and no user memory), then replays the key.
