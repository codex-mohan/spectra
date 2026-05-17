# Project Structure

Spectra is organized as a monorepo with independent SDKs for each language. This guide explains the layout and why it's structured this way.

## Monorepo Layout

```
spectra/
├── packages/                    # TypeScript SDKs (Bun workspaces)
│   ├── ai/                      # @singularity-ai/spectra-ai
│   │   └── src/
│   │       ├── types.ts         # Core types: Message, Model, StopReason
│   │       ├── event-stream.ts  # EventStream<T,R> (AsyncIterable)
│   │       ├── registry.ts      # Provider registry
│   │       └── providers/       # Anthropic, OpenAI implementations
│   ├── agent/                   # @singularity-ai/spectra-agent
│   │   └── src/
│   │       ├── agent.ts         # Agent class with run loop
│   │       ├── types.ts         # AgentTool, AgentEvent, AgentConfig
│   │       └── define-tool.ts   # defineTool() with Zod validation
│   └── app/                     # @singularity-ai/spectra-app (optional)
│       └── src/
│           ├── session.ts       # SessionManager, SessionStore
│           ├── engine.ts        # SessionEngine orchestration
│           ├── rate-limiter.ts  # LocalRateLimiter, RedisRateLimiter
│           ├── worker-pool.ts   # SequentialWorkerPool
│           └── registry.ts      # AgentRegistry for multi-agent
│
├── crates/                      # Rust SDKs (Cargo workspace)
│   ├── spectra-rs/              # Core types, agent, traits
│   │   └── src/
│   │       ├── lib.rs           # Re-exports, prelude
│   │       ├── agent.rs         # Agent, AgentBuilder
│   │       ├── llm.rs           # LlmClient trait, Model, Provider
│   │       ├── tool.rs          # Tool trait, ToolRegistry
│   │       ├── messages.rs      # Message enum, Content, StopReason
│   │       ├── event.rs         # StreamEvent, EventChannel
│   │       ├── extension.rs     # Extension trait (hooks)
│   │       └── error.rs         # SpectraError (thiserror + miette)
│   └── spectra-http/            # HTTP LLM clients
│       └── src/
│           ├── anthropic.rs     # Anthropic SSE streaming
│           └── openai.rs        # OpenAI SSE streaming
│
├── apps/
│   └── examples/                # Example applications
│
├── docs/                        # VitePress documentation
│
├── Cargo.toml                   # Rust workspace root
├── package.json                 # Bun workspace root + turbo
└── turbo.json                   # Turborepo task config
```

## Why This Structure?

### Independent SDKs

Each SDK is a **complete, independent implementation**. They share design patterns and type shapes, not code or runtime.

- **TypeScript** lives in `packages/` — managed by Bun workspaces + Turborepo
- **Rust** lives in `crates/` — managed by Cargo workspace

There is no "core" that other SDKs bind to. Rust is not a library that TypeScript wraps. They are peers.

### Package Separation (TypeScript)

| Package | Responsibility |
|---|---|
| `@singularity-ai/spectra-ai` | LLM provider layer — handles streaming, SSE parsing, provider registration |
| `@singularity-ai/spectra-agent` | Agent orchestration — run loop, tool dispatch, event streaming |
| `@singularity-ai/spectra-app` | Production features — sessions, rate limiting, multi-agent delegation |

This separation lets you:
- Use just the provider layer if you want to build your own agent
- Use the agent without session management for simple apps
- Add `spectra-app` when you need production features

### Crate Separation (Rust)

| Crate | Responsibility |
|---|---|
| `spectra-rs` | Core types, Agent, LlmClient trait, Tool trait, Extension trait |
| `spectra-http` | HTTP clients — AnthropicClient, OpenAIClient with SSE streaming |

The HTTP clients are separate so you can implement your own `LlmClient` without pulling in `reqwest`.

## Key Design Decisions

### No Shared Runtime

TypeScript and Rust SDKs do not share:
- Code
- Build artifacts
- Runtime dependencies
- Package managers

They share **design patterns**:
- Same agent loop concept (stream → accumulate → dispatch → repeat)
- Same event types (message updates, tool execution, turn boundaries)
- Same tool definition approach (schema + execute function)

### No FFI, No Bindings

Spectra does not use:
- napi-rs (Rust → Node bindings)
- PyO3 / maturin (Rust → Python bindings)
- WebAssembly
- Any cross-language communication

Each SDK is written in its native language, using its native ecosystem.

### Minimal Dependencies

- **TypeScript**: Only `@anthropic-ai/sdk`, `openai`, `zod`, `zod-to-json-schema`
- **Rust**: `tokio`, `reqwest` (rustls), `serde`, `thiserror`, `miette` — no OpenSSL

## Navigation

- [**TypeScript SDK**](/typescript/overview) — Deep dive into the TS packages
- [**Rust SDK**](/rust/overview) — Deep dive into the Rust crates
- [**Concepts**](/concepts/agent-loop) — How the agent loop works across both SDKs
