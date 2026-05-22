# Error Reference (Rust)

Error types using `thiserror` and `miette` for human-readable diagnostics.

## SpectraError Enum

```rust
#[derive(Error, Debug, Diagnostic)]
pub enum SpectraError {
    #[error("LLM provider error: {provider} — {message}")]
    LlmError { provider: String, message: String, source: Option<Box<dyn Error + Send + Sync>> },

    #[error("Tool execution failed: '{name}' — {reason}")]
    ToolError { name: String, reason: String, source: Option<Box<dyn Error + Send + Sync>> },

    #[error("Tool not found: '{name}'")]
    ToolNotFound { name: String },

    #[error("Schema validation failed for tool '{name}': {detail}")]
    SchemaValidation { name: String, detail: String, source: Option<serde_json::Error> },

    #[error("Stream interrupted: {reason}")]
    StreamError { reason: String },

    #[error("Configuration error: {field} — {detail}")]
    ConfigError { field: String, detail: String },

    #[error("HTTP error: {status} — {url}")]
    HttpError { status: u16, url: String },

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tool approval denied: {reason}")]
    ApprovalDenied { reason: String },

    #[error("Agent aborted")]
    Aborted,
}
```

## Result Type Alias

```rust
pub type Result<T> = std::result::Result<T, SpectraError>;
```

## Related

- [Error Handling Guide](/guides/error-handling) — Retry patterns
- [Rust Agent Guide](/rust/agent) — Error handling examples
