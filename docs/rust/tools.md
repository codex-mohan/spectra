# Rust Tools

Tools implement the `Tool` trait, providing a JSON schema definition and async execution with context (abort signal, progress reporting).

## Implementing a Tool

```rust
use async_trait::async_trait;
use spectra_rs::{Tool, ToolDef, ToolContext, ToolResult};
use serde_json::json;

pub struct WeatherTool;

impl WeatherTool {
    const DEF: ToolDef = ToolDef {
        name: String::new("get_weather"),
        description: String::new("Get the current weather for a location"),
        parameters: json!({
            "type": "object",
            "properties": {
                "location": { "type": "string", "description": "City name" },
                "unit": { "type": "string", "enum": ["celsius", "fahrenheit"] }
            },
            "required": ["location"]
        }),
    };
}

#[async_trait]
impl Tool for WeatherTool {
    fn definition(&self) -> &ToolDef {
        &Self::DEF
    }

    async fn execute(&self, ctx: ToolContext) -> Result<ToolResult> {
        let location = ctx.params["location"].as_str().unwrap_or("Unknown");
        let unit = ctx.params["unit"].as_str().unwrap_or("celsius");

        if ctx.is_aborted() {
            return Ok(ToolResult::error("aborted"));
        }

        // Report progress
        ctx.report_progress(ToolResult::success(json!({"status": "fetching..."})));

        let weather = fetch_weather(location, unit).await?;
        Ok(ToolResult::success(json!({ "temperature": weather.temp, "unit": unit })))
    }
}
```

## Using ToolBuilder

For simple tools, use `ToolBuilder` instead of implementing the trait:

```rust
use spectra_rs::ToolBuilder;
use serde_json::json;

let search_tool = ToolBuilder::new("search")
    .description("Search the web")
    .parameters(json!({
        "type": "object",
        "properties": {
            "query": { "type": "string" }
        },
        "required": ["query"]
    }))
    .execute(|ctx| async move {
        let query = ctx.params["query"].as_str().unwrap_or("");
        let results = search(query).await?;
        Ok(ToolResult::success(json!({ "results": results })))
    })
    .build();
```

## Registering Tools

```rust
use std::sync::Arc;

let agent = AgentBuilder::new(Model::openai("gpt-4o"))
    .register_tool(Arc::new(WeatherTool))
    .register_tool(search_tool) // Arc<dyn Tool> from ToolBuilder
    .build(client);
```

Or share a registry across agents:

```rust
let registry = Arc::new(ToolRegistry::new());
registry.register(Arc::new(WeatherTool));

let agent = AgentBuilder::new(Model::openai("gpt-4o"))
    .tools(registry.clone())
    .build(client);
```

## ToolResult

```rust
// Success result
ToolResult::success(json!({ "temperature": 22, "unit": "celsius" }))

// Error result
ToolResult::error("Failed to fetch weather data")
```

## ToolRegistry

Tools are stored in a `ToolRegistry` (backed by `DashMap` for concurrent access):

```rust
use spectra_rs::ToolRegistry;

let registry = ToolRegistry::new();
registry.register(Arc::new(WeatherTool));
registry.register(Arc::new(SearchTool));

let tool = registry.get("get_weather");
let all_defs = registry.definitions();
```

## Next Steps

- [**Agent**](/rust/agent) — How tools integrate with the agent loop
- [**Extensions**](/rust/extensions) — Intercept tool calls with middleware
