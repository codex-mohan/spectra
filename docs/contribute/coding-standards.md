# Coding Standards

Conventions and style rules for contributing to Spectra.

## TypeScript

### Naming

- Functions/variables: `camelCase`
- Types/classes: `PascalCase`
- Files: `kebab-case.ts`
- Constants: `UPPER_SNAKE_CASE`

### Code Style

- Use `async/await` for all asynchronous operations
- Explicit `try-catch` error handling — no bare `throw`
- JSDoc comments on all public functions
- No `any` type usage — use `unknown` or specific types
- No orphaned `// TODO` comments — must have issue numbers

### Package Names

- `@singularity-ai/spectra-ai` — provider layer
- `@singularity-ai/spectra-agent` — agent + tools
- `@singularity-ai/spectra-app` — sessions + orchestration

## Rust

### Naming

- Functions/variables: `snake_case`
- Types/traits: `PascalCase`
- Module files: `snake_case.rs`
- Constants: `UPPER_SNAKE_CASE`

### Code Style

- `#![forbid(unsafe_code)]` — no unsafe in core logic
- `?` operator for error propagation — no `unwrap`/`expect` in library code
- `thiserror` + `miette` for error types
- `tracing` for structured logging

### Dependencies

- `rustls` only — no OpenSSL
- Minimal deps — prefer standard library
- Run `cargo audit` before committing

## General

### Naming Implementations

Name classes by their behavior or storage mechanism, not by capability level:

- ✅ `MemoryRateLimiter`, `SequentialWorkerPool`, `AgentRegistry`
- ❌ `SimpleRateLimiter`, `SimpleWorkerPool`, `SimpleOrchestrator`

### Commit Messages

- Concise, focused on the "why"
- Do NOT reference external projects in commit messages
- Credit external projects in PR descriptions if needed

### Pre-Commit Checklist

```bash
# TypeScript
bun run lint    # tsc --noEmit
bun run test    # vitest --run
bun run build   # tsc build

# Rust
cargo test --workspace
cargo clippy --workspace
```

### Limitations Belong in Docs, Not Names

If an implementation has tradeoffs (in-memory only, single-threaded), document them in JSDoc and README — don't encode them in the class name.

## Next Steps

- [**Architecture Decisions**](/contribute/architecture-decisions) — Why Spectra is designed this way
- [**Setup Guide**](/contribute/setup) — Dev environment
