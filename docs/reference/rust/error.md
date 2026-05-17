# Error Reference (Rust)

Error types using `thiserror` and `miette` for human-readable diagnostics.

## SpectraError Enum

```rust
#[derive(Debug, thiserror::Error, miette::Diagnostic)]
pub enum SpectraError {
    #[error("API error: {0}")]
    ApiError(String),

    #[error("Tool execution failed: {0}")]
    ToolError(String),

    #[error("Stream error: {0}")]
    StreamError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Unknown tool: {0}")]
    UnknownTool(String),

    #[error("Max turns exceeded: {0}")]
    MaxTurnsExceeded(u32),
}
```

## Result Type Alias

```rust
pub type Result<T> = std::result::Result<T, SpectraError>;
```

## Related

- [Error Handling Guide](/guides/error-handling) — Retry patterns
- [Rust Agent Guide](/rust/agent) — Error handling examples
