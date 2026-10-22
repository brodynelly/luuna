# ADR 0019: verified stack profiles, host capability probing and approved scaffolding

Date: 2026-10-21. Status: accepted; implements the M5 work packages P50–P55
(`docs/10-roadmap.md`) for R04 and R13 and the A05, A06, A18 and A31 scenarios.

## Context

M2a discovery proposed recipes for Rust, Node, Go, Python, Flutter, Gradle,
Android and iOS repositories but said nothing about whether the host could run
them: a `flutter test` recipe on a Windows laptop without Flutter looked the same
as one on a capable runner, and iOS raised a question instead of a recipe. R04
also requires creating new projects, and A05 requires that an approved scaffold
establishes tests before any feature work. The roadmap exit for M5 forbids
calling an unavailable platform passing, and ADR 0007 already records a missing
tool as `blocked`, never `failed`.

## Decision

1. **Discovery annotates checks with observed host capability.** Before a
   discovery proposal is computed, the runtime probes the host once (cached for
   two minutes) in `luuna-discovery::capabilities`: each tool a profile may need
   (`git`, `node`, `npm`, `pnpm`, `yarn`, `bun`, `cargo`, `rustc`,
   `cargo-clippy`, `go`, `python3`, `python`, `pytest`, `ruff`, `mypy`,
   `flutter`, `dart`, `java`, `gradle`, `adb`; `xcodebuild` and `swift` on macOS
   only) is resolved on `PATH` with the executor's `PATHEXT` rules and run only
   with its own version argument (`--version`, `go version`, `java -version`,
   `adb version`, `xcodebuild -version`) under a 15-second deadline, a 64 KiB
   output bound and the sanitised environment of ADR 0007 (Luuna configuration,
   `GIT_*` and credential-shaped variables removed). A Microsoft Store
   app-execution alias whose probe fails is `missing`, not an available
   interpreter. `ANDROID_HOME`/`ANDROID_SDK_ROOT` is recorded as the pseudo-tool
   `android-sdk`. Nothing read from a repository is executed, and the probe
   result (`Discovery.host_capabilities`) is machine evidence, never part of a
   manifest or its hash.
2. **Every proposed check carries `capability: available | missing` and
   `missing_tools`.** The annotation uses the executor's capability table, so
   it predicts what execution will find: a required check whose tool is
   missing stays proposed (it is never dropped silently), discovery raises one
   `missing-tool` question per tool naming the profile, the checks, the probe's
   reason and the install step, and the executor records the check `blocked`
   (incapable host) if it is confirmed and run. The domain fields are additive
   and default, so discoveries recorded before this decision still decode.
3. **Every advertised profile proposes meaningful recipes.** Node, React,
   Next.js and TypeScript propose `test`, `typecheck`, `lint` and `build` from
   `package.json` scripts with the detected runner (vitest, jest, `node --test`,
   mocha, ava, playwright) as evidence; Go proposes `go test ./...` and
   `go vet ./...`; Python proposes `<python> -m pytest -q` only when pytest is
   configured or declared, otherwise `<python> -m unittest -v` for a `tests/`
   package, plus `ruff check .` and `mypy .` when configured, where `<python>`
   is the interpreter the host actually has (`python` on Windows, `python3`
   elsewhere); Flutter proposes `flutter test` and `flutter analyze`; native
   Android proposes the Gradle wrapper's `testDebugUnitTest` (required,
   capabilities `jdk` and `android-sdk`; `gradlew.bat` on Windows) and
   `connectedAndroidTest` (optional, capability `android-device`); native iOS
   proposes `xcodebuild test` against the workspace or project with
   placeholder scheme and destination raised as `ios-scheme` and
   `ios-destination` questions and the `xcode` capability, which is `missing`
   on every non-macOS host.
4. **Scaffolding is proposed, hashed, confirmed and executed under policy.**
   `POST /api/v1/projects/scaffold/propose` (`{profile, name, parent_dir}`)
   returns a deterministic `ScaffoldProposal` hashed with `luuna-json-v1`: the
   files that will be written from templates embedded in
   `luuna-discovery::scaffold`, the exact baseline recipes (identical to what
   discovery proposes for the result), declared generator and network steps,
   the probe results for the tools the profile needs, questions, and a
   `ready | blocked` status with the reason. Template profiles (`node`,
   `node-typescript`, `python`, `go`, `rust`) need no network: the TypeScript
   template relies on Node's built-in type stripping, and the Rust template
   ships a dependency-free `Cargo.lock` so `cargo test --locked` runs offline.
   `react` declares `npm install` as a network step. `flutter` declares
   `flutter create` as the generator (with its pub.dev resolution as a network
   step) and is blocked when `flutter` is missing. `android` and `ios` are
   always blocked: their generators are Android Studio and Xcode, the proposal
   says so and lists the recipes a later import will propose, and iOS is
   additionally blocked off macOS. A proposal writes nothing and is stored
   under `<data>/scaffolds/proposals/`.
5. **`POST /api/v1/projects/scaffold` executes exactly one proposal.** The
   body `{proposal_hash, idempotency_key, confirm: true, confirm_network?}` is
   refused for a hash that names no current proposal or whose stored content
   no longer hashes to it (409), a blocked proposal (422), unconfirmed network
   steps (422), a target that exists and is not empty (409), a target or parent
   inside the runtime data directory or containing it (422), and a project ID
   already registered (409). Otherwise the runtime writes the files (or runs
   the generator through the supervised executor), runs `git init -b main`,
   commits with hooks, signing and inherited `GIT_*` neutralised, runs the
   confirmed network steps and then the proposal's required baseline recipe
   through `luuna-executor` as a real check with private artifacts, registers
   the project through the ordinary registration path, runs discovery, and
   records `project.scaffolded` (proposal hash, commit, check outcome,
   discovery ID) in the project event stream. A failing or blocked baseline is
   returned as such with the registered project; the directory is left for the
   developer and nothing is reported passing. The result is recorded under
   `<data>/scaffolds/results/` and replayed for the same idempotency key; the
   same key with another hash is a 409. Executions are serialised.

## Consequences

Discovery responses and stored discoveries gain `host_capabilities`, and each
proposed check gains `capability` and `missing_tools`; clients show them and
the `missing-tool` questions, and confirmation remains the developer's.
Nothing here bypasses the baseline gate of ADR 0007: a scaffolded project still
confirms its manifest and records a baseline run before implementation. No
storage migration was needed; proposals and idempotency records are private
JSON files, and `project.scaffolded` uses the existing project stream.

## What remains

- **Capable-runner evidence per platform.** This decision was implemented and
  tested on Windows 11 x64 with Node, npm, Python, cargo and git present; the
  Node, TypeScript, Python and Rust scaffolds ran real passing baselines there.
  `go` was absent, so the Go profile and scaffold are proved only as a correctly
  blocked proposal and annotated discovery; the Go template's `go test ./...`
  has not been executed. Flutter, Android (JDK, SDK, device) and iOS (Xcode)
  checks were exercised only in their blocked form. M5's exit (every advertised
  profile establishing a baseline on a capable runner; Mac-specific checks
  demonstrated on a Mac) needs those hosts and remains open.
- **`flutter create` as a generator** is implemented but has not run anywhere;
  its first run on a host with Flutter is release evidence, not an assumption.
- **The React template** needs `npm install`; without network confirmation its
  baseline is blocked and the scaffold reports that.
- **Device and simulator checks** (`connectedAndroidTest`, `xcodebuild test`)
  need an `android-device`/`xcode` capability the probe can only detect as a
  tool's presence; a connected device or booted simulator is not probed.
