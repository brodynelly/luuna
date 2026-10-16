# Contributing to Mulch

Thanks for your interest in contributing to Mulch! This guide covers everything you need to get started.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/mulch.git
   cd mulch
   ```
3. **Install** dependencies:
   ```bash
   npm install
   ```
4. **Create a branch** for your work:
   ```bash
   git checkout -b fix/description-of-change
   ```

## Branch Naming

Use descriptive branch names with a category prefix:

- `fix/` -- Bug fixes
- `feat/` -- New features
- `docs/` -- Documentation changes
- `refactor/` -- Code refactoring
- `test/` -- Test additions or fixes

## Build & Test Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Compile in watch mode
npm run test           # Run all tests (vitest)
npm run lint           # Type-check only (tsc --noEmit)
npx vitest run test/commands/record.test.ts  # Run a single test file
```

Always run `npm run lint` and `npm run test` before submitting a PR.

## TypeScript Conventions

Mulch is an ESM-only TypeScript project. Please follow these conventions:

### ESM Imports

All relative imports **must** end with the `.js` extension, even though the source files are `.ts`:

```typescript
import { loadConfig } from "./utils/config.js";
import { formatRecord } from "./utils/format.js";
```

### Ajv Import Shim

Ajv requires a special ESM/CJS interop shim. Always import it like this:

```typescript
import _Ajv from "ajv";
const Ajv = _Ajv.default ?? _Ajv;
```

Using `import Ajv from "ajv"` directly will compile fine but throw `Ajv is not a constructor` at runtime.

### JSON Schemas

Never put JSON schemas in `.json` files -- `tsc` won't copy them to `dist/`. Export schemas as `const` from `.ts` files instead:

```typescript
// src/schemas/record-schema.ts
export const recordSchema = { /* ... */ };
```

### Other Rules

- No `any`, no `@ts-ignore`, no `@ts-expect-error`
- Use `process.exitCode = 1` instead of `process.exit(1)` for testability
- Ajv strict mode requires `type: "object"` alongside `required` and `properties` in every schema definition

## Testing Conventions

- **No mocks.** Tests use real filesystems.
- Create temp directories with `mkdtemp`, write real config and JSONL files, assert against real file contents.
- Clean up in `afterEach`.
- Test files mirror the source structure: `test/commands/` for `src/commands/`, `test/utils/` for `src/utils/`.

Example test structure:

```typescript
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, it, expect } from "vitest";

describe("my-command", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "mulch-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  it("does the thing", async () => {
    // Write real files, run real code, assert real results
  });
});
```

## Adding a New Command

1. Create `src/commands/<name>.ts` exporting `register<Name>Command(program)`
2. Register it in `src/cli.ts`
3. Add tests in `test/commands/<name>.test.ts`
4. Update the CLI Reference table in `README.md`

## Commit Message Style

Use concise, descriptive commit messages. The project follows a conventional-ish style:

```
fix: security hardening -- command injection, path traversal
Add tests for security hardening changes
Bump version to 0.2.5, add session-end reminder
Document concurrency & multi-agent safety across README
```

Prefix with `fix:`, `feat:`, or `docs:` when the category is clear. Plain descriptive messages are also fine.

## Pull Request Expectations

- **One concern per PR.** Keep changes focused -- a bug fix, a feature, a refactor. Not all three.
- **Tests required.** New features and bug fixes should include tests. See the testing conventions above.
- **Passing CI.** All PRs must pass the CI checks (build + test) before merge.
- **Description.** Briefly explain what the PR does and why. Link to any relevant issues.
- **No generated files.** Don't commit `dist/` -- it's built in CI.

## Reporting Issues

Use [GitHub Issues](https://github.com/jayminwest/mulch/issues) for bug reports and feature requests. For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
