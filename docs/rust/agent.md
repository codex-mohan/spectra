# Rust Agent

The `Agent` is built via `AgentBuilder` with a fluent API.

## Building an Agent

```rust
use spectra_rs::{AgentBuilder, Model};
use spectra_http::OpenAIClient;

let client = OpenAIClient::from_env()?;

let agent = AgentBuilder::new()
    .model(Model::openai("gpt-4o"))
    .system_prompt("You are a helpful assistant.")
    .max_turns(10)
    .tool(WeatherTool)
    .extension(LoggingExtension)
    .build(client);
```

### AgentBuilder Methods

| Method | Description |
|---|---|
| `model(Model)` | Set the LLM model |
| `system_prompt(&str)` | Set the system prompt |
| `max_turns(u32)` | Maximum LLM turns (default: unlimited) |
| `tool(T: Tool)` | Register a tool |
| `extension(E: Extension)` | Register a middleware extension |
| `build(client: L)` | Build the agent with an LlmClient |

## Prompting

```rust
let mut stream = agent.prompt("What is the weather in Tokyo?").await?;

while let Some(Ok(event)) = stream.next().await {
    match event {
        StreamEvent::ContentDelta(ContentDelta::Text(delta)) => print!("{}", delta),
        StreamEvent::ContentDelta(ContentDelta::ToolCall(name, args)) => {
            println!("\nCalling tool {} with {}", name, args);
        }
        StreamEvent::TurnEnd { message, .. } => println!("\nTurn complete"),
        _ => {}
    }
}
```

## Event Stream

The `prompt()` method returns a stream of `StreamEvent`:

```rust
use spectra_rs::{StreamEvent, ContentDelta};

while let Some(Ok(event)) = stream.next().await {
    match event {
        StreamEvent::TurnStart => println!("-- Turn started --"),
        StreamEvent::ContentDelta(ContentDelta::Text(delta)) => print!("{}", delta),
        StreamEvent::ContentDelta(ContentDelta::ToolCall(name, args)) => {
            println!("\nCalling tool {} with {}", name, args);
        }
        StreamEvent::TurnEnd { message, tool_results } => {
            println!("\n-- Turn ended --");
        }
        StreamEvent::Error(err) => eprintln!("Error: {}", err),
    }
}
```

## Multi-Turn Conversations

The agent automatically loops until the LLM stops calling tools or `max_turns` is reached:

```
Turn 1: User asks → LLM calls tool → Agent executes → feeds result back
Turn 2: LLM receives result → calls another tool → Agent executes
Turn 3: LLM receives result → responds with text → Agent yields answer
```

## Error Handling

Spectra uses `thiserror` + `miette` for human-readable errors:

```rust
match agent.prompt("Hello").await {
    Ok(stream) => { /* handle stream */ }
    Err(SpectraError::ApiError(msg)) => eprintln!("API error: {}", msg),
    Err(SpectraError::ToolError(msg)) => eprintln!("Tool error: {}", msg),
    Err(err) => eprintln!("Error: {:?}", err),
}
```

## Next Steps

- [**Tools**](/rust/tools) — Implement the Tool trait
- [**Extensions**](/rust/extensions) — Middleware hooks
- [**Events**](/rust/events) — StreamEvent variants
