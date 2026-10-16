# Local runtime connectivity foundation

This is an authenticated, loopback-only, **tool-free Pi demo**. Every run starts
a fresh Pi process with a private empty cwd and config directory, no context
files, no extensions, no MCP, no skills, and no tools. It cannot implement a
plan or edit a repository. These flags are a narrow demo profile, not an OS
sandbox for future execution tools.

Install the supported `@earendil-works/pi-coding-agent@1.3.0` distribution.
The launcher verifies `--version` before each run. Configure these environment
variables locally; keep credentials out of repository files:

| Variable | Purpose |
| --- | --- |
| `LUUNA_API_TOKEN` | Required random token, at least 32 bytes; frontend enters it locally |
| `LUUNA_PI_COMMAND` | Pi executable, default `pi`; may be an absolute Node executable |
| `LUUNA_PI_ARGS_JSON` | Optional JSON array of launcher arguments, e.g. absolute `dist/cli.js` path |
| `LUUNA_PI_PROVIDER` / `LUUNA_PI_MODEL` | Optional explicit defaults; UI can supply them per run |
| `LUUNA_PI_OPENAI_API_KEY` | Optional secure cloud binding alias; becomes child `OPENAI_API_KEY` and takes precedence over a direct key |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | Preserved for provider routing, including lowercase variants and `NODE_USE_ENV_PROXY`; existing TLS trust variables remain enabled |
| `LUUNA_DATA_DIR` | Private durable state directory, default `.luuna` |
| `LUUNA_PORT` | Loopback port, default `4242` |
| `LUUNA_RUN_TIMEOUT_SECONDS` | Positive operation deadline, default `600`; version probe has a separate 15s deadline |

Run `cargo run -p luuna-runtime`. Supply the selected provider's API key through
its standard environment variable, such as `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`; the runtime never accepts keys through the API. The current
demo inherits only an explicit list of direct provider key variables. OAuth,
cloud platform authentication, user Pi profiles, and model settings files are
not integrated. Missing provider credentials produce a persisted failed run.

`GET /api/v1/health` is public. Its `pi_version` field reports the required
supported version; the CLI is checked when starting a run. All other endpoints
require `Authorization: Bearer <token>`:

- `GET /api/v1/runs`: persisted run records.
- `POST /api/v1/runs`: `{ "prompt": "Hello", "provider": "...", "model": "..." }`.
- `GET /api/v1/runs/{id}`: current run state.
- `GET /api/v1/runs/{id}/events?after=0`: durable event replay by sequence.
- `GET /api/v1/runs/{id}/stream?after=0`: SSE replay then live delivery; accepts `Last-Event-ID`.
- `POST /api/v1/runs/{id}/cancel`: request abort; terminal cancellation follows process reaping.

Only one runtime can own a data directory. Startup recovery marks abandoned
active attempts interrupted after obtaining that exclusive ownership. A
Ctrl+C shutdown requests cancellation and waits for supervised cleanup.
At most four demo runs may be active. Prompt acknowledgements and low-level
`agent_end` events do not complete a run: Pi 1.3.0's `agent_settled` is required.
Completion means the connectivity request finished, not a feature passed
validation or a publication was approved.

`cargo test -p luuna-runtime -p luuna-engine-pi` uses the labeled synthetic
Python protocol fixture in `fixtures/pi-rpc`. Python 3 is required for these
subprocess tests. The genuine credential-free RPC probe is documented there.
