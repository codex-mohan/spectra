# Rust API Reference

The Rust SDK (`spectra-rs`) provides the core types and traits for building agents. It strictly adheres to `#[forbid(unsafe_code)]` and uses trait-based abstraction for LLMs and Tools.

## AgentBuilder

```rust
pub struct AgentBuilder<L> { /* ... */ }

impl AgentBuilder<()> {
    pub fn new() -> Self;
}

impl<L> AgentBuilder<L> {
    pub fn model(self, model: Model) -> Self;
    pub fn system_prompt(self, prompt: impl Into<String>) -> Self;
    pub fn tool<T: Tool + 'static>(self, tool: T) -> Self;
    pub fn extension<E: Extension + 'static>(self, ext: E) -> Self;
    pub fn build(self, client: L) -> Agent<L> where L: LlmClient;
}
```

## Core Traits

### `LlmClient`

Defines how to communicate with an LLM provider. The `spectra-http` crate provides implementations for OpenAI, Anthropic, etc.

```rust
#[async_trait]
pub trait LlmClient: Send + Sync + 'static {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse, SpectraError>;
    async fn stream(&self, req: LlmRequest) -> Result<LlmStream, SpectraError>;
}
```

### `Tool`

Defines a capability the agent can use.

```rust
#[async_trait]
pub trait Tool: Send + Sync + 'static {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> serde_json::Value; // JSON Schema
    
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult, Box<dyn std::error::Error + Send + Sync>>;
}
```

### `Extension`

Provides middleware hooks for the agent lifecycle.

```rust
#[async_trait]
pub trait Extension: Send + Sync + 'static {
    async fn on_agent_start(&self, ctx: &mut AgentContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_before_tool_call(&self, ctx: &mut BeforeToolCallContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_after_tool_call(&self, ctx: &mut AfterToolCallContext) -> Result<(), SpectraError> { Ok(()) }
}
```

## Key Types

### `Model`

```rust
pub struct Model {
    pub provider: Provider,
    pub name: String,
    pub api_type: Option<String>,
}

impl Model {
    pub fn openai(name: &str) -> Self;
    pub fn anthropic(name: &str) -> Self;
}
```

### `StreamEvent`

The events emitted by the agent stream.

```rust
pub enum StreamEvent {
    TurnStart,
    ContentDelta(ContentDelta),
    TurnEnd {
        message: AssistantMessage,
        tool_results: Vec<ToolResultMessage>,
    },
    Error(SpectraError),
}

pub enum ContentDelta {
    Text(String),
    ToolCall(String, String), // Name, partial JSON args
}
```

### `SpectraError`

The standard error enum using `thiserror` and `miette`.

```rust
#[derive(Debug, thiserror::Error, miette::Diagnostic)]
pub enum SpectraError {
    #[error("API error: {0}")]
    ApiError(String),
    
    #[error("Tool execution failed: {0}")]
    ToolError(String),
    
    // ...
}
```

[Full Rust documentation is available via rustdoc](https://docs.rs/spectra-rs)
