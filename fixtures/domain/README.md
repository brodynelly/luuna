These are deterministic M0 contract fixtures, not executable work authorizations.
`manifest.json` pairs each schema with a valid and invalid document for
`node scripts/check-contracts.mjs`. Invalid fixtures cover absent required checks,
zero approval revisions, unknown assignment fields, mutable commit references,
contradictory review verdicts, and publication without a PR URL.

Rust tests additionally enforce cross-record rules JSON Schema cannot establish:
task DAGs and repository scope, exact plan hashes, stale approval rejection,
immutable stored revisions, workflow-to-plan binding, independent review, and
candidate changes invalidating evidence. SQLite integration tests exercise atomic
state/event rollback, concurrent sequences and interruption after reopening.

`luuna-json-v1` hashes UTF-8 JSON with object keys recursively sorted, no
insignificant whitespace, JSON integer/string encodings, and array order
preserved. Only the top-level `hash` property is omitted. Paths are explicit
relative strings, Unicode is preserved, and no lossy normalization occurs.
The complete plan includes project/ticket revision, base commits, optional repair
candidate identity, repository/path/operation permissions, tasks, recipes,
execution profiles and budgets. Changes require a fresh hash and approval.

The M1 research-run lifecycle is separate from feature execution. Even a durable,
current approval cannot enter `implementing` until M2 adds observed baseline
evidence. This fixture suite does not claim that a real baseline executor,
publication gate, or multi-repository scheduler has been implemented.
