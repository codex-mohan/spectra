# Rust Tools

Tools implement the `Tool` trait, providing a JSON schema definition and async execution.

## Implementing a Tool

```rust
use async_trait::async_trait;
use spectra_rs::{Tool, ToolResult};
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
                "location": { "type": "string", "description": "City name" },
                "unit": { "type": "string", "enum": ["celsius", "fahrenheit"], "default": "celsius" }
            },
            "required": ["location"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult, Box<dyn std::error::Error + Send + Sync>> {
        let location = args["location"].as_str().unwrap_or("Unknown");
        let unit = args["unit"].as_str().unwrap_or("celsius");
        let weather = fetch_weather(location, unit).await?;
        Ok(ToolResult::text(format!("The weather in {} is {}°{}", location, weather.temp, unit)))
    }
}
```

## Registering Tools

```rust
let agent = AgentBuilder::new()
    .model(Model::openai("gpt-4o"))
    .tool(WeatherTool)
    .tool(SearchTool)
    .build(client);
```

## ToolResult

```rust
// Simple text result
ToolResult::text("The answer is 42")

// With error flag
ToolResult {
    content: vec![Content::text("Failed to fetch data")],
    is_error: true,
}
```

## ToolRegistry

Tools are stored in a `ToolRegistry` (backed by `DashMap` for concurrent access):

```rust
use spectra_rs::ToolRegistry;

let registry = ToolRegistry::new();
registry.register(WeatherTool);
registry.register(SearchTool);

let tool = registry.get("get_weather");
```

## Next Steps

- [**Agent**](/rust/agent) — How tools integrate with the agent loop
- [**Extensions**](/rust/extensions) — Intercept tool calls with middleware
