# ADR 0016: storage schema compatibility, integrity checks and backup/restore

Date: 2026-10-21. Status: accepted; implements the MVP gate's backup and
migration-recovery drill, the consistent SQLite backup procedure required by
`docs/03-architecture.md`, and the forward-migration and explicit-downgrade
requirements of `docs/12-decisions-risks.md`.

## Context

The runtime's SQLite database runs in WAL mode with `synchronous=FULL`.
Committed state can live in `luuna.sqlite3-wal` until a checkpoint, so a copy of
the main file taken while the runtime runs can lose every record, and an older
main file placed beside a newer `-wal` (a plausible manual restore after a
crash) is replayed into a malformed database. The audit found no backup
command or procedure, no integrity check (a malformed database started,
served partial data and accepted new approvals), and no schema gate: every
migration re-ran on each open, `schema_migrations` was never read, an older
build silently wrote into a newer database or failed late with a serde message
naming no table, and a non-idempotent migration could not be written at all.
Startup recovery decoded every run in full, so one damaged row stopped the
service. A lease left `active` by a run that settled while its release failed
survived every restart and refused every later writer on that repository. The
implementation gate chose the latest baseline by wall-clock `started_at`.

## Decision

1. **Versioned, append-only migrations.** `schema_migrations` is the record of
   applied versions and `DATABASE_SCHEMA_VERSION` is the highest this build
   knows (7). Opening applies only the versions the file lacks, in order. Each
   script commits its own version row and stays idempotent, because two
   processes may race to initialize a new file. A shipped script is never
   edited; a test pins their digests. A change that writes values an older
   build cannot decode (a new state, a new required field) must also add a
   migration, even one that only records its version, so that older builds
   refuse the file instead of failing on a row. The component tables of
   ADR 0014 are still created idempotently at every open, outside this list;
   moving them into a migration is a follow-up.
2. **Gate before any write.** Before opening for writing, a read-only
   connection runs `PRAGMA quick_check` and reads the schema version. A
   malformed file is refused with its first findings and the restore command.
   A file whose version is newer than this build's is refused with both
   versions. Neither is written, not even by a closing writer's checkpoint.
3. **Automatic pre-migration snapshot.** Before migrating an existing database
   (version 1 or later), the runtime writes
   `<data>/backups/pre-migration-v<old>-<timestamp>.sqlite3` with
   `VACUUM INTO`. A failed snapshot stops the upgrade. Snapshots are never
   deleted automatically. To step back to an older build, restore its
   pre-migration snapshot with `luuna-runtime restore` and start that build;
   downgrading a migrated database in place is not supported.
4. **Online backup.** `luuna-runtime backup --output <file>` takes a `VACUUM
   INTO` snapshot through a read-only connection. WAL readers do not block the
   running service, so the snapshot is consistent and includes commits still in
   the log. The result is one self-contained file: private (0600), synced, and
   checked with `quick_check` before it is moved into place. It never
   overwrites a file. The command prints the schema version, size and SHA-256.
5. **Offline restore.** `luuna-runtime restore --input <file>` takes the data
   directory's owner lock, so it is refused while a runtime owns the directory.
   It refuses an input that has a non-empty `-wal` or `-journal` beside it.
   Otherwise it copies the input, verifies the copy's integrity and schema
   version (1 to the supported version), and converts it to a single
   rollback-journal file. It then moves the current database and any `-wal`,
   `-shm` or `-journal` beside it to `<data>/backups/replaced-<timestamp>/`,
   and installs the copy; if any of these steps fails, the moved files return
   to their places and the copy is removed. A stale log therefore
   never meets the restored file. The next start migrates an older snapshot,
   with its own pre-migration snapshot. It also performs ordinary restart
   recovery, so work active when the snapshot was taken becomes `interrupted`,
   never successful.
6. **Check.** `luuna-runtime check` reports integrity and schema version
   read-only, safe while the runtime runs, and exits non-zero on a problem. All
   three commands take `--data-dir`; the default is the service's data
   directory. Without arguments the binary starts the service as before.
7. **What a snapshot covers.** The database snapshot covers projects,
   manifests, plans, approvals, runs, events, leases, attempts, check and
   review evidence records, and component bindings. Check artifacts,
   worktrees, attempt directories and the managed component stores are files
   in the data directory. A complete backup is a copy of the whole data
   directory while the runtime is stopped (an orderly stop checkpoints the
   log). Copying a running data directory is not a supported backup. A
   restored database can reference artifacts or worktrees that are absent or
   newer than its records; restore the matching directory copy for full
   fidelity.
8. **Recovery that one row cannot stop.** Startup recovery selects active
   runs by their state column, and a transition no longer decodes run
   metadata. A record recovery cannot decode is skipped and logged to stderr by
   table and ID. Logs and events describe the decode error by category and
   position, never by content. Where the table has an authoritative state
   column, that column is settled and a durable event records the reason:
   - a lease is abandoned, which frees the repository;
   - an attempt is interrupted, and if its usage cannot be read it reserves
     the full approved budgets;
   - a baseline or candidate is interrupted. The gates decode these records
     and fail closed anyway.

   A run whose state cannot be decoded is left unchanged and reported on every
   start. No gate can use it, because each one decodes it. SQLite errors still
   stop startup.
9. **Every orphan is released.** This amends ADR 0008. No writer runs before
   the runtime admits work, so at startup every lease still `active` is
   abandoned and every `running` attempt is interrupted, whatever its run's
   state. That includes a run that settled while its release failed. The
   recorded reason says that a commit the writer made before the restart may
   exist unrecorded in the preserved worktree and is never a candidate.
   Reading the worktree HEAD at startup, as the live interruption path does,
   remains a follow-up.
10. **Insertion order, not wall clock.** The latest baseline (the
    implementation and repair gate), the baseline listing, the latest discovery
    and a plan's workflow run are chosen by rowid. Rowid is insertion order:
    these rows are never deleted, and `VACUUM INTO` copies rows in rowid order.
    A clock stepped backwards can no longer let an older passed baseline mask
    a newer failed one.
11. **Migration 7** adds lookup indexes for check results by baseline,
    baselines by project and repository, runs by plan revision, leases by run
    and discoveries by project. Baseline listing previously scanned every
    check result per baseline while holding the store lock.

## Validation

- `crates/luuna-storage/tests/migrations.rs` builds a database at every
  earlier version (shipped scripts 1..k plus representative rows from a
  populated current database) and opens it with the current store. It asserts:
  - every row is unchanged;
  - the schema equals a fresh database's;
  - one pre-migration snapshot exists at the old version;
  - old rows decode through the API exactly as in the source;
  - later tables accept writes;
  - reopening applies nothing.

  It also covers:
  - newer-schema refusal without a write;
  - refusal of a stale-log restore and of a non-database;
  - an online backup during writes that restores exactly beside a stale log,
    with the replaced files kept and still openable;
  - restore refusals for damaged, newer, log-accompanied, non-Luuna and
    missing input;
  - the pinned migration digests;
  - index use.
- `crates/luuna-storage/tests/persistence.rs` covers recovery past damaged
  runs, leases, attempts, baselines and candidates; a lease left active by a
  settled run; and latest-baseline ordering under a backwards clock step.
- `crates/luuna-runtime/tests/process_restart.rs` spawns the built binary.
  While a baseline check runs, it takes an online backup and shows that
  restore is refused. It then SIGKILLs the runtime and checks the database.
  After a restart, the run and its baseline are recovered as `interrupted` and
  a new baseline reaches a verdict. After an orderly stop, it restores the
  mid-check snapshot and confirms the restored state.

The process test and the file-permission assertions run on Unix only. Windows
and macOS restore semantics (renaming files another process may hold) have not
been exercised by these tests.
