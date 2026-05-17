# Rust SDK Overview

The Rust SDK (`spectra-rs` + `spectra-http`) provides a minimal, ultra-fast agent loop built on Tokio.

## Crates

| Crate | Purpose | Install |
|---|---|---|
| `spectra-rs` | Core types, Agent, LlmClient trait, Tool trait, Extension trait | `cargo add spectra-rs` |
| `spectra-http` | HTTP clients — AnthropicClient, OpenAIClient with SSE streaming | `cargo add spectra-http` |

## Architecture

```
User → Agent::prompt(input)
  → LlmClient::stream(LlmRequest)
    → SSE parse → LlmStreamEvent::ContentDelta
  → apply_delta() → accumulate AssistantMessage
  → if ToolCalls → dispatch_tool() → ToolRegistry::dispatch()
  → emit StreamEvent via mpsc + EventChannel (broadcast)
  → repeat until end-of-turn
```

## Core Traits

### LlmClient

Defines how to communicate with an LLM provider:

```rust
#[async_trait]
pub trait LlmClient: Send + Sync + 'static {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse, SpectraError>;
    async fn stream(&self, req: LlmRequest) -> Result<LlmStream, SpectraError>;
}
```

`spectra-http` provides implementations for OpenAI and Anthropic.

### Tool

Defines a capability the agent can use:

```rust
#[async_trait]
pub trait Tool: Send + Sync + 'static {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> serde_json::Value; // JSON Schema
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult, Box<dyn std::error::Error + Send + Sync>>;
}
```

### Extension

Provides middleware hooks:

```rust
#[async_trait]
pub trait Extension: Send + Sync + 'static {
    async fn on_agent_start(&self, ctx: &mut AgentContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_before_tool_call(&self, ctx: &mut BeforeToolCallContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_after_tool_call(&self, ctx: &mut AfterToolCallContext) -> Result<(), SpectraError> { Ok(()) }
}
```

## Key Types

| Type | Purpose |
|---|---|
| `Agent` | The agent instance (built via `AgentBuilder`) |
| `AgentBuilder` | Fluent builder for configuring agents |
| `Model` | Model configuration (`Model::openai("gpt-4o")`) |
| `Message` | Enum: `UserMessage`, `AssistantMessage`, `ToolResultMessage` |
| `StreamEvent` | Events emitted during agent execution |
| `ContentDelta` | Streaming deltas: `Text(String)`, `ToolCall(name, args)` |
| `SpectraError` | Error enum with `thiserror` + `miette` diagnostics |

## Design Principles

- **Zero unsafe**: `#![forbid(unsafe_code)]` in core logic
- **No OpenSSL**: `rustls` only
- **Performance**: opt-level 3, thin LTO, codegen-units 1, strip symbols, panic=abort in release
- **Minimal deps**: tokio, reqwest, serde, thiserror, miette

## Next Steps

- [**Getting Started**](/rust/getting-started) — Installation, Cargo setup, env vars
- [**Agent**](/rust/agent) — AgentBuilder, prompt(), event stream
- [**Tools**](/rust/tools) — Tool trait, ToolRegistry
