<!-- GSD:project-start source=PROJECT.md -->
## Project

**Spectra**

Minimal, ultra-fast, multi-language AI agent framework. Each SDK (Rust, TypeScript, Python) is a **complete, independent native implementation** — same API surface, same behavior, no shared runtime, no bindings, no FFI. Rust is not a "core" that others bind to; it is its own standalone SDK.

**Core Value:** A construction kit, not a pre-built house — ship only primitives that enable developers to build anything beyond the core without fighting the framework.

### Architecture

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   TypeScript      │  │     Python        │  │      Rust        │
│                  │  │                  │  │                  │
│  ┌────────────────┐  │  │  ┌────────────┐  │  │  ┌────────────┐  │
│  │ @singularity-  │  │  │  │            │  │  │  │            │  │
│  │ ai/spectra-ai  │  │  │  │ spectra-sdk│  │  │  │spectra-rs  │  │
│  │ (providers)    │  │  │  │ (complete) │  │  │  │ (complete) │  │
│  └────────────────┘  │  │  │            │  │  │  │            │  │
│  ┌────────────────┐  │  │  │            │  │  │  ┌────────────┐  │
│  │ @singularity-  │  │  │  │            │  │  │  │spectra-http│  │
│  │ ai/spectra-    │  │  │  │            │  │  │  │ (clients)  │  │
│  │ agent          │  │  │  │            │  │  │  └────────────┘  │
│  └────────────────┘  │  │  └────────────┘  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
      active                TODO                  active
```

### Constraints

- **Architecture**: Independent native SDKs per language — no bindings, no FFI, no shared runtime
- **Monorepo**: Turborepo orchestration, Bun workspaces (TypeScript), Cargo workspace (Rust)
- **Rust zero unsafe policy**: No unsafe in core logic (FFI boundaries only, though none currently exist)
- **Rust performance**: opt-level 3, thin LTO, codegen-units 1, strip symbols, panic=abort in release
- **Dependencies**: No OpenSSL (rustls only), minimal deps, cargo audit required
- **Python SDK**: Not yet implemented — TODO
<!-- GSD:project-end -->

<!-- GSD:stack-start source=research/STACK.md -->
## Technology Stack

### Rust SDK (`crates/spectra-rs` + `crates/spectra-http`)

| Dependency | Version | Purpose |
|------------|---------|---------|
| tokio | 1.x (full) | Async runtime |
| reqwest | 0.12 (rustls-tls) | HTTP client for LLM API calls |
| serde / serde_json | 1.x | Serialization |
| thiserror | 2.x | Error derive |
| miette | 7.x (fancy) | Human-readable error diagnostics |
| tracing / tracing-subscriber | 0.1 / 0.3 | Structured logging |
| dashmap | 6.x | Concurrent map for ToolRegistry |
| async-trait | 0.1 | Async trait for LlmClient, Tool |
| futures-core / futures-util | 0.3 | Stream trait + StreamExt |
| tokio-stream | 0.1 | ReceiverStream for SSE |
| tokio-util | 0.7 (codec) | Codec utilities |
| chrono | 0.4 (serde) | Timestamps on messages |
| toml | 0.8 | Model registry config parsing |
| bytes | 1 | Byte handling |

Dev: tokio-test, wiremock, insta

### TypeScript SDK (`packages/ai` + `packages/agent`)

| Dependency | Version | Purpose |
|------------|---------|---------|
| @anthropic-ai/sdk | ^0.32 | Anthropic Messages API (direct, not via Rust) |
| openai | ^5.3 | OpenAI Chat Completions + Responses API |
| zod | ^3.25 | Schema validation for defineTool |
| zod-to-json-schema | ^3.24 | Convert Zod schemas to JSON Schema |

Dev: typescript ^5.7, vitest ^3.2, tsx ^4.19

### Monorepo Tooling

| Tool | Purpose |
|------|---------|
| Turborepo | Task orchestration, cached builds across packages |
| Bun | Package manager with native workspace support |
| cargo | Rust workspace builds and tests |

### What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| napi-rs | Project is NOT "Rust core + bindings" — each SDK is independent | Native TS implementations with official SDKs |
| PyO3 / maturin | Same reason — Python SDK will be native, not bindings | Native Python (Pydantic, httpx, etc.) |
| OpenSSL | Security vulnerabilities, C dependency | rustls (pure Rust TLS) |
| std::thread in async | Blocks async runtime | tokio::spawn |
| unwrap/expect in library | Panics on invalid input | ? operator, proper error handling |

### Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| tokio 1.x | tokio-util 0.7.x, tokio-stream 0.1.x | Compatible, uses semver |
| Node 18+ | TypeScript 5.x | For TS SDK development |
<!-- GSD:stack-end -->

<!-- GSD:folder-start -->
## Project Structure

```
spectra/
├── crates/
│   ├── spectra-rs/                 # Rust SDK — core types, agent, LLM trait, tools, events
│   │   └── src/
│   │       ├── lib.rs              # Crate root, re-exports, prelude
│   │       ├── agent.rs            # Agent, AgentBuilder, agent loop with tool dispatch
│   │       ├── llm.rs             # LlmClient trait, Model, Provider enum, ModelRegistry, LlmRequest/Response/Stream
│   │       ├── tool.rs             # Tool trait, ToolRegistry, ToolBuilder, BuiltTool
│   │       ├── messages.rs         # Message, UserMessage, AssistantMessage, ToolResultMessage, Content, StopReason
│   │       ├── event.rs            # StreamEvent, ContentDelta, EventChannel (broadcast), EventSink
│   │       ├── extension.rs        # Extension trait, ExtensionManager (before/after hooks)
│   │       └── error.rs            # SpectraError (thiserror + miette diagnostics)
│   └── spectra-http/               # Rust HTTP LLM clients implementing LlmClient
│       └── src/
│           ├── lib.rs              # Re-exports AnthropicClient, OpenAIClient
│           ├── anthropic.rs        # Anthropic SSE streaming via reqwest
│           ├── openai.rs           # OpenAI Chat Completions SSE streaming via reqwest
│           └── test.rs             # Wiremock integration tests
├── packages/
│   ├── ai/                         # @singularity-ai/spectra-ai — TypeScript LLM provider layer
│   │   └── src/
│   │       ├── types.ts            # Core types: Message, AssistantMessage, ToolCall, StopReason, Model, etc.
│   │       ├── event-stream.ts     # EventStream<T,R> / AssistantMessageEventStream (AsyncIterable)
│   │       ├── registry.ts         # Provider registry, stream(), complete()
│   │       └── providers/
│   │           ├── anthropic.ts        # Anthropic provider (@anthropic-ai/sdk)
│   │           ├── openai-completions.ts  # OpenAI Chat Completions provider
│   │           ├── openai-responses.ts     # OpenAI Responses API provider
│   │           ├── shared.ts            # sanitizeSurrogates, parseStreamingJson
│   │           └── register-builtins.ts   # Auto-registers all providers
│   └── agent/                      # @singularity-ai/spectra-agent — TypeScript agent + tool system
│       └── src/
│           ├── agent.ts            # Agent class with run loop, tool dispatch, streaming
│           ├── types.ts            # AgentTool, ToolResult, AgentEvent, AgentConfig, hooks
│           ├── define-tool.ts      # defineTool() with Zod schema validation
│           └── index.ts            # Re-exports
├── apps/
│   └── examples/                   # Example usage
│       └── src/index.ts
├── Cargo.toml                      # Rust workspace root
├── package.json                    # Bun workspace root + turbo
├── turbo.json                      # Turborepo task config
└── .github/workflows/              # CI/CD
```
<!-- GSD:folder-end -->

<!-- GSD:conventions-start source=CONVENTIONS.md -->
## Conventions

### Architecture Pattern
- Each language SDK is a **complete, independent implementation** — they share design patterns and type shapes, not code or runtime
- Rust uses trait-based abstraction (`LlmClient`, `Tool`, `Extension`) with builder patterns (`AgentBuilder`, `ToolBuilder`)
- TypeScript uses class-based `Agent` with event listeners and `EventStream` implementing `AsyncIterable`
- Both SDKs follow: stream → accumulate deltas → dispatch tools → loop until end-of-turn

### Rust Conventions
- `LlmClient` trait: `async fn complete()` + `async fn stream()` → returns `LlmStream` (pinned Stream)
- `Tool` trait: `fn definition()` + `async fn execute()`
- `Extension` trait: hook methods (`on_before_tool_call`, `on_after_tool_call`, `on_agent_start`, etc.)
- Errors: `SpectraError` enum with `thiserror` + `miette` diagnostics, `Result<T>` type alias
- Agent loop: `run_agent_loop` spawns tokio task, emits `StreamEvent` via `mpsc::channel` + `EventChannel` (broadcast)
- HTTP clients in `spectra-http` parse SSE streams manually (no SDK wrappers)

### TypeScript Conventions
- `EventStream<T, R>` implements `AsyncIterable<T>` — push events, consume via `for await`
- `AssistantMessageEventStream` extends `EventStream` with message completion logic
- Provider pattern: `registerProvider({ name, stream })` → `stream()` / `complete()` in registry
- `Agent.run()` returns `AsyncGenerator<AgentEvent>` — yields events as they happen
- `defineTool()` uses Zod schemas → auto-validates arguments via `prepareArguments`
- Tool hooks: `beforeToolCall`, `afterToolCall`, `transformContext`, `getApiKey`
- Tool execution modes: `"parallel"` (default) or `"sequential"`

### Naming Conventions
- Rust: snake_case for functions/variables, PascalCase for types, module files are snake_case
- TypeScript: camelCase for functions/variables, PascalCase for types/classes
- Package namespaces: `@singularity-ai/spectra-ai`, `@singularity-ai/spectra-agent`, `spectra-rs`, `spectra-http`
- Provider names in registry: `"anthropic"`, `"openai-completions"`, `"openai-responses"`

### Commit Messages
- Keep messages concise and focused on the "why"
- Do NOT reference pi-mono, "pi-mono inspired", or similar in commit messages or code comments
- Spectra is an independent project — credit external projects in PR descriptions if needed, not commits

### Testing
- Rust: `cargo test --workspace` (unit + wiremock integration tests in spectra-http)
- TypeScript: `vitest --run` in each package
- No Python SDK tests yet (TODO)

### Research Guidance
- If you are unsure how to do something, use `gh_grep` to search code examples from GitHub.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source=ARCHITECTURE.md -->
## Architecture

### Rust SDK Data Flow
```
User → Agent::run(input)
  → spawn tokio task → run_agent_loop()
    → LlmClient::stream(LlmRequest)
      → SSE parse → LlmStreamEvent::ContentDelta
    → apply_delta() → accumulate AssistantMessage
    → if ToolCalls → dispatch_tool() → ToolRegistry::dispatch()
    → emit StreamEvent via mpsc + EventChannel (broadcast)
  → return (Receiver<StreamEvent>, EventChannel)
```

### TypeScript SDK Data Flow
```
User → agent.run(input)
  → AgentEventStream (extends EventStream)
    → Provider.stream(model, context, options)
      → AssistantMessageEventStream (AsyncIterable)
        → SSE events → push deltas
    → accumulate AssistantMessage
    → if toolCalls → executeTools (parallel or sequential)
      → beforeToolCall hook → execute → afterToolCall hook
    → yield AgentEvent
```

### Key Type Correspondences

| Concept | Rust | TypeScript |
|---------|------|------------|
| Agent | `Agent` / `AgentBuilder` | `Agent` class |
| LLM client | `LlmClient` trait | `Provider` interface with `stream()` |
| Message | `Message` enum (User/Assistant/ToolResult) | `Message` union type |
| Stop reason | `StopReason` enum | `StopReason` string literal union |
| Tool | `Tool` trait + `ToolBuilder` | `AgentTool` interface + `defineTool()` |
| Events | `StreamEvent` enum + `EventChannel` (broadcast) | `AgentEvent` union + `EventStream` (AsyncIterable) |
| Streaming deltas | `ContentDelta` enum | `AssistantMessageEvent` discriminated union |
| Hooks | `Extension` trait | `beforeToolCall` / `afterToolCall` callbacks |
| Tool registry | `ToolRegistry` (DashMap) | `Map<string, AgentTool>` on Agent |
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source=skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source=GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks you to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->