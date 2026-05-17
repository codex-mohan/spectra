# Architecture Decisions

Why Spectra is designed the way it is.

## Independent SDKs

**Decision:** Each language SDK is a complete, independent native implementation — no shared code, no FFI, no bindings.

**Rationale:**
- No single point of failure — a bug in Rust doesn't affect TypeScript
- Each SDK uses its language's best practices and ecosystem
- No build complexity from cross-language tooling
- Developers get native performance and idioms in their language

**Alternatives considered:**
- Rust core + bindings (napi-rs, PyO3) — rejected: creates a "core" dependency, adds FFI complexity
- Shared protocol + implementations — rejected: adds runtime overhead, debugging complexity

## Streaming-First

**Decision:** All LLM communication uses SSE streaming by default.

**Rationale:**
- LLMs generate text token by token — streaming is the natural interface
- Better UX — users see text as it arrives
- Early tool call detection — the agent can start executing tools before the full response
- Cancellation support — users can abort mid-stream

## Minimal Dependencies

**Decision:** Each SDK uses the minimum dependencies needed.

**Rationale:**
- Faster builds
- Smaller bundle size (TypeScript)
- Fewer security vulnerabilities
- Easier auditing

**TypeScript:** Only `@anthropic-ai/sdk`, `openai`, `zod`, `zod-to-json-schema`
**Rust:** `tokio`, `reqwest` (rustls), `serde`, `thiserror`, `miette`

## No OpenSSL

**Decision:** Rust SDK uses `rustls` only, never OpenSSL.

**Rationale:**
- OpenSSL is a C dependency with a history of vulnerabilities
- `rustls` is pure Rust, audited, and maintained
- Simplifies cross-compilation (no C toolchain needed)

## Primitives Over Presets

**Decision:** Ship only the minimal building blocks, not pre-built agent architectures.

**Rationale:**
- Developers can compose any pattern from primitives
- No "right way" imposed — the framework doesn't dictate architecture
- Easier to understand — 4 core concepts, not 47 abstractions
- Easier to extend — add only what you need

## Zod for TypeScript Tools

**Decision:** Tool parameters use Zod schemas for validation.

**Rationale:**
- Type inference — `args` is automatically typed as `z.infer<T>`
- Runtime validation — invalid args never reach `execute()`
- JSON Schema generation — schemas convert to the format LLMs expect
- Single source of truth — one schema defines types, validation, and LLM description

## thiserror + miette for Rust Errors

**Decision:** Rust SDK uses `thiserror` for error derivation and `miette` for diagnostics.

**Rationale:**
- `thiserror` — zero-cost error types with `#[derive(Error)]`
- `miette` — human-readable error output with source spans
- Both are minimal, well-maintained, and idiomatic Rust

## Next Steps

- [**Coding Standards**](/contribute/coding-standards) — Style rules
- [**Setup Guide**](/contribute/setup) — Dev environment
