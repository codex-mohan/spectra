# Rust SDK Overview

The Rust SDK (`spectra-rs` + `spectra-http`) provides a minimal, ultra-fast agent loop built on Tokio.

## Crates

| Crate | Purpose | Install |
|---|---|---|
| `spectra-rs` | Core types, Agent, LlmClient trait, Tool trait, Extension trait | `cargo add spectra-rs` |
| `spectra-http` | HTTP clients — AnthropicClient, OpenAIClient with SSE streaming | `cargo add spectra-http` |

## Architecture

```
User → Agent::run(input)
  → (mpsc::Receiver, EventChannel, AgentHandle)
  → run_agent_loop()
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
pub trait LlmClient: Send + Sync {
    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse>;
    async fn stream(&self, request: LlmRequest) -> Result<LlmStream>;
    fn provider(&self) -> Provider;
}
```

`spectra-http` provides implementations for OpenAI and Anthropic.

### Tool

Defines a capability the agent can use:

```rust
#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> &ToolDef;
    async fn execute(&self, ctx: ToolContext) -> Result<ToolResult>;
}
```

Also available: `ToolBuilder` for defining tools without implementing the trait.

### Extension

Provides synchronous middleware hooks with action-based returns:

```rust
pub trait Extension: Send + Sync {
    fn on_before_tool_call(&self, tool_call: &ToolCall, ctx: &ToolContext) -> BeforeToolCallAction;
    fn on_after_tool_call(&self, tool_call: &ToolCall, ctx: &ToolContext, result: &ToolResult) -> AfterToolCallAction;
    fn on_agent_start(&self) {}
    fn on_agent_end(&self) {}
    fn on_turn_start(&self) {}
    fn on_turn_end(&self) {}
}
```

## Key Types

| Type | Purpose |
|---|---|
| `Agent` | The agent instance (built via `AgentBuilder`) |
| `AgentBuilder` | Fluent builder for configuring agents |
| `AgentHandle` | Runtime control (steer, follow-up, abort) |
| `Model` | Model configuration (`Model::openai("gpt-4o")`) |
| `Message` | Enum: `UserMessage`, `AssistantMessage`, `ToolResultMessage` |
| `StreamEvent` | 11 event variants emitted during agent execution |
| `ContentDelta` | Streaming deltas: `Text`, `Thinking`, `ToolCallStart`, `ToolCallDelta`, `ToolCallEnd` |
| `SpectraError` | Error enum with `thiserror` + `miette` diagnostics |

## Design Principles

- **Zero unsafe**: `#![forbid(unsafe_code)]` in core logic
- **No OpenSSL**: `rustls` only
- **Performance**: opt-level 3, thin LTO, codegen-units 1, strip symbols, panic=abort in release
- **Minimal deps**: tokio, reqwest, serde, thiserror, miette

## Next Steps

- [**Getting Started**](/rust/getting-started) — Installation, Cargo setup, env vars
- [**Agent**](/rust/agent) — AgentBuilder, run(), event stream
- [**Tools**](/rust/tools) — Tool trait, ToolBuilder, ToolRegistry
