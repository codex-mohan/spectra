# Messages Reference

Core message types for conversation history.

## Message Enum

```rust
#[serde(tag = "role", rename_all = "snake_case")]
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
    pub timestamp: DateTime<Utc>,
}

impl UserMessage {
    pub fn new(content: Vec<Content>) -> Self;
    pub fn text(text: impl Into<String>) -> Self; // single text block convenience
}
```

## AssistantMessage

```rust
pub struct AssistantMessage {
    pub content: Vec<Content>,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: StopReason,
    pub timestamp: DateTime<Utc>,
    pub provider: String,
    pub model: String,
    pub response_id: Option<String>,
    pub usage: TokenUsage,
}

impl AssistantMessage {
    pub fn new(content: Vec<Content>, tool_calls: Vec<ToolCall>, stop_reason: StopReason) -> Self;
    pub fn with_metadata(...) -> Self; // full constructor with provider, model, response_id, usage
}
```

## ToolResultMessage

```rust
pub struct ToolResultMessage {
    pub tool_call_id: String,
    pub tool_name: String,
    pub content: Value, // serde_json::Value
    pub is_error: bool,
    pub timestamp: DateTime<Utc>,
}

impl ToolResultMessage {
    pub fn success(tool_call_id: String, tool_name: String, content: Value) -> Self;
    pub fn error(tool_call_id: String, tool_name: String, error_message: String) -> Self;
}
```

## Content

```rust
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Content {
    Text { text: String },
    Image { url: String, detail: ImageDetail },
    Thinking { thinking: String, signature: Option<String>, redacted: bool },
}
```

## ImageDetail

```rust
pub enum ImageDetail {
    Low,   // default
    High,
    Auto,
}
```

## ToolCall

```rust
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
    pub thinking_signature: Option<String>,
}
```

## StopReason

```rust
pub enum StopReason {
    EndOfTurn,  // default
    ToolCalls,
    MaxTokens,
    Error,
    Aborted,
}
```

Display output: `"end_turn"`, `"tool_calls"`, `"max_tokens"`, `"error"`, `"aborted"`.

## TokenUsage

```rust
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: Option<u32>,
    pub cache_write_tokens: Option<u32>,
    pub cost: Option<TokenCost>,
}
```

## TokenCost

```rust
pub struct TokenCost {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub total: f64,
}
```

## Related

- [Types Reference (TypeScript)](/reference/typescript/types) — Equivalent TS types
