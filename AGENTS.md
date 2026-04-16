<!-- GSD:project-start source:PROJECT.md -->
## Project

**Spectra**

Spectra is a minimal, ultra-fast, multi-language AI agent framework with a Rust core. Inspired by pi-mono's "anti-framework" philosophy: give developers sharp primitives, not a walled garden. All SDKs (Rust, TypeScript, Python) are thin bindings over the same Rust core with identical behavior across languages.

**Core Value:** A construction kit, not a pre-built house — ship only primitives that enable developers to build anything beyond the core without fighting the framework.

### Constraints

- **Tech Stack**: Rust core (tokio async), TypeScript (napi-rs), Python (PyO3)
- **Monorepo**: Turborepo orchestration, pnpm workspaces
- **Zero unsafe policy**: No unsafe in core logic (FFI boundaries only)
- **Performance**: opt-level 3, thin LTO, panic=abort in release
- **Dependencies**: No OpenSSL (rustls), minimal deps, cargo audit required
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Rust | 1.75+ | Core runtime | Zero-cost abstractions, memory safety, native performance |
| tokio | 1.x | Async runtime | Industry standard, best ecosystem for async Rust |
| reqwest | 0.12 | HTTP client | rustls support, streaming, async-first |
| serde | 1.x | Serialization | Zero-cost derive, universal ecosystem support |
| thiserror | 2.x | Error derive | Zero overhead, idiomatic Rust errors |
| miette | 7.x | Error display | Best-in-class human-readable terminal errors |
| tracing | 0.1 | Structured logging | Zero-cost when disabled, structured fields |
| dashmap | 6.x | Concurrent map | Lock-free reads, no mutex contention |
### Binding Technologies
| Technology | Purpose | Why Recommended |
|------------|---------|-----------------|
| napi-rs | TypeScript bindings | Fastest N-API Rust binding, first-class TypeScript support |
| PyO3 + maturin | Python bindings | PyO3 is the Rust library, maturin is the build tool - together they compile Rust to .pyd/.so |
### Schema Validation
| Library | Language | Why Recommended |
|---------|----------|-----------------|
| Zod | TypeScript | Standard, composable, tree-shakeable |
| Pydantic v2 | Python | Rust-backed (rusdata), fastest Python validation |
### Tooling
| Tool | Purpose | Notes |
|------|---------|-------|
| Turborepo | Task orchestration | Language-agnostic, cached builds |
| pnpm | Package manager | Fast, efficient workspace support |
| cargo-nextest | Test runner | Faster test execution, better output |
| cargo-audit | Security audit | Catches vulnerable dependencies |
## Installation
# Rust toolchain
# Build dependencies
# Python extension (from spectra-py/)
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| tokio | async-std | tokio has better ecosystem for network-heavy workloads |
| reqwest | surf | reqwest has better streaming support |
| PyO3 | cpython | PyO3 is Rust-native, safer memory model |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| OpenSSL | Security vulnerabilities, C dependency | rustls (pure Rust TLS) |
| std::thread in async | Blocks async runtime | tokio::spawn |
| thread::sleep | Blocks thread | tokio::time::sleep |
| unwrap/expect in library | Panics on invalid input | ? operator, proper error handling |
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| tokio 1.x | tokio-util 0.7.x | Compatible, uses semver |
| napi-rs 3.x | Node 18+ | Native addon compatibility |
| PyO3 0.22+ + maturin 1.7+ | Python 3.11+ | Required for stabilized features |
## Sources
- tokio.rs official documentation
- napi-rs GitHub repository
- PyO3 user guide
- thiserror/miette crates documentation
<!-- GSD:stack-end -->

<!-- GSD:pi-mono-ref-start -->
## Reference Implementation: pi-mono

**Location:** `~/pi-mono-ref/` (cloned from https://github.com/badlogic/pi-mono)

**Purpose:** Study pi-mono for patterns on:
- LLM provider streaming implementations
- Event stream architecture
- Tool execution handling
- Agent loop patterns

### Key Files to Reference

| File | Purpose |
|------|---------|
| `packages/ai/src/providers/anthropic.ts` | Anthropic Messages API + SSE streaming |
| `packages/ai/src/providers/openai-completions.ts` | OpenAI Chat Completions + SSE streaming |
| `packages/ai/src/providers/google-vertex.ts` | Google Vertex AI + streaming |
| `packages/ai/src/utils/event-stream.ts` | AsyncIterable event stream class |
| `packages/ai/src/types.ts` | Stream event types, StreamOptions |
| `packages/ai/src/providers/simple-options.ts` | Options building helpers |

### Provider Patterns

All providers follow the same streaming pattern:

1. **Create `AssistantMessageEventStream`** - the return value
2. **Push `start` event** with partial message
3. **Iterate SSE stream**, pushing deltas for each chunk type
4. **Push completion event** (`done` or `error`)

**Anthropic** (SSE events: `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`)
- Uses `@anthropic-ai/sdk` official SDK
- Handles text, thinking, and tool call streaming
- Supports prompt caching with `cacheControl`

**OpenAI Completions** (SSE events: standard Chat Completions chunks)
- Uses `openai` official SDK
- Handles text deltas, reasoning (thinking), and tool call streaming
- Supports `toolChoice`, `reasoningEffort` options

**Google Vertex** (streaming via `@google/genai`)
- Uses official Google GenAI SDK with Vertex-specific auth
- Handles text, thinking, and tool call streaming
- Supports thinking budgets, project/location configuration

### pi-mono Streaming Pattern

pi-mono uses a generic `EventStream<T, R>` class implementing `AsyncIterable<T>`:

```typescript
export class EventStream<T, R = T> implements AsyncIterable<T> {
  push(event: T): void;     // Queue events for consumers
  end(result?: R): void;    // Signal completion
  result(): Promise<R>;     // Get final result
  async *[Symbol.asyncIterator](): AsyncIterator<T>;  // Async iteration
}
```

`AssistantMessageEventStream` extends this with message completion logic.

### Key Insights from pi-mono

1. **Provider functions** return `AssistantMessageEventStream` - consumers iterate async
2. **StreamOptions** includes: signal (AbortSignal), apiKey, onPayload callback, headers
3. **Built-in providers**: Anthropic, OpenAI, Google, Mistral, Bedrock, Groq, etc.
4. **No tool streaming in core** - tools handled separately via extensions
<!-- GSD:pi-mono-ref-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
