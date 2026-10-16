# System architecture

## Proposed technology baseline

| Component | Baseline | Reason |
| --- | --- | --- |
| Core service | Rust, Tokio, Axum | One policy boundary, supervised processes, typed domain rules |
| Terminal interface | Rust, Ratatui | Reuse domain types and service client |
| Browser interface | React, TypeScript, Vite | Rich project graph, diff, ticket, and run views |
| Agent engine | Pinned Pi RPC processes | Preserve Pi compatibility behind an engine adapter |
| Durable runtime state | SQLite on local disk | Transactional scheduling, approvals, attempts, and events |
| Project knowledge and work records | Adapters for Mulch, Canopy, Seeds | Keep existing tools usable and auditable |
| Search | Rebuildable file index and lexical retrieval first | Avoid mandatory GPU/model services |
| Execution | Native host with optional container profile | Portable installation and explicit capability selection |

These are application design decisions. Consult the primary references before selecting package versions. The Rust core is not evidence that all dependencies become one native binary; installation must also resolve Pi and any upstream CLI runtime dependencies.

## Component responsibilities

The service owns authentication, authorization, the project registry, repository graph, durable scheduler, state transitions, approvals, process supervision, worktree operations, artifacts, and publication. It exposes a versioned local API and event stream.

The engine adapter owns translation between Luuna's session interface and Pi. UI code never needs to interpret raw agent output to decide whether a gate passed.

The Git adapter creates and inspects task branches and worktrees. The executor starts approved commands with argument arrays, an explicit working directory, a bounded environment, timeout, and cancellation behavior. The validation adapter records outcomes. The publisher pushes branches and creates or updates PRs.

The stack adapter discovers project tooling and produces declarative setup and check recipes. It does not bypass runtime approval or publication policies.

## Repository structure for Luuna itself

Start with one Luuna monorepo containing Rust crates for domain, service, engine-pi, executor, git, tool-adapters, and tui; a browser application; shared JSON schemas; fixtures; and this documentation. This is the product's source organization. Projects managed by Luuna can contain any number of independent repositories.

Keep domain transition rules independent of the web framework and UI. Generate or validate TypeScript API types against the same schemas used by the Rust boundary. Do not create separate implementations of approval logic in the clients.

## Managed project layout

A project has a control directory with a versioned manifest, project-level Seeds work records, and Canopy prompt sources. It can optionally be its own metadata Git repository. Linked source repositories remain independent; their contents must not accidentally be added to the control repository.

Project-wide Mulch records live in the control directory. Repository-specific records may live in the repository's own Mulch directory. Luuna's adapter resolves the scopes explicitly; cross-repository inheritance is not assumed to be an upstream feature.

Machine-specific paths, credentials, Pi transcripts, runtime databases, logs, and worktrees live in private application data outside versioned project configuration. Store stable repository IDs in the manifest and map them to local paths in the machine registry. Exported project files must not depend on one developer's absolute paths.

## Authority and persistence

| Information | Authoritative location | Derived or referenced data |
| --- | --- | --- |
| Repository identities, relationships, check recipes | Versioned project manifest | Local path mappings in machine registry |
| Ticket intent, dependencies, ownership | Seeds project records through Luuna adapter | Runtime cache with source revision |
| Approved executable plan and scope | Immutable Luuna plan revision plus approval record | Optional Seeds plan link |
| Attempts, scheduling, checks, reviews, events | Local Luuna database | UI projections |
| Process prompts | Canopy versioned sources | Rendered Pi resources with version/hash |
| Learned expertise | Scoped Mulch records | Search index |
| Personal memory | Private application data | Explicitly selected context snippets |
| Code | Each Git repository | Code maps and embeddings |
| Secrets | Credential facility on the execution host | Credential references only |

Avoid two independent writable copies of the same status. Seeds tracks work lifecycle; Luuna tracks execution attempts. Updates pass through a serialized adapter with revision checks and reconciliation. External Seeds edits are detected; conflicting changes block scheduling until reconciled.

SQLite stays on the runtime host's local filesystem, not a shared multi-host network database. Use migrations, bounded transactions, and a single logical scheduling authority. WAL backup must use a consistent SQLite backup procedure rather than copying only the main database while writes are active. See S10.

## Session and worktree ownership

Each worker has a role, assigned repository, task, tool profile, model, context manifest, and working directory. Leads are short-lived reasoning sessions invoked at planning or integration boundaries. Deterministic scheduling and progress aggregation do not consume model calls.

A writer receives its task worktree, not the developer's primary checkout. A second writer never owns that worktree simultaneously. User edits to the worktree pause the writer and invalidate affected evidence. Worktrees retain shared Git metadata, so runtime policy must also control repository-wide operations. A worktree is not a sandbox.

## Trust and execution

Native mode runs with host permissions. The UI must describe that mode honestly and record its selection. A path allowlist reduces accidental writes through Luuna tools but cannot constrain arbitrary shell execution by itself.

Container mode uses a reviewed profile with explicit workspace mounts, resource limits, and credential references. Do not mount the host root, personal configuration tree, or Docker control socket into an agent container. Container isolation depends on the selected configuration; it is not a blanket guarantee.

Local API protection includes loopback binding, an installation/session token, origin validation, no permissive CORS, and no credential-bearing frontend bundles. Remote access requires an authenticated transport and host identity. Disable remote binding by default.

## Platform capabilities

Probe installed Git, Pi, shell, toolchains, test runners, available devices, and container engine. Use argument arrays and platform-specific process management rather than constructing POSIX shell strings on Windows. Process cancellation must terminate the run's child tree, including tools launched by Pi. On Windows, validate the job-object strategy; on Unix, validate process-group behavior.

Browser closure leaves the service alive. Service or machine restart produces interrupted attempts that require reconciliation. Persisted transcripts do not by themselves prove a process can safely resume. Recovery checks worktree state, host identity, locks, and last durable side effects before restarting a task.

## Optional deployment extensions

A remote worker is a capability-addressed executor associated with a trusted host. It can later support a NAS, a Mac build worker, or a hosted workspace. Keep remote execution behind the executor interface; local v1 must not need a distributed scheduler.

GPU acceleration is an optional inference or embedding worker capability. It is not a condition for rendering the interface or using cloud models through Pi.
