# Rust Agent

The `Agent` is built via `AgentBuilder` with a fluent API.

## Building an Agent

```rust
use std::sync::Arc;
use spectra_rs::{AgentBuilder, Model};
use spectra_http::OpenAIClient;

let client = Arc::new(OpenAIClient::from_env()?);

let agent = AgentBuilder::new(Model::openai("gpt-4o"))
    .system_prompt("You are a helpful assistant.")
    .register_tool(Arc::new(WeatherTool))
    .max_turns(10)
    .build(client);
```

### AgentBuilder Methods

| Method | Description |
|---|---|
| `new(Model)` | Set the LLM model (constructor parameter) |
| `system_prompt(&str)` | Set the system prompt |
| `tools(Arc<ToolRegistry>)` | Use a shared tool registry |
| `register_tool(Arc<dyn Tool>)` | Register a tool |
| `max_turns(usize)` | Maximum LLM turns (default: unlimited) |
| `tool_execution(ToolExecutionMode)` | Parallel (default) or Sequential |
| `tool_choice(ToolChoice)` | Force tool selection behavior |
| `reasoning_effort(ReasoningEffort)` | Set reasoning/thinking effort |
| `extensions(ExtensionManager)` | Register middleware extensions |
| `transform_context(f)` | Async transform messages before LLM call |
| `get_api_key(f)` | Dynamic API key resolution |
| `build(Arc<dyn LlmClient>)` | Build the agent |

## Running the Agent

```rust
let (mut rx, _channel, handle) = agent.run("What is the weather in Tokyo?").await?;

while let Some(Ok(event)) = rx.recv().await {
    match event {
        StreamEvent::MessageUpdate { delta } => match delta {
            ContentDelta::Text { delta: text } => print!("{}", text),
            _ => {}
        },
        StreamEvent::TurnEnd { .. } => println!("\nTurn complete"),
        _ => {}
    }
}
```

## Event Stream

The `run()` method returns a triple:
- `mpsc::Receiver<Result<StreamEvent>>` — primary event stream
- `EventChannel` — broadcast channel for additional subscribers
- `AgentHandle` — control handle for steer/follow-up/abort

```rust
use spectra_rs::{StreamEvent, ContentDelta};
use futures_util::StreamExt;

let (mut rx, channel, handle) = agent.run("Hello").await?;

// Primary consumer
while let Some(Ok(event)) = rx.recv().await {
    match event {
        StreamEvent::TurnStart => println!("-- Turn started --"),
        StreamEvent::MessageUpdate { delta } => match delta {
            ContentDelta::Text { delta } => print!("{}", delta),
            _ => {}
        },
        StreamEvent::TurnEnd { tool_results, .. } => {
            println!("\n-- Turn ended ({} tools executed) --", tool_results.len());
        }
        StreamEvent::Error { message } => eprintln!("Error: {}", message),
        _ => {}
    }
}
```

## Steering and Queues

The `AgentHandle` provides runtime control:

```rust
// Inject a message mid-stream (processed at next turn boundary)
handle.steer("Be more concise").await;

// Queue a follow-up after current run completes
handle.follow_up("What about X?").await;

// Abort the current run
handle.abort();
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
match agent.run("Hello").await {
    Ok((mut rx, _, _)) => { /* handle stream */ }
    Err(SpectraError::LlmError { provider, message, .. }) => {
        eprintln!("{provider} API error: {message}");
    }
    Err(SpectraError::ToolError { name, reason, .. }) => {
        eprintln!("Tool {name} failed: {reason}");
    }
    Err(err) => eprintln!("Error: {:?}", err),
}
```

## Next Steps

- [**Tools**](/rust/tools) — Implement the Tool trait
- [**Extensions**](/rust/extensions) — Middleware hooks
- [**Events**](/rust/events) — StreamEvent variants
