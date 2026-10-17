# Luuna desktop foundation

The React frontend connects to the independent Rust runtime. It lists persisted runs, starts a tool-free Pi conversation, displays text and raw events, reconnects through durable cursor replay, and requests cancellation. The Projects panel registers an existing repository root by absolute path, shows the runtime's read-only observation (redacted remote, HEAD, branch, dirty counts), requests a discovery proposal, lets you edit the proposed manifest JSON and confirms it with the current revision guard; the project event record replays from the runtime. This is an M0/M1/M2a development shell. It does not run checks, approve code changes, validate builds, or publish pull requests.

From the repository root:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:1420`. Start the runtime separately using the [root development instructions](../../README.md), then enter its URL (default `http://127.0.0.1:4242`) and `LUUNA_API_TOKEN` in the connection form. Provider/model fields may use the runtime defaults. Model credentials belong in the runtime environment; they are never entered in this UI. Only HTTP loopback runtime addresses are accepted. The service token stays in memory and is discarded on disconnect or reload.

The live view polls the authenticated replay API using its last event sequence every 700 ms. Reconnecting repeats events safely without losing ordering or duplicating records. The persisted run state determines completion; text from Pi does not establish that a run or validation succeeded.

For the native Tauri 2 window:

```sh
npm run desktop
```

This requires the pinned Rust toolchain and [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/). Linux additionally needs GTK 3, WebKitGTK 4.1 and their development packages; a headless cloud machine can use the browser frontend. The shell has no filesystem, process or shell plugin permissions. Runtime lifecycle is manual at this milestone and closing the desktop does not stop the service.

Validation:

```sh
npm run typecheck
npm run build
npm test
cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The native application is a separate Cargo workspace with its own checked-in lockfile, so headless Rust runtime checks do not require GUI libraries. Native installers and automatic runtime startup remain later work.
