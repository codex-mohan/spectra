# Rust Getting Started

## Prerequisites

- Rust 1.75+ (install via [rustup](https://rustup.rs/))
- Cargo (included with rustup)

## Installation

Add the core crate and HTTP clients to your `Cargo.toml`:

```bash
cargo add spectra-rs spectra-http
cargo add tokio --features full
```

Or manually:

```toml
[dependencies]
spectra-rs = "0.2"
spectra-http = "0.2"
tokio = { version = "1", features = ["full"] }
```

## Environment Variables

```bash
# For OpenAI
export OPENAI_API_KEY="sk-..."

# For Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Basic Usage

```rust
use spectra_rs::{AgentBuilder, Model};
use spectra_http::OpenAIClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?;

    let agent = AgentBuilder::new()
        .model(Model::openai("gpt-4o"))
        .system_prompt("You are a helpful assistant.")
        .build(client);

    let mut stream = agent.prompt("What is 2+2?").await?;

    while let Some(Ok(event)) = stream.next().await {
        println!("{:?}", event);
    }

    Ok(())
}
```

## Model Configuration

```rust
// OpenAI
Model::openai("gpt-4o")
Model::openai("gpt-4o-mini")

// Anthropic
Model::anthropic("claude-sonnet-4-20250514")
Model::anthropic("claude-3-5-sonnet-20241022")
```

## Client Creation

```rust
// From environment variables
let client = OpenAIClient::from_env()?;
let client = AnthropicClient::from_env()?;

// With explicit API key
let client = OpenAIClient::new(api_key)?;
let client = AnthropicClient::new(api_key)?;
```

## Next Steps

- [**Agent**](/rust/agent) — AgentBuilder, prompt(), event stream
- [**Tools**](/rust/tools) — Tool trait, ToolRegistry
- [**Providers**](/rust/providers) — LlmClient trait, custom clients
