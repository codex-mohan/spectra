# LlmClient Reference

Trait defining how to communicate with an LLM provider.

## Trait Definition

```rust
#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse>;
    async fn stream(&self, request: LlmRequest) -> Result<LlmStream>;
    fn provider(&self) -> Provider;
}
```

## LlmRequest

```rust
pub struct LlmRequest {
    pub model: Model,
    pub system_prompt: Option<String>,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolDef>,
    pub tool_choice: Option<ToolChoice>,
    pub reasoning_effort: Option<ReasoningEffort>,
}

impl LlmRequest {
    pub fn new(model: Model) -> Self;
}
```

Note: `max_tokens` and `temperature` are configured via `Model.config` (a `ModelConfig` field), not directly on the request.

## LlmResponse

```rust
pub struct LlmResponse {
    pub message: AssistantMessage,
    pub usage: TokenUsage,
    pub stop_reason: StopReason,
}
```

## LlmStream

```rust
pub type LlmStream = Pin<Box<dyn Stream<Item = Result<LlmStreamEvent>> + Send>>;
```

## LlmStreamEvent

```rust
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LlmStreamEvent {
    Start { partial: AssistantMessage },
    ContentDelta { delta: ContentDelta },
    Done { message: AssistantMessage },
    Error { message: String },
}
```

## Supporting Types

### ToolChoice

```rust
pub enum ToolChoice {
    Auto,
    None,
    Required,
    Specific { name: String },
}
```

### ReasoningEffort

```rust
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
}
```

### ToolDef (LLM-facing)

```rust
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value, // JSON Schema
}
```

## Implementations

| Crate | Type | Provider |
|---|---|---|
| `spectra-http` | `OpenAIClient` | OpenAI Chat Completions |
| `spectra-http` | `AnthropicClient` | Anthropic Messages API |

## Related

- [Rust Providers Guide](/rust/providers) — Built-in clients
- [Adding a Provider Guide](/guides/adding-a-provider) — Custom implementation
