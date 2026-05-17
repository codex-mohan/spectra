# Rust Providers

The `LlmClient` trait defines how to communicate with an LLM provider. `spectra-http` provides implementations for OpenAI and Anthropic.

## Built-in Clients

### OpenAI

```rust
use spectra_http::OpenAIClient;

// From environment variable (OPENAI_API_KEY)
let client = OpenAIClient::from_env()?;

// With explicit key
let client = OpenAIClient::new(api_key)?;
```

### Anthropic

```rust
use spectra_http::AnthropicClient;

// From environment variable (ANTHROPIC_API_KEY)
let client = AnthropicClient::from_env()?;

// With explicit key
let client = AnthropicClient::new(api_key)?;
```

## LlmClient Trait

```rust
#[async_trait]
pub trait LlmClient: Send + Sync + 'static {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse, SpectraError>;
    async fn stream(&self, req: LlmRequest) -> Result<LlmStream, SpectraError>;
}
```

### Implementing a Custom Client

```rust
use async_trait::async_trait;
use spectra_rs::{LlmClient, LlmRequest, LlmResponse, LlmStream, SpectraError};

pub struct MyClient {
    api_key: String,
}

#[async_trait]
impl LlmClient for MyClient {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse, SpectraError> {
        // Implement non-streaming completion
        todo!()
    }

    async fn stream(&self, req: LlmRequest) -> Result<LlmStream, SpectraError> {
        // Implement streaming via SSE
        todo!()
    }
}
```

## SSE Streaming

The HTTP clients parse SSE streams manually (no SDK wrappers):

```rust
// Internally, the client does something like:
let response = reqwest::Client::new()
    .post(&self.base_url)
    .header("Authorization", format!("Bearer {}", self.api_key))
    .json(&request_body)
    .send()
    .await?;

let mut stream = response.bytes_stream();
while let Some(chunk) = stream.next().await {
    // Parse SSE "data: {...}" lines
    // Yield ContentDelta events
}
```

## Next Steps

- [**Agent**](/rust/agent) — Use clients with AgentBuilder
- [**Adding a Provider Guide**](/guides/adding-a-provider) — Step-by-step custom client
