# Spectra

**Minimal, ultra-fast, multi-language AI agent framework**

[![TypeScript](https://img.shields.io/badge/TypeScript-0.2.4-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=0D0D0D)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.75+-000000?style=for-the-badge&logo=rust&logoColor=white&labelColor=0D0D0D)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/License-MIT-00B140?style=for-the-badge&labelColor=0D0D0D)](LICENSE)

---

A construction kit, not a pre-built house — ship only primitives that enable developers to build anything beyond the core without fighting the framework.

Each SDK (TypeScript, Rust) is a **complete, independent native implementation** — same API surface, same behavior, no shared runtime, no bindings, no FFI.

## Architecture

```mermaid
graph TB
    subgraph TypeScript["TypeScript SDK — @singularity-ai/*"]
        AI["spectra-ai<br/>LLM Providers"]
        AGENT["spectra-agent<br/>Agent Loop + Tools"]
        APP["spectra-app<br/>SessionEngine + Rate Limiting + SSE Bridge"]
        AI --> AGENT --> APP
    end

    subgraph Rust["Rust SDK — spectra-*"]
        RS["spectra-rs<br/>Core Types + Agent + Events"]
        HTTP["spectra-http<br/>Anthropic + OpenAI + Groq"]
        RS --> HTTP
    end

    subgraph Deploy["Deployment Scale"]
        LOCAL["Local · SQLite<br/>coding agent, REPL"]
        SERVER["Server · Redis + SSE<br/>SaaS, single-node"]
        CLUSTER["Cluster · Redis + K8s<br/>multi-pod, distributed"]
        LOCAL -.-> APP
        SERVER -.-> APP
        CLUSTER -.-> APP
    end
```

## Packages

| Package | Layer | Description |
|---------|-------|-------------|
| `@singularity-ai/spectra-ai` | **Provider** | LLM abstraction — stream, complete, register providers. Anthropic, OpenAI, Groq clients with SSE streaming. Core types (Message, Model, ToolCall, StopReason). |
| `@singularity-ai/spectra-agent` | **Agent** | Agent loop with multi-turn tool dispatch. `defineTool()` with Zod validation, before/after hooks, parallel/sequential execution, retry with backoff, abort support. |
| `@singularity-ai/spectra-app` | **Infrastructure** | Production runtime — `SessionEngine` (full lifecycle orchestration), `SessionManager` (CRUD + fork + audit/tree), `SessionStore` (in-memory, filesystem, SQLite, Redis), `LocalRateLimiter` + `RedisRateLimiter` (distributed sliding window), `CompositeRateLimiter` (tenant+user+provider), `CircuitBreaker`, `SseBridge` (SSE with WS-compatible interface), `HealthProbe` (K8s ready). |
| `@singularity-ai/spectra-code` | **Tools** | Pre-built coding tools — bash, read, write, edit, grep, find, web fetch. |
| `@singularity-ai/spectra-tui` | **UI** | Terminal UI components for building agent CLIs. |
| `spectra-rs` | **Rust Core** | Rust SDK — core types, agent, tools, events. |
| `spectra-http` | **Rust HTTP** | Rust HTTP clients for Anthropic, OpenAI, Groq, OpenRouter. |

## Feature Matrix

| Feature | TypeScript | Rust |
|---------|------------|------|
| Streaming SSE | ✅ | ✅ |
| Tool Dispatch (Parallel/Sequential) | ✅ | ✅ |
| Before/After Tool Hooks | ✅ | ✅ |
| Extension / Middleware System | ✅ | ✅ |
| Agent Loop (Multi-Turn) | ✅ | ✅ |
| Retry with Exponential Backoff | ✅ | — |
| Session Management | ✅ | — |
| Session Persistence (FS + SQLite) | ✅ | — |
| Redis Session Store (distributed) | ✅ | — |
| Worker Pool | ✅ | — |
| Rate Limiting (in-memory) | ✅ | — |
| Redis Rate Limiting (distributed) | ✅ | — |
| Composite Rate Limiting (tenant+user+provider) | ✅ | — |
| Circuit Breaker | ✅ | — |
| SSE Bridge (WS-compatible interface) | ✅ | — |
| Health Probe (K8s ready) | ✅ | — |
| Agent Registry | ✅ | — |
| Cost Tracking | ✅ | ✅ |
| Tool Choice / Reasoning Effort | ✅ | ✅ |
| Model Registry | ✅ | ✅ |
| Audit Trail / Provenance | ✅ | — |

## Quick Start

### TypeScript

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent
```

```typescript
import { Agent, defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";

const searchTool = defineTool({
  name: "search",
  description: "Search the web",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => ({
    content: [{ type: "text", text: `Results for: ${query}` }],
  }),
});

const agent = new Agent({
  model: { id: "claude-sonnet-4-5", provider: "anthropic", api: "messages" },
  systemPrompt: "You are a helpful assistant.",
  tools: [searchTool],
});

for await (const event of agent.run("What is Rust?")) {
  if (event.type === "message_update") {
    console.log(event.message.content);
  }
}
```

### TypeScript — Production

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent @singularity-ai/spectra-app ioredis
```

```typescript
import { SessionEngine, SessionManager, InMemorySessionStore, CompositeRateLimiter, LocalRateLimiter } from "@singularity-ai/spectra-app";

const engine = new SessionEngine({
  sessionManager: new SessionManager(new InMemorySessionStore()),
  rateLimiter: new CompositeRateLimiter([
    { limiter: new LocalRateLimiter(60, 60000), key: "tenant" },
    { limiter: new LocalRateLimiter(10, 60000), key: "user" },
  ]),
  maxConcurrentSessions: 100,
});

engine.start();
const result = await engine.run("user-123", "What is Rust?", undefined, {
  model: { id: "claude-sonnet-4-5", provider: "anthropic", api: "messages" },
});
console.log(result.finalMessage); // "Rust is a systems programming language..."
```

### Rust

```toml
[dependencies]
spectra-rs = "0.2"
spectra-http = "0.2"
tokio = { version = "1", features = ["full"] }
```

```rust
use spectra_rs::{AgentBuilder, Model, Provider};
use spectra_http::OpenAIClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?;

    let agent = AgentBuilder::new(Model::new(Provider::OpenAI, "gpt-4o"))
        .system_prompt("You are a helpful assistant.")
        .build(client.into());

    let (mut rx, _channel, _handle) = agent.run("Hello!").await?;

    while let Some(event) = rx.recv().await {
        println!("{:?}", event?);
    }

    Ok(())
}
```

## Supported Providers

| Provider | TypeScript | Rust | Streaming | Tool Use |
|----------|------------|------|-----------|----------|
| **Anthropic** | ✅ | ✅ | SSE | ✅ |
| **OpenAI** | ✅ | ✅ | SSE | ✅ |
| **Groq** | — | ✅ | SSE | — |

## Deployment Architecture

The three TypeScript packages compose for any scale — from local CLI to distributed cloud:

```
                    ┌─────────────────────────────────────┐
                    │        @singularity-ai/spectra-app   │
                    │  SessionEngine ── orchestrates full  │
                    │  request lifecycle                   │
                    │                                      │
                    │  ┌──────────────────────────────┐    │
                    │  │ SessionManager + SessionStore│    │
                    │  │ (InMemory | FS | SQLite |    │    │
                    │  │  Redis + Postgres cold)      │    │
                    │  ├──────────────────────────────┤    │
                    │  │ RateLimiter                  │    │
                    │  │ (Local | Redis | Composite)  │    │
                    │  ├──────────────────────────────┤    │
                    │  │ SseBridge → remote clients   │    │
                    │  ├──────────────────────────────┤    │
                    │  │ HealthProbe → K8s probes     │    │
                    │  └──────────────────────────────┘    │
                    └──────┬──────────────┬────────────────┘
                           │              │
              ┌────────────┴──┐   ┌───────┴──────────┐
              │ spectra-agent │   │   spectra-ai      │
              │ Agent.run()   │   │   stream(model)   │
              │ defineTool()  │   │   registerProvider│
              │ hooks + retry │   │   EventStream     │
              └───────────────┘   └──────────────────┘
```

**Local (coding agent):** SQLite store, no rate limiter, works offline
**Single-server (SaaS MVP):** Redis store + local rate limiter, 1 process
**Multi-pod (production):** Redis store (shared state), Redis rate limiter (distributed), SseBridge for SSE streaming, CompositeRateLimiter for tenant isolation

## Project Structure

```
spectra/
├── packages/
│   ├── ai/              # @singularity-ai/spectra-ai — LLM providers
│   ├── agent/           # @singularity-ai/spectra-agent — Agent + tools
│   ├── app/             # @singularity-ai/spectra-app — SessionEngine + rate limiting + SSE bridge
│   ├── code/            # @singularity-ai/spectra-code — Coding tools
│   └── tui/             # @singularity-ai/spectra-tui — Terminal UI components
├── apps/
│   └── code/            # spectra-code-app — TUI coding agent
├── crates/
│   ├── spectra-rs/      # Rust SDK core
│   └── spectra-http/    # Rust HTTP clients
└── .github/workflows/   # CI/CD
```

## Technology Stack

| Component | Technologies |
|-----------|-------------|
| **TypeScript SDK** | TypeScript 5.x · Bun · Vitest · Zod |
| **Rust SDK** | Rust 1.75+ · Tokio · Reqwest (rustls) · serde · thiserror · miette |
| **Tooling** | Turborepo · cargo |

## Rust Constraints

- **Zero `unsafe`** — No unsafe in core logic
- **No OpenSSL** — rustls only, no C dependencies
- **Release profile** — `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`, `panic = "abort"`
- **Edition 2024** — Requires Rust 1.75+

## Development

```bash
# Install
git clone https://github.com/codex-mohan/spectra.git
cd spectra
bun install

# Build all packages
bun run build

# Run tests
bun run test          # TypeScript
cargo test --workspace  # Rust
```

## License

MIT © Mohana Krishna