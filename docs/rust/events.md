# Rust Events

The agent emits `StreamEvent` variants through an `mpsc::channel` and `EventChannel` (broadcast).

## StreamEvent Variants

```rust
pub enum StreamEvent {
    AgentStart,
    TurnStart,
    MessageStart { message: Message },
    MessageUpdate { delta: ContentDelta },
    MessageEnd { message: Message },
    TurnEnd { tool_results: Vec<ToolResultMessage> },
    ToolExecutionStart { tool_call: ToolCall },
    ToolExecutionUpdate { partial: serde_json::Value },
    ToolExecutionEnd { result: ToolResultMessage, is_error: bool },
    AgentEnd { messages: Vec<AssistantMessage> },
    Error { message: String },
}
```

## ContentDelta

```rust
pub enum ContentDelta {
    Text { delta: String },                                // Streaming text token
    Thinking { delta: String, signature: Option<String> }, // Thinking block delta
    ToolCallStart { id: String, name: String },            // Tool call started
    ToolCallDelta { id: String, args_delta: String },      // Partial tool args
    ToolCallEnd { id: String },                            // Tool call complete
}
```

## Handling Events

```rust
use spectra_rs::{StreamEvent, ContentDelta};

while let Some(Ok(event)) = stream.next().await {
    match event {
        StreamEvent::TurnStart => println!("-- Turn started --"),
        StreamEvent::MessageUpdate { delta } => match delta {
            ContentDelta::Text { delta: text } => print!("{}", text),
            ContentDelta::Thinking { delta, .. } => print!("\n[thinking] {}[/thinking]", delta),
            ContentDelta::ToolCallStart { name, .. } => print!("\n[Tool] {} starting", name),
            ContentDelta::ToolCallDelta { args_delta, .. } => print!("{}", args_delta),
            _ => {}
        },
        StreamEvent::ToolExecutionStart { tool_call } => {
            println!("\n[Tool] {} executing", tool_call.name);
        }
        StreamEvent::ToolExecutionEnd { result, is_error } => {
            println!("\n[Tool] {} ({})", if is_error { "error" } else { "ok" }, result.tool_name);
        }
        StreamEvent::TurnEnd { .. } => println!("\n-- Turn ended --"),
        StreamEvent::Error { message } => eprintln!("Error: {}", message),
        _ => {}
    }
}
```

## EventChannel (Broadcast)

For multiple subscribers, use the broadcast `EventChannel`:

```rust
use spectra_rs::EventChannel;

let (tx, mut rx) = tokio::sync::mpsc::channel(256);
let broadcast = EventChannel::new();

// Subscribe
let mut subscriber = broadcast.subscribe();
```

## Event Flow

```
AgentStart
  TurnStart
    MessageStart
      MessageUpdate × N (streaming deltas)
    MessageEnd
    [ToolExecutionStart → ToolExecutionUpdate × N → ToolExecutionEnd] × M
  TurnEnd
  [TurnStart → … → TurnEnd] (repeat if more turns)
AgentEnd { messages }
```

## Next Steps

- [**Agent**](/rust/agent) — How events relate to the agent lifecycle
- [**Concepts: Event System**](/concepts/event-system) — Broadcast vs channel patterns
