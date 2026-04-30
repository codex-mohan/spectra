# Spectra

**Minimal, ultra-fast, multi-language AI agent framework**

[![Rust](https://img.shields.io/badge/Rust-1.75+-000000?style=for-the-badge&logo=rust&logoColor=white&labelColor=0D0D0D)](https://www.rust-lang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-0.2.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=0D0D0D)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-TODO-3776AB?style=for-the-badge&logo=python&logoColor=white&labelColor=0D0D0D)](https://www.python.org)
[![License](https://img.shields.io/badge/License-MIT-00B140?style=for-the-badge&labelColor=0D0D0D)](LICENSE)
[![Status](https://img.shields.io/badge/Status-V0.2.0-FE7D37?style=for-the-badge&labelColor=0D0D0D)]()

---

A construction kit, not a pre-built house — ship only primitives that enable developers to build anything beyond the core without fighting the framework.

## Key Features

- **Streaming-First** — All LLM providers stream SSE by default. Event-driven architecture with real-time updates.
- **Multi-Language** — Rust and TypeScript SDKs supported.
- **Provider Abstraction** — Built-in Anthropic, OpenAI support.
- **Tool System** — Define tools in native language with Zod schemas (TS) or trait implementations (Rust).
- **Agent Loop** — Multi-turn with automatic tool dispatch, delta accumulation, and event streaming.
- **Extension Hooks** — Before/after tool calls, agent/turn lifecycle. Composable middleware pattern.

## Technology Stack

| Component | Technologies |
|-----------|-------------|
| **Rust SDK** | Rust 1.75+ · Tokio · Reqwest (rustls) · serde · thiserror · miette |
| **TypeScript SDK** | TypeScript 5.x · Vitest · Zod |
| **Python SDK** | Python 3.11+ · Pydantic |
| **Tooling** | Turborepo · Bun · cargo-nextest |

## Project Structure

```
spectra/
├── packages/
│   ├── ai/                     # @singularity-ai/spectra-ai — TypeScript providers
│   │   └── src/
│   │       ├── types.ts        # Core types
│   │       ├── event-stream.ts # AsyncIterable event stream
│   │       ├── registry.ts     # Provider registry
│   │       └── providers/      # Anthropic, OpenAI implementations
│   └── agent/                  # @singularity-ai/spectra-agent — TypeScript agent + tools
│       └── src/
│           ├── agent.ts        # Agent implementation
│           └── define-tool.ts  # Tool definition builder
├── crates/
│   ├── spectra-rs/             # Rust SDK (complete implementation)
│   │   └── src/
│   │       ├── agent.rs        # Agent implementation
│   │       ├── llm.rs          # LLM trait, Model, Provider
│   │       ├── tool.rs         # Tool trait, ToolRegistry
│   │       ├── event.rs        # StreamEvent types
│   │       └── messages.rs     # Message types
│   └── spectra-http/           # Rust HTTP clients
│       ├── src/anthropic.rs     # Anthropic provider
│       └── src/openai.rs       # OpenAI provider
└── .github/workflows/          # CI/CD
```

## Getting Started

### Prerequisites

- **Rust** 1.75+ (edition 2024)
- **Bun** 1.3+ (for TypeScript SDK)

### Rust

```toml
[dependencies]
spectra-rs = "0.2"
```

```rust
use spectra_rs::{Agent, AgentBuilder, Model};
use spectra_http::OpenAIClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?;

    let agent = AgentBuilder::new()
        .model(Model::openai("gpt-4o"))
        .system_prompt("You are a helpful assistant.")
        .build(client);

    let mut stream = agent.prompt("Hello!").await?;

    while let Some(event) = stream.next().await {
        println!("{:?}", event?);
    }

    Ok(())
}
```

### TypeScript

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent
```

```typescript
import { Agent, anthropic, defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";

const searchTool = defineTool({
  name: "search",
  description: "Search the web",
  schema: z.object({ query: z.string() }),
});

const agent = new Agent({
  model: anthropic("claude-sonnet-4-5"),
  systemPrompt: "You are a helpful assistant.",
  tools: [searchTool],
});

for await (const event of agent.prompt("What is Rust?")) {
  if (event.type === "message_delta") {
    process.stdout.write(event.delta.delta ?? "");
  }
}
```

### Python (TODO)

```bash
pip install spectra-sdk
```

```python
from spectra import Agent, openai

agent = Agent({
    "model": {"provider": "openai", "id": "gpt-4o"},
    "system_prompt": "You are a helpful assistant.",
    "tools": [],
})

async for event in agent.prompt("Hello!"):
    print(event)
```

## Supported Providers

| Provider | TypeScript | Rust | Streaming | Tool Use |
|----------|------------|------|-----------|----------|
| **Anthropic** | Available | Available | SSE | Available |
| **OpenAI** | Available | Available | SSE | Available |

## Architecture

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   TypeScript      │  │     Python        │  │      Rust        │
│                  │  │                  │  │                  │
│  ┌────────────────┐  │  │  ┌────────────┐  │  │  │  ┌────────────┐  │  │
│  │ @singularity-  │  │  │  │            │  │  │  │  │            │  │  │
│  │ ai/spectra-ai  │  │  │  │ spectra-sdk│  │  │  │  │spectra-rs  │  │  │
│  │ (providers)    │  │  │  │ (complete) │  │  │  │  │ (complete) │  │  │
│  └────────────────┘  │  │  │            │  │  │  │  │            │  │  │
│  ┌────────────────┐  │  │  │            │  │  │  │  ┌────────────┐  │  │
│  │ @singularity-  │  │  │  │            │  │  │  │  │spectra-http│  │  │
│  │ ai/spectra-    │  │  │  │            │  │  │  │  │ (clients)  │  │  │
│  │ agent          │  │  │  │            │  │  │  │  └────────────┘  │  │
│  └────────────────┘  │  │  └────────────┘  │  │  │                  │  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
      active                active                active
```
## API Surface

### Core Concepts

| Concept | Purpose |
|---------|---------|
| `Agent` | Orchestrates multi-turn conversation with tool dispatch |
| `Provider` | LLM provider abstraction (Anthropic, OpenAI, etc.) |
| `Tool` | Tool definition + execution |
| `EventStream` | AsyncIterable stream of events |
| `Model` | Provider + model ID + optional config |

### Agent Events

| Event | When |
|-------|------|
| `start` | Agent begins processing |
| `text_start` | Text content begins |
| `text_delta` | Text content delta |
| `text_end` | Text content complete |
| `thinking_start` | Reasoning content begins |
| `thinking_delta` | Reasoning content delta |
| `thinking_end` | Reasoning content complete |
| `toolcall_start` | Tool call begins |
| `toolcall_delta` | Tool call arguments delta |
| `toolcall_end` | Tool call complete |
| `done` | Agent processing complete |
| `error` | Something went wrong |

## Rust Constraints

- **Zero unsafe policy** — No unsafe in core logic. FFI boundaries only.
- **No OpenSSL** — rustls only. No C dependencies.
- **Release profile** — opt-level 3, thin LTO, codegen-units 1, panic=abort
- **Edition 2024** — Requires Rust 1.75+

## Testing

```bash
# Rust tests
cargo test --workspace

# TypeScript tests
cd packages/ai && bun test
cd packages/agent && bun test

# Integration tests (wiremock)
cargo test -p spectra-http
```

## Building from Source

```bash
# Clone
git clone https://github.com/codex-mohan/spectra.git
cd spectra

# Build Rust
cargo build --release

# Build TypeScript SDKs
cd packages/ai && bun install && bun run build
cd packages/agent && bun install && bun run build
```

---

If you found this helpful, please consider giving it a star.