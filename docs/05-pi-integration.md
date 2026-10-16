# Pi integration reference

## Integration decision

Use a pinned Pi release behind a Luuna engine adapter. Rust hosts should use Pi RPC; a future TypeScript host can use the SDK. Avoid terminal-screen parsing and avoid a fork of Pi for Luuna's scheduling rules. The current upstream project is earendil-works/pi; the former badlogic/pi-mono URL redirects there. Verify the selected release and installed help at bootstrap. See S01-S04.

Pi's subprocess RPC uses JSONL commands and events. A command response is distinct from completion of model work. Build the adapter against the pinned release's protocol, including error, cancellation, and lifecycle behavior. Keep diagnostics separate from protocol records. These details require a real compatibility smoke test.

## Luuna engine interface

Define create_session, submit_assignment, send_followup, request_stop, inspect_session, subscribe_events, and dispose_session. Expose capability flags for tool restrictions, session persistence, UI requests, and structured outputs. Return engine-specific errors as classified Luuna errors without discarding diagnostic detail.

Luuna chooses role, model profile, cwd, resources, tools, credentials reference, and transcript location before session creation. A fresh review gets a new conversation and a deliberately limited context manifest. Never fork the implementer's chat to create the independent reviewer.

Do not assume native coding-agent behavior from model identity. Selecting an OpenAI or Anthropic model through Pi does not launch another vendor's standalone coding CLI.

## Project resources

The project .pi directory can contain settings, extensions, skills, and prompt resources. Preserve the developer's existing configuration. Luuna's versioned package supplies its integration and selected process roles without rewriting unrelated resources. See S04.

Treat discovered project extensions as executable resources requiring trust. Luuna records the approved resource set and its hashes before a run. Repo files cannot grant themselves wider execution permissions or alter the approved plan.

Rendered Canopy content is a generated resource. Preserve prompt-source IDs, versions, and render hashes in the context manifest. Explicitly define how Luuna combines project instructions, process prompts, memory, and assignment text; do not rely on accidental file-discovery order.

## Tool and permission profiles

Scouts inspect files and permitted metadata. Implementers receive approved write and execution tools for their task environment. Reviewers inspect candidate code and evidence; any verification commands use a controlled disposable environment and do not silently edit the candidate.

Luuna's runtime and executor enforce permissions. Instructions such as 'do not write outside this directory' are useful guidance, but are not an operating-system security boundary. A generic shell can bypass a path-only tool policy in native mode.

## Models and credentials

Allow separate configured model profiles for exploration, planning, implementation, and review. Start with developer-selected models rather than hard-coded product names or assumed prices. Validate provider availability during setup. Pi documents provider-specific API-key and OAuth options; support only flows tested for the selected release and intended distribution. See S05.

Credentials remain on the execution host behind references. The browser receives provider identity and capability status, not raw credentials. Restrict what agent child processes inherit and keep publication credentials outside ordinary coding sessions.

## Session records and completion

Use per-worker transcript storage with retention controls. Normalize events into Luuna's domain stream while retaining raw diagnostic artifacts where appropriate. A successful process exit or agent completion event does not mean the feature's acceptance criteria passed.

Validate structured findings, plans, and review reports against Luuna contracts. Malformed output is a recoverable schema failure with a bounded retry; it must not advance approval or publication.

Before declaring idle or safe completion, follow the pinned Pi lifecycle contract. At the application level, still inspect task results, tool execution, candidate state, and required gates.

## Compatibility gate

Test a real session on each supported OS: stream output, run a permitted read, perform an approved fixture edit, cancel a child command, recover from a provider error, respond to a supported UI request, and reopen a persisted session. Test unknown events and malformed records. Keep one fixture corpus per supported Pi release.

Do not claim that arbitrary third-party Pi terminal extensions render in the browser. Luuna-owned capabilities must have web/TUI equivalents. Unsupported custom terminal widgets are reported as unsupported unless an explicit adapter exists.
