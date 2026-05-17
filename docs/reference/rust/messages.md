# Messages Reference

Core message types for conversation history.

## Message Enum

```rust
pub enum Message {
    User(UserMessage),
    Assistant(AssistantMessage),
    ToolResult(ToolResultMessage),
}
```

## UserMessage

```rust
pub struct UserMessage {
    pub content: Vec<Content>,
}
```

## AssistantMessage

```rust
pub struct AssistantMessage {
    pub content: Vec<Content>,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: Option<StopReason>,
}
```

## ToolResultMessage

```rust
pub struct ToolResultMessage {
    pub tool_call_id: String,
    pub tool_name: String,
    pub content: Vec<Content>,
}
```

## Content

```rust
pub enum Content {
    Text(String),
    Image { data: String, mime_type: String },
}

impl Content {
    pub fn text(text: impl Into<String>) -> Self;
}
```

## StopReason

```rust
pub enum StopReason {
    Stop,
    Length,
    ToolCalls,
    Error,
}
```

## Related

- [Types Reference (TypeScript)](/reference/typescript/types) — Equivalent TS types
