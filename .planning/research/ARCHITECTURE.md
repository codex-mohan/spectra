# Architecture Research

**Domain:** AI Agent Framework
**Researched:** 2026-04-08
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      USER CODE                               │
│  (Rust app / TypeScript app / Python app / CLI)             │
├─────────────────────────────────────────────────────────────┤
│                      SDK LAYER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ spectra-rs  │  │ spectra-ts  │  │ spectra-py  │        │
│  │ (Rust SDK)  │  │ (TS SDK)    │  │ (Py SDK)    │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                 │                │                │
│         │        FFI / IPC bindings         │                │
├─────────┴────────────────┬┴────────────────┴─────────────────┤
│                      CORE LAYER                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    spectra-core                          │ │
│  │                                                          │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │ │
│  │  │AgentLoop │  │LLMClient │  │ToolEngine│  │StreamBus│ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │ │
│  │                                                          │ │
│  │  ┌─────────────────────────────────────────────────────┐│ │
│  │  │                    Error Types                       ││ │
│  │  └─────────────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| AgentLoop | Orchestrates LLM calls, tool execution, history | Single run_loop function |
| LLMClient | Provider abstraction, streaming, rate limits | Trait with async methods |
| ToolEngine | Tool registration, validation, dispatch | ToolRegistry with concurrent dispatch |
| StreamBus | Async event streaming to callers | mpsc channels, AsyncIterable |
| ErrorTypes | Typed, structured errors with diagnostics | thiserror + miette |

## Recommended Project Structure

```
spectra/
├── Cargo.toml              # Workspace root
├── package.json             # bun workspace root
├── turbo.json               # Turborepo config
├── package.json              # bun workspaces (no separate yaml)
│
├── crates/                  # Rust crates
│   ├── spectra-core/        # Core (agent loop, LLM, tools, errors)
│   │   ├── src/
│   │   │   ├── agent.rs     # Agent + run_loop
│   │   │   ├── model.rs     # LLM client trait + types
│   │   │   ├── tool.rs      # Tool registry + trait
│   │   │   ├── error.rs     # Error types
│   │   │   └── lib.rs        # Re-exports
│   │   └── package.json      # Turborepo wrapper
│   │
│   ├── spectra-rs/          # Rust SDK
│   │   ├── src/
│   │   │   ├── lib.rs       # Re-exports + builders
│   │   │   └── extension.rs # Extension trait
│   │   └── package.json
│   │
│   ├── spectra-napi/        # napi-rs bindings
│   │   ├── src/
│   │   │   └── lib.rs       # N-API exports
│   │   └── package.json
│   │
│   └── spectra-pyo3/        # PyO3 bindings
│       ├── src/
│       │   └── lib.rs       # Python module
│       └── Cargo.toml
│
├── packages/                # Non-Rust packages
│   ├── spectra-ts/          # TypeScript SDK
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── agent.ts
│   │   │   ├── model.ts
│   │   │   ├── tool.ts
│   │   │   ├── stream.ts
│   │   │   └── errors.ts
│   │   ├── native/          # Compiled .node
│   │   └── package.json
│   │
│   └── spectra-py/          # Python SDK
│       ├── spectra/
│       │   ├── __init__.py
│       │   ├── agent.py
│       │   ├── model.py
│       │   ├── tool.py
│       │   └── errors.py
│       └── pyproject.toml
│
└── apps/
    └── spectra-coder/       # CLI coding agent
        ├── src/
        └── package.json
```

### Structure Rationale

- **crates/ for Rust:** Cargo workspace organization, native compilation
- **packages/ for JS/Python:** Package manager workspaces, pure language code
- **apps/ for executables:** Standalone applications built on SDKs

## Architectural Patterns

### Pattern 1: Trait-Based Abstraction

**What:** Core functionality defined as traits, SDKs implement thin wrappers
**When to use:** LLM providers, tools, extensions
**Trade-offs:** +Extensible, +Testable, -Indirection

```rust
#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn complete(&self, messages: &[Message], tools: &[Tool], config: &ModelConfig) -> Result<EventStream>;
}
```

### Pattern 2: Concurrent Tool Dispatch

**What:** All tool calls in a round execute simultaneously
**When to use:** Parallel tool execution, no ordering dependencies
**Trade-offs:** +Performance, -Order non-determinism

```rust
for handle in handles {
    tokio::spawn(async move {
        registry.dispatch(name, args).await
    });
}
```

### Pattern 3: Async Streaming

**What:** Events emitted as AsyncIterable/AsyncIterator
**When to use:** Streaming LLM responses, tool result callbacks
**Trade-offs:** +Memory efficient, +Responsive, -Synchronous access

```rust
pub type EventStream = Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>;
```

## Data Flow

### Agent Loop Flow

```
User Input
    ↓
Message::User (add to history)
    ↓
LLMClient::complete (send to model)
    ↓
Stream events (yield to caller)
    ├── TextDelta → Forward to user
    ├── ToolCall → Queue for execution
    └── Done → End loop
    ↓
Tool calls execute concurrently
    ↓
ToolResult events (yield to caller)
    ↓
Message::Assistant + Message::User (tool results) → Add to history
    ↓
Repeat until no more tool calls
```

### SDK Binding Flow

```
User calls: agent.prompt("hello")
    ↓
SDK wrapper (Rust TS Python)
    ↓
FFI call to native addon (.node / .pyd)
    ↓
spectra-core Agent::prompt()
    ↓
Stream of events back through FFI
    ↓
SDK converts to language-native async iteration
    ↓
User iterates: async for event in agent.prompt()
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 agents | Single instance, no sharding |
| 100-1000 agents | Connection pooling, rate limiting |
| 1000+ agents | Horizontal scaling, distributed agent state |

### Scaling Priorities

1. **First bottleneck:** LLM API rate limits — handle with backoff
2. **Second bottleneck:** Tool execution — concurrent dispatch helps
3. **Third bottleneck:** History memory — per-agent memory management

## Anti-Patterns

### Anti-Pattern 1: Shared Mutable State

**What people do:** Global tool registry, static variables
**Why it's wrong:** Thread safety issues, hard to test, implicit coupling
**Do this instead:** Pass registry as Arc<dyn ToolRegistry>, owned per agent

### Anti-Pattern 2: Synchronous Blocking in Async

**What people do:** std::thread::sleep, blocking file I/O
**Why it's wrong:** Blocks the async runtime, kills concurrency
**Do this instead:** tokio::time::sleep, tokio::fs

### Anti-Pattern 3: No Error Context

**What people do:** Generic "Tool failed" errors
**Why it's wrong:** Users can't debug, no actionable info
**Do this instead:** Typed errors with miette diagnostics, source chains

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Anthropic API | reqwest HTTP client | Streaming via SSE |
| OpenAI API | reqwest HTTP client | Streaming via SSE |
| Groq API | reqwest HTTP client | Fast inference |
| File system | tokio::fs | Async file I/O |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| SDK ↔ Core | FFI (napi/PyO3) | Zero-copy where possible |
| Core modules | Direct function calls | Private APIs |
| User code ↔ SDK | Async iteration | Language-native patterns |

## Sources

- tokio async runtime patterns
- napi-rs architecture
- PyO3 user guide
- Rust async ecosystem patterns

---
*Architecture research for: AI Agent Framework*
*Researched: 2026-04-08*
