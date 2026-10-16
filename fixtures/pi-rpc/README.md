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
never a genuine model run or evidence of provider compatibility.

The real compatibility probe is `cargo run -p luuna-engine-pi --example probe`.
Set `LUUNA_PI_COMMAND` to the installed `pi` executable, or to Node and provide
`LUUNA_PI_ARGS_JSON='["/absolute/path/to/pi/dist/cli.js"]'`. The probe enforces
the version and performs real `get_state`, `get_available_models`, and `abort`
RPC commands without requiring provider credentials. A separately configured
runtime run is required to validate genuine model streaming and cancellation.
