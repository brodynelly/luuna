# Pi protocol corpus

The supported adapter baseline is `@earendil-works/pi-coding-agent@1.3.0`.
Read that installed package's `docs/rpc.md`, `docs/rpc-commands.md`, and
`docs/json.md` when changing the adapter. `agent_end` ends one low-level run;
`agent_settled` finishes all automatic retries and follow-up work. A prompt
response only acknowledges acceptance.

`mock_pi.py` is an explicitly synthetic subprocess fixture. It exercises LF
framing, Unicode separators, acceptance versus completion, unknown events,
rejected commands, provider errors, recovery, crashes, malformed records,
response correlation, and cancellation without network or credentials. It is
never a genuine model run or evidence of provider compatibility. Writer
scenarios are named by `fixture:<name>` markers that tests place in the
acceptance criteria; the reviewer branch answers `fixture:review_*` markers
with a structured verdict. The `repair_in_scope` writer only repairs when its
prompt quotes the failing check output, so the runtime's repair feedback
contract is exercised rather than assumed. `review_malformed_once` answers a
candidate's first validation generation with malformed text and every later
generation with a valid pass, so a fresh validation generation after an
invalid review can be exercised against one immutable ticket.
`review_no_findings` returns `changes_required` without a finding (invalid
review output), `review_tools` emits read, search and refused tool calls whose
patterns and results must never be recorded, and `review_report` passes with
evidence strings that describe the diff and scope it was given. `review_retry` emits a transient provider error that Pi retries itself (the errored `message_end`, `agent_end` with `willRetry`, then the passing review) and `review_stream` streams forty cumulative-usage updates before its verdict. The `write_compaction` writer reports a threshold compaction whose summary usage only `compaction_end` carries, and `write_unpriced` reports tokens with a zero cost, as Pi does for a model without pricing.

As Pi 1.3.0 does, the fixture reads `--system-prompt` from the named file when
it exists; writer `fixture_args` report the prompt's size and whether it came
from a file. The `large_session` writer and the `large_agent_end`,
`large_agent_end_error`, `malformed_large_agent_end` and `oversized_unknown`
demo prompts emit records over 1 MiB, as Pi's `turn_end` and `agent_end` do
after many file reads. Launcher flags select startup behaviour:
`--stall-stdin` stops reading commands, `--fail-startup` prints a diagnostic
(with synthetic credentials to be redacted) to stderr and exits 1, and
`--require-isolated-version` answers `--version` only when the probe runs with
a private `PI_CODING_AGENT_DIR`.

The real compatibility probe is `cargo run -p luuna-engine-pi --example probe`.
Set `LUUNA_PI_COMMAND` to the installed `pi` executable, or to Node and provide
`LUUNA_PI_ARGS_JSON='["/absolute/path/to/pi/dist/cli.js"]'`. The probe enforces
the version and performs real `get_state`, `get_available_models`, and `abort`
RPC commands without requiring provider credentials. A separately configured
runtime run is required to validate genuine model streaming and cancellation.
