# Rust SDK Guide

The Rust SDK (`spectra-rs` and `spectra-http`) provides a minimal, ultra-fast agent loop built on Tokio. It mirrors the TypeScript SDK's pattern (events, tools, hooks) but is implemented as a standalone, native Rust library without bindings.

## Installation

Add the core crate and the HTTP clients to your `Cargo.toml`:

```toml
[dependencies]
spectra-rs = "0.2"
spectra-http = "0.2"
tokio = { version = "1", features = ["full"] }
```

## Basic Usage

The SDK abstracts LLM interaction behind the `LlmClient` trait. You construct an `Agent` using `AgentBuilder`, passing it your client and model details.

```rust
use spectra_rs::{AgentBuilder, Model, Provider};
use spectra_http::OpenAIClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?; // Requires OPENAI_API_KEY

    let agent = AgentBuilder::new()
        .model(Model::openai("gpt-4o"))
        .system_prompt("You are a helpful assistant.")
        .build(client);

    // .prompt() returns an event stream
    let mut stream = agent.prompt("What is 2+2?").await?;

    while let Some(event) = stream.next().await {
        // Handle events like message deltas, tool calls, etc.
        println!("{:?}", event?);
    }

    Ok(())
}
```

## Defining Tools

Tools in Rust implement the `Tool` trait, providing a JSON schema definition and an async execution method.

```rust
use async_trait::async_trait;
use spectra_rs::{Tool, ToolResult, TextContent};
use serde_json::json;

pub struct WeatherTool;

#[async_trait]
impl Tool for WeatherTool {
    fn name(&self) -> &str {
        "get_weather"
    }

    fn description(&self) -> &str {
        "Get the current weather for a location"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "location": { "type": "string" }
            },
            "required": ["location"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult, Box<dyn std::error::Error + Send + Sync>> {
        let location = args["location"].as_str().unwrap_or("Unknown");
        Ok(ToolResult::text(format!("The weather in {} is sunny.", location)))
    }
}
```

To register the tool:

```rust
let agent = AgentBuilder::new()
    .model(Model::openai("gpt-4o"))
    .tool(WeatherTool)
    .build(client);
```

## Streaming Events

The stream returned by `agent.prompt()` yields `StreamEvent` enums, which allow you to observe token deltas, tool executions, and state changes.

```rust
use spectra_rs::{StreamEvent, ContentDelta};

while let Some(Ok(event)) = stream.next().await {
    match event {
        StreamEvent::TurnStart => println!("-- Turn started --"),
        StreamEvent::ContentDelta(ContentDelta::Text(delta)) => print!("{}", delta),
        StreamEvent::ContentDelta(ContentDelta::ToolCall(name, args)) => {
            println!("\nCalling tool {} with {}", name, args);
        }
        StreamEvent::TurnEnd { message, .. } => println!("\n-- Turn ended --"),
        _ => {}
    }
}
```

## Extensions (Hooks)

The `Extension` trait allows you to inject middleware that runs before/after tool calls or agent operations.

```rust
use async_trait::async_trait;
use spectra_rs::{Extension, BeforeToolCallContext, AfterToolCallContext};

pub struct LoggingExtension;

#[async_trait]
impl Extension for LoggingExtension {
    async fn on_before_tool_call(&self, ctx: &mut BeforeToolCallContext) -> Result<(), spectra_rs::SpectraError> {
        println!("Intercepted tool call: {}", ctx.tool_call.name);
        Ok(())
    }
}
```

Register extensions via the builder:
```rust
let agent = AgentBuilder::new()
    .model(Model::anthropic("claude-3-haiku-20240307"))
    .extension(LoggingExtension)
    .build(client);
```

## Architecture Notes

- **Zero Unsafe:** The Rust SDK strictly adheres to `#![forbid(unsafe_code)]`.
- **Performance:** Designed to run inside standard Tokio tasks.
- **Traits:** `LlmClient` allows easy integration of custom providers beyond the officially supported ones.
