# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Project overview

OpenCode plugin that adds a `cross-repo` tool for cloning, reading, writing, branching, committing, pushing, and creating PRs/MRs across GitHub and GitLab repositories. Built with TypeScript, Bun, and the `@opencode-ai/plugin` SDK.

### Key files

- `src/index.ts` — all tool logic: operations, auth, platform detection, shell helpers
- `src/plugin.ts` — package entry point; re-exports `CrossRepoPlugin` only
- `build.config.ts` — unbuild config (outputs ESM to `dist/`)
- `vitest.config.ts` — test config with `@opencode-ai/plugin` pre-bundled

## Build, lint, test, format

```bash
# Install dependencies
bun install

# Build (outputs to dist/)
bun run build

# Type-check without emitting
bun run typecheck

# Lint
bun run lint

# Format
bun run format

# Run all tests
bun run test

# Run a single test file
bunx vitest run test/tool.spec.ts

# Run a single test by name
bunx vitest run -t "has required tool properties"
```

Always run `bun run typecheck` before committing. The project uses `strict: true` in tsconfig.

## Code style

### TypeScript

- Target: ESNext, module: ESNext, moduleResolution: bundler
- `strict: true` — do not weaken strictness or add `@ts-ignore`/`@ts-expect-error`
- Do not use type casts (`as`) to work around type errors; fix the types instead
- Use explicit return types on exported functions
- Prefer `interface` for object shapes, `type` for unions/aliases
- Use `unknown` over `any` in catch blocks (see `catch (err: unknown)` pattern in codebase)

### Naming

- Functions: `camelCase` (e.g. `shellEscape`, `getClonePath`, `detectPlatformFromRemote`)
- Types/interfaces: `PascalCase` (e.g. `PlatformInfo`, `ExecutionContext`, `CrossRepoOptions`)
- Constants: `camelCase` for module-level state (e.g. `cachedPlatform`, `clonedRepos`)
- Exported functions that test internals include `reset` prefix (e.g. `resetPlatformCache`)

### Formatting

- Formatter: `oxfmt` (run via `bun run format`)
- Linter: `oxlint` (run via `bun run lint`)
- 2-space indentation, trailing commas, double quotes for strings
- No semicolons are omitted — always use semicolons

### Imports

- Use named imports from `@opencode-ai/plugin`: `import { tool, type Plugin, type ToolContext }`
- Use `type` keyword for type-only imports: `type Plugin`, `type ToolContext`
- Node built-ins imported by name: `import { tmpdir } from "os"`
- No default imports from Node/third-party unless the module only exports default
- Keep imports at the top of the file, no dynamic imports in hot paths

### Error handling

- The `execute()` function must **never throw**. Wrap all operation logic in try/catch and return `{ success: false, error: "..." }` as JSON.
- Use `error instanceof Error ? error.message : String(error)` for unknown errors.
- Validate all user inputs (owner, repo, path) before use. Use `isValidRepoIdentifier()` and `safeResolvePath()`.
- Sanitize git output with `sanitizeGitOutput()` before returning errors to prevent token leakage.

### Security

- All shell arguments must be escaped via `shellEscape()` (uses `shescape`).
- Path traversal: always validate with `safeResolvePath()` before read/write/list.
- Repo identifiers: validate with `isValidRepoIdentifier()` to block `..`, `/`, `\`.
- Never expose tokens in error messages or tool output.

## No console logging

**Do not use `console.log`, `console.warn`, `console.info`, `console.debug`, or `console.error`.**

This is an OpenCode plugin. Plugins share stdout/stderr with the host TUI process. Any output written to stdout corrupts the TUI rendering and leaks internal data to the user (see: the `cross_repo_exec` audit event bug). Any output to stderr may also surface unexpectedly.

Errors should be returned in the tool's JSON response (`{ success: false, error: "..." }`), not logged. If you need to add observability, use the `ctx.metadata()` callback from `ToolContext` instead.

## Testing

- Framework: Vitest with `globals: true`
- Test files live in `test/` with `.spec.ts` suffix
- Import test utilities from `vitest`: `import { describe, it, expect, beforeEach, afterEach }`
- Use `mockToolContext` pattern for providing `ToolContext` to `execute()` calls
- Use `resetPlatformCache()` in `beforeEach`/`afterEach` to isolate platform detection state
- Restore `process.env` in `afterEach` to prevent test pollution
- Tests should verify JSON parse-ability of all return values (`expect(() => JSON.parse(result)).not.toThrow()`)
- Focus on error paths and input validation; avoid testing language primitives

## Plugin architecture

- `src/plugin.ts` is the npm entry point. It must **only** export Plugin-compatible functions.
- `CrossRepoPlugin` is the direct plugin export (for `opencode.json` `"plugin"` array).
- `crossRepo()` is a factory that accepts `CrossRepoOptions` for advanced config.
- `crossRepoTool` is the raw tool definition (default export, for `.opencode/tool/` usage).
- The tool returns all results as `JSON.stringify()`'d objects with `{ success: boolean, ... }`.

## Dependency policy

- Keep dependencies minimal. Currently only `shescape` is a runtime dependency.
- `@opencode-ai/plugin` is an optional dependency (provided by the host at runtime).
- Dev dependencies: `unbuild`, `vitest`, `oxlint`, `oxfmt`, `typescript`, `@types/bun`, `@types/node`.
- Do not add dependencies without explicit approval.
