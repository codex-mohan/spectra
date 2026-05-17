# Rust Events

The agent emits `StreamEvent` variants through an `mpsc::channel` and `EventChannel` (broadcast).

## StreamEvent Variants

```rust
pub enum StreamEvent {
    TurnStart,
    ContentDelta(ContentDelta),
    ToolCallStart { name: String, args: String },
    ToolCallEnd { name: String, result: ToolResult },
    TurnEnd {
        message: AssistantMessage,
        tool_results: Vec<ToolResultMessage>,
    },
    Error(SpectraError),
}
```

## ContentDelta

```rust
pub enum ContentDelta {
    Text(String),              // Streaming text token
    ToolCall(String, String),  // Tool name, partial JSON args
}
```

## Handling Events

```rust
use spectra_rs::{StreamEvent, ContentDelta};

while let Some(Ok(event)) = stream.next().await {
    match event {
        StreamEvent::TurnStart => println!("-- Turn started --"),
        StreamEvent::ContentDelta(ContentDelta::Text(delta)) => print!("{}", delta),
        StreamEvent::ContentDelta(ContentDelta::ToolCall(name, args)) => {
            println!("\nCalling tool {} with {}", name, args);
        }
        StreamEvent::ToolCallStart { name, .. } => {
            println!("\n[Tool] {} starting", name);
        }
        StreamEvent::ToolCallEnd { name, result, .. } => {
            println!("\n[Tool] {} complete", name);
        }
        StreamEvent::TurnEnd { message, .. } => {
            println!("\n-- Turn ended --");
        }
        StreamEvent::Error(err) => eprintln!("Error: {}", err),
    }
}
```

## EventChannel (Broadcast)

For multiple subscribers, use the broadcast `EventChannel`:

```rust
use spectra_rs::EventChannel;

let (tx, mut rx) = tokio::sync::mpsc::channel(32);
let broadcast = EventChannel::new(16);

// Subscribe
let mut subscriber = broadcast.subscribe();

// In the agent loop, events are sent to both:
// - mpsc channel for the primary stream consumer
// - broadcast channel for additional subscribers
```

## Event Flow

```
TurnStart
  ContentDelta(Text) × N  (streaming tokens)
  ContentDelta(ToolCall) × M  (tool call detection)
  ToolCallStart
  ToolCallEnd
TurnEnd { message, tool_results }
```

## Next Steps

- [**Agent**](/rust/agent) — How events relate to the agent lifecycle
- [**Concepts: Event System**](/concepts/event-system) — Broadcast vs channel patterns
