#!/usr/bin/env node
// Luuna terminal client. `luuna-tui` alone opens the interactive workbench; `luuna-tui <command>
// [args] [--json]` runs one cataloged action for scripts and tests (see src/commands.mjs).
import { main } from "../src/cli.mjs";

process.exitCode = await main(process.argv.slice(2), { env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
