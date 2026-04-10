<div align="center">
  <h1>Spectra</h1>
  <p><b>Minimal, ultra-fast, multi-language AI agent framework with a Rust core</b></p>

  <p>
    <img src="https://img.shields.io/badge/RUST-0.2.0-000000?style=for-the-badge&logo=rust&logoColor=white&labelColor=0D0D0D" alt="Rust">
    <img src="https://img.shields.io/badge/TYPESCRIPT-0.2.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=0D0D0D" alt="TypeScript">
    <img src="https://img.shields.io/badge/PYTHON-0.2.0-3776AB?style=for-the-badge&logo=python&logoColor=white&labelColor=0D0D0D" alt="Python">
    <br />
    <img src="https://img.shields.io/badge/LICENSE-MIT-00B140?style=for-the-badge&labelColor=0D0D0D" alt="MIT License">
    <img src="https://img.shields.io/badge/STATUS-V0.2.0-FE7D37?style=for-the-badge&labelColor=0D0D0D" alt="Status">
  </p>
</div>

---

A construction kit, not a pre-built house — ship only primitives that enable developers to build anything beyond the core without fighting the framework.

All SDKs (Rust, TypeScript, Python) are thin bindings over the same Rust core with **identical behavior across languages**.

## ✨ Key Features

- **Rust Core** — Zero-cost abstractions, memory safety, native performance. No unsafe in core logic (FFI boundaries only).
- **Streaming-First** — All LLM providers stream SSE by default. Event-driven architecture with real-time updates.
- **Multi-Language SDKs** — Rust, TypeScript (via napi-rs), Python (via PyO3). Same API surface, same behavior.
- **Provider Abstraction** — Single `LlmClient` trait. Built-in Anthropic, OpenAI, OpenRouter, Groq support.
- **Tool System** — Trait-based with concurrent dispatch. Fluent `ToolBuilder` for ergonomic construction.
- **Agent Loop** — Multi-turn with automatic tool dispatch, delta accumulation, and event streaming.
- **Extension Hooks** — Before/after tool calls, agent/turn lifecycle. Composable middleware pattern.
- **No OpenSSL** — Pure Rust TLS via rustls. No C dependencies.
- **Typed Errors** — miette diagnostics with helpful messages across all error variants.

## 🛠️ Technology Stack

| Component | Technologies |
|-----------|-------------|
| **Core** | ![Rust](https://img.shields.io/badge/Rust-1.85+-000000?style=flat-square&logo=rust&logoColor=white) ![Tokio](https://img.shields.io/badge/Tokio-1.x-000000?style=flat-square&logoColor=white) |
| **HTTP** | ![Reqwest](https://img.shields.io/badge/Reqwest-0.12-000000?style=flat-square&logoColor=white) rustls · SSE streaming |
| **TypeScript** | ![napi-rs](https://img.shields.io/badge/napi--rs-3.x-3178C6?style=flat-square&logoColor=white) ![Zod](https://img.shields.io/badge/Zod-3.x-3068B7?style=flat-square&logoColor=white) |
| **Python** | ![PyO3](https://img.shields.io/badge/PyO3-0.24-3776AB?style=flat-square&logoColor=white) ![Pydantic](https://img.shields.io/badge/Pydantic-2.x-E92063?style=flat-square&logoColor=white) maturin |
| **Tooling** | ![Turborepo](https://img.shields.io/badge/Turborepo-latest-EF4444?style=flat-square&logoColor=white) pnpm · cargo-nextest |

## 🏗️ Project Structure

```
spectra/
├── packages/
│   └── core/                  # spectra-core — Rust core library
│       ├── src/agent.rs       # Agent orchestrator (multi-turn loop)
│       ├── src/llm.rs         # LlmClient trait, Model, Provider
│       ├── src/tool.rs        # Tool trait, ToolRegistry, ToolBuilder
│       ├── src/event.rs       # StreamEvent, ContentDelta, EventChannel
│       ├── src/messages.rs    # Message types (User/Assistant/ToolResult)
│       └── src/error.rs       # SpectraError with miette diagnostics
├── crates/
│   ├── spectra-http/          # HTTP LLM provider clients
│   │   ├── src/anthropic.rs   # Anthropic Messages API + SSE streaming
│   │   └── src/openai.rs      # OpenAI Chat Completions + SSE streaming
│   ├── spectra-rs/            # Rust SDK (re-exports + builder)
│   │   ├── src/extension.rs   # Extension hooks (before/after lifecycle)
│   │   └── models.toml        # Built-in model definitions
│   ├── spectra-napi/          # TypeScript bindings (napi-rs)
│   └── spectra-pyo3/          # Python bindings (PyO3)
├── packages/
│   ├── spectra-ts/            # TypeScript SDK
│   └── spectra-py/            # Python SDK
└── .github/workflows/        # CI/CD (Rust, TS, Python, Release)
```

## 🏁 Getting Started

### Prerequisites

- **Rust** 1.85+ (edition 2024)
- **Node.js** 18+ and **pnpm** 9+ (for TypeScript SDK)
- **Python** 3.11+ (for Python SDK)

### Rust

```toml
[dependencies]
spectra-rs = "0.2"
```

```rust
use spectra_rs::prelude::*;
use spectra_http::OpenAIClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?;

    let agent = AgentBuilder::new()
        .model(Model::openai("gpt-4o"))
        .system_prompt("You are a helpful assistant.")
        .build(client);

    let (mut rx, _channel) = agent.run("Hello!".to_string()).await?;

    while let Some(event) = rx.recv().await {
        println!("{:?}", event?);
    }

    Ok(())
}
```

### TypeScript

```bash
pnpm add @spectra/sdk
```

```typescript
import { Agent, anthropic, defineTool } from "@spectra/sdk";
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
  if (event.type === "message_update") {
    process.stdout.write(event.delta.delta ?? "");
  }
}
```

### Python

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

## 🔌 Supported Providers

| Provider | Class / Model | Streaming | Tool Use | Custom Base URL |
|----------|---------------|-----------|----------|-----------------|
| **Anthropic** | `AnthropicClient` | ✅ SSE | ✅ | ✅ |
| **OpenAI** | `OpenAIClient` | ✅ SSE | ✅ Function calling | ✅ |
| **OpenRouter** | `OpenAIClient` | ✅ SSE | ✅ | ✅ (default) |
| **Groq** | `OpenAIClient` | ✅ SSE | ✅ | ✅ |
| **Custom** | Implement `LlmClient` | ✅ | ✅ | — |

## 🎯 Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  TypeScript  │  │   Python    │  │    Rust     │
│  @spectra/sdk│  │ spectra-sdk│  │ spectra-rs  │
└──────┬───────┘  └──────┬──────┘  └──────┬──────┘
       │ napi-rs          │ PyO3           │ native
       └──────────┬───────┴────────────────┘
                  │
         ┌────────┴────────┐
         │  spectra-core   │  Agent · LlmClient · Tool · Event
         └────────┬────────┘
                  │
         ┌────────┴────────┐
         │  spectra-http   │  AnthropicClient · OpenAIClient
         └─────────────────┘
```

Every SDK is a thin binding over the same Rust core. The `Agent` loop, `Tool` dispatch, `StreamEvent` emission, and error handling are identical regardless of language.

## 📖 API Surface

### Core Traits

| Trait | Purpose |
|-------|---------|
| `LlmClient` | LLM provider abstraction (`complete`, `stream`) |
| `Tool` | Tool definition + execution (`definition`, `execute`) |
| `Extension` | Lifecycle hooks (`on_before_tool_call`, `on_after_tool_call`, ...) |
| `EventSink` | Event consumption |

### Agent Events

| Event | When |
|-------|------|
| `AgentStart` | Agent begins processing |
| `TurnStart` | New LLM turn begins |
| `MessageStart` | LLM response starts |
| `MessageUpdate` | Content delta (text or tool call) |
| `MessageEnd` | LLM response complete |
| `TurnEnd` | Turn complete (may include tool results) |
| `ToolExecutionStart/Update/End` | Tool dispatch lifecycle |
| `AgentEnd` | Agent processing complete |
| `Error` | Something went wrong |

## ⚠️ Constraints

- **Zero unsafe policy** — No unsafe in core logic. FFI boundaries only.
- **No OpenSSL** — rustls only. No C dependencies.
- **Release profile** — opt-level 3, thin LTO, codegen-units 1, panic=abort
- **Edition 2024** — Requires Rust 1.85+

## 🧪 Testing

```bash
# Rust tests
cargo test --workspace

# TypeScript tests
cd packages/spectra-ts && pnpm test

# Integration tests (wiremock)
cargo test -p spectra-http
```

## 📦 Building from Source

```bash
# Clone
git clone https://github.com/codex-mohan/spectra.git
cd spectra

# Build Rust core
cargo build --release

# Build TypeScript SDK
cd packages/spectra-ts
cargo build --release --package spectra-napi
pnpm install
pnpm build

# Build Python SDK
cd packages/spectra-py
maturin develop --release
```

---

<div align="center">
  <p>If you found this helpful, please consider giving it a ⭐</p>
</div>
