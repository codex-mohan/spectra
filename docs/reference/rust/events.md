# Events Reference (Rust)

Events emitted during agent execution.

## StreamEvent Enum

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

## ContentDelta Enum

```rust
pub enum ContentDelta {
    Text { delta: String },
    Thinking { delta: String, signature: Option<String> },
    ToolCallStart { id: String, name: String },
    ToolCallDelta { id: String, args_delta: String },
    ToolCallEnd { id: String },
}
```

## EventChannel

Broadcast channel for multiple subscribers (capacity: 256):

```rust
pub struct EventChannel {
    // Backed by tokio::sync::broadcast
}

impl EventChannel {
    pub fn new() -> Self;
    pub fn subscribe(&self) -> broadcast::Receiver<StreamEvent>;
    pub fn emit(&self, event: StreamEvent) -> Result<()>;
    pub fn close(&self);
}
```

## EventSink

Generic trait for abstracting over event emission:

```rust
pub trait EventSink: Send + Sync {
    fn emit(&self, event: StreamEvent) -> Result<()>;
}
```

## Related

- [Rust Events Guide](/rust/events) — Usage examples
- [Event System Concepts](/concepts/event-system) — Patterns
