# LlmClient Reference

Trait defining how to communicate with an LLM provider.

## Trait Definition

```rust
#[async_trait]
pub trait LlmClient: Send + Sync + 'static {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse, SpectraError>;
    async fn stream(&self, req: LlmRequest) -> Result<LlmStream, SpectraError>;
}
```

## LlmRequest

```rust
pub struct LlmRequest {
    pub messages: Vec<Message>,
    pub model: Model,
    pub tools: Vec<ToolDefinition>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f64>,
    pub system_prompt: Option<String>,
}
```

## LlmResponse

```rust
pub struct LlmResponse {
    pub message: AssistantMessage,
    pub usage: Option<Usage>,
    pub stop_reason: StopReason,
}
```

## LlmStream

```rust
pub type LlmStream = Pin<Box<dyn Stream<Item = Result<StreamEvent, SpectraError>> + Send>>;
```

## Implementations

| Crate | Type | Provider |
|---|---|---|
| `spectra-http` | `OpenAIClient` | OpenAI Chat Completions |
| `spectra-http` | `AnthropicClient` | Anthropic Messages API |

## Related

- [Rust Providers Guide](/rust/providers) — Built-in clients
- [Adding a Provider Guide](/guides/adding-a-provider) — Custom implementation
