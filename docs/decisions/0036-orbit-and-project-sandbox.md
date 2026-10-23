# ADR 0036: Orbit cross-repository commands and the project sandbox (`lu sbx`)

Date: 2026-10-22. Status: accepted (owner request, October 22, 2026).

## Context

The owner works across several related repositories (`luuna`, `luuna-atlas`,
`luuna-beacon`, …) that sit beside unrelated checkouts under one folder. Two needs
followed from a review of how another agent workbench sandboxes its agents
(Linux bubblewrap, macOS Seatbelt, hardened containers):

1. One command that acts on every repository of a project at once (status,
   running a command, running a manifest recipe, fetching or cloning what is
   missing), in the terminal and in the desktop, without a second hand-kept list
   of repositories.
2. A way to open a shell or an agent (Pi, an ACP client, any CLI) that can reach
   *only* that project's repositories, enforced by the operating system rather
   than by prompts. The current architecture already says native execution has
   host permissions and that stronger isolation needs an explicitly configured
   profile with actual operating-system boundaries.

A Luuna project already is the set of repositories that belong together (ADR
0006, ADR 0017): the manifest is machine-independent and the machine registry
maps each repository to its checkout. That registry is the single source of
truth this ADR builds on.

## Decision

### 1. Orbit: cross-repository developer commands

*Orbit* is the name of a project's repositories seen together. Four routes act on
the registered checkouts of one project:

| Route | What it does |
| --- | --- |
| `GET /api/v1/projects/{id}/orbit` | Read-only status per repository: present or missing, branch, HEAD, upstream and ahead/behind, dirty counts, redacted remote, and the manifest recipe ids it can run. Inspection uses the `luuna-git` environment (no hooks, fsmonitor, filters or optional locks). |
| `POST /api/v1/projects/{id}/orbit/exec` | Runs one executable plus argument array in each selected repository (`repositories`, default all) through the supervised executor: secret-stripped environment, owned process tree, deadline (`timeout_seconds`, 1..=3600, default 300), bounded output with private artifacts. Sequential by default; `parallel: true` runs up to four at once. |
| `POST /api/v1/projects/{id}/orbit/run` | Runs the confirmed manifest recipe named `recipe` in each repository that defines it; the others are reported `skipped`. |
| `POST /api/v1/projects/{id}/orbit/sync` | Per repository: a missing checkout is cloned from its registered remote to its registered path and its identity is re-verified against the registration; a present one is fetched (`git fetch --prune origin`) unless `fetch: false`. Hooks, fsmonitor and terminal prompts are disabled. |

Orbit actions are the **developer's own commands**, equivalent to typing them in
a terminal in each checkout. They are not agent actions, never reach a Pi worker,
and **are never evidence**: their results are not `CheckResult`s, are not bound
to a manifest hash and cannot satisfy a baseline, validation or publication gate.
Each mutation appends one project event (`orbit.executed`, `orbit.recipe_ran`,
`orbit.synced`) naming the command, the repositories and each outcome, never
output. Output is returned to the caller (a 4 KiB tail per stream) and kept in
private artifacts under `<data>/orbit/<execution id>/`.

Orbit never selects repositories outside the project's registration. A repository
whose checkout is missing is reported, not guessed. A clone whose observed identity
does not contain the registered roots is reported as a failure and left in place
for the developer to inspect; it is never registered or rebound automatically.

### 2. The project sandbox (`lu sbx`)

`GET /api/v1/projects/{id}/orbit/sandbox?network=open|none` returns a
**sandbox plan**: the backend for this host, whether it is available and why not,
the working directory the sandboxed process starts in, each repository's host
path and the path it appears at inside, the private sandbox home
(`<data>/sandboxes/<project>/home`, created by the runtime) and the network
policy. The runtime decides what the sandbox may reach: only the project's
registered and present repositories, never the data directory, the credentials
directory or another project's checkouts.

A separate launcher, `luuna-sbx` (crate `luuna-sandbox`), applies the plan and
runs the command with the terminal attached:

| Host | Boundary | What the process can reach |
| --- | --- | --- |
| Linux | `bwrap --unshare-all` (new user, mount, PID, IPC, UTS and, under `network=none`, network namespaces), non-root uid 1000, `--die-with-parent` | System directories read-only, toolchain directories on `PATH` read-only, each repository read-write **at its own host path** (so absolute `gitdir:` pointers keep working), the sandbox home as `$HOME`, a fresh `/tmp`. It starts in the deepest common parent of the repositories; listing that parent shows only the repositories. |
| macOS | `sandbox-exec` with a generated `(deny default)` profile | System reads, toolchain reads, the repositories and the sandbox home read-write, `/private/tmp` and `/private/var/folders`; network only when `open`. Untested on a Mac host. |
| Windows | An **AppContainer** (`luuna.sbx.<project>`), the low-box token Windows uses for store apps, in a kill-on-close job object | Only paths that grant the container's SID: Windows grants system directories to all application packages; the launcher grants the container read-write on each repository, the sandbox home and a synthetic root directory holding one junction per repository, and read-execute on toolchain directories on `PATH` inside the user profile. Everything else in the user profile is unreadable. Network through the `internetClient` capability when `open`. |

On every host `HOME` (and on Windows `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
`TEMP`, `TMP`) points into the sandbox home, so an agent's configuration and
sessions stay out of the repositories and out of the developer's real profile.
`LUUNA_SANDBOX=1` and `LUUNA_SANDBOX_PROJECT` are set. The rest of the
environment is inherited from the developer's shell; the sandbox limits files,
not secrets already in the environment. Agents therefore need their provider key
in the environment or a login inside the sandbox home.

Limits that the documentation states rather than hides:

- Windows grants are persistent inheritable access-control entries for that one
  container SID on the granted directories. The first grant on a large checkout
  propagates to every file and can take minutes; later launches skip directories
  that already carry the entry. `luuna-sbx revoke` removes them.
- No CPU or memory limits are applied by the launcher; Windows job objects and
  Linux cgroups are future work.
- Linux toolchains installed inside the real home (for example `~/.cargo`) are
  mounted read-only only when their directory is on `PATH`.
- macOS has no network namespace; `restricted` domain allow-listing is not
  implemented on any host (`open` or `none` only).
- The sandbox is a developer tool. It does not change how Luuna's own writers run
  (ADR 0008): they still run natively in Luuna-owned worktrees with the scope
  guard, which remains a policy boundary, not an operating-system one. Running
  writers inside this boundary is a later execution profile.

### 3. Clients

`lu` is a shorter name for `luuna` (`bin/lu`, `bin/lu.cmd`). Every route above is
a catalog action with a desktop control and a terminal command: `lu orbit`,
`lu orbit-exec`, `lu orbit-run`, `lu orbit-sync` and `lu sbx`. `lu sbx [project]
[-- command …]` reads the plan and starts `luuna-sbx` with the terminal attached
(`--plan-only` prints the plan instead). The desktop gains an **Orbit** view: the
status table, exec and recipe forms with per-repository results, sync, and the
sandbox plan with the exact command to open it, since a browser view cannot host
an interactive terminal. The native terminal workbench gains an Orbit screen over
the same command.

## Consequences

- New routes: the five above, cataloged in `schemas/capability-catalog.json`.
- New crate `luuna-sandbox` (plan types, the three backends, the `luuna-sbx`
  binary). The runtime depends on it for plan types only.
- `luuna-git` gains read-only upstream tracking (`ahead_behind`) and the two
  network operations Orbit sync needs (`fetch_origin`, `clone_repository`).
- Requirements are unchanged; this is an additional developer capability. It does
  not satisfy or relax any approval, baseline, validation, review or publication
  gate.
