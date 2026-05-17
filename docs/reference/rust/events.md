# Events Reference (Rust)

Events emitted during agent execution.

## StreamEvent Enum

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

## ContentDelta Enum

```rust
pub enum ContentDelta {
    Text(String),              // Streaming text token
    ToolCall(String, String),  // Tool name, partial JSON args
}
```

## EventChannel

Broadcast channel for multiple subscribers:

```rust
pub struct EventChannel {
    // Backed by tokio::sync::broadcast
}

impl EventChannel {
    pub fn new(capacity: usize) -> Self;
    pub fn subscribe(&self) -> BroadcastReceiver<StreamEvent>;
    pub fn send(&self, event: StreamEvent) -> Result<(), SpectraError>;
}
```

## Related

- [Rust Events Guide](/rust/events) — Usage examples
- [Event System Concepts](/concepts/event-system) — Patterns
