# Rust API

The Rust SDK provides the same agent loop pattern as TypeScript with trait-based abstraction.

## Quick Example

```rust
use spectra_rs::{Agent, AgentBuilder, Model};
use spectra_http::OpenAIClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?;
    let agent = AgentBuilder::new()
        .model(Model::openai("gpt-4o"))
        .build(client);

    let mut stream = agent.prompt("Hello!").await?;
    while let Some(event) = stream.next().await {
        println!("{:?}", event?);
    }
    Ok(())
}
```

## Core Traits

- `LlmClient` — LLM provider abstraction
- `Tool` — Tool definition and execution
- `Extension` — Lifecycle hooks

[Full Rust documentation](https://docs.rs/spectra-rs)
