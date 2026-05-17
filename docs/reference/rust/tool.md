# Tool Reference

Trait defining a capability the agent can use.

## Trait Definition

```rust
#[async_trait]
pub trait Tool: Send + Sync + 'static {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> serde_json::Value; // JSON Schema
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult, Box<dyn std::error::Error + Send + Sync>>;
}
```

## ToolResult

```rust
pub struct ToolResult {
    pub content: Vec<Content>,
    pub is_error: bool,
}

impl ToolResult {
    pub fn text(text: impl Into<String>) -> Self;
}
```

## ToolRegistry

```rust
pub struct ToolRegistry {
    // Backed by DashMap for concurrent access
}

impl ToolRegistry {
    pub fn new() -> Self;
    pub fn register(&self, tool: impl Tool + 'static);
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>>;
    pub fn dispatch(&self, name: &str, args: serde_json::Value) -> Result<ToolResult, SpectraError>;
}
```

## Related

- [Rust Tools Guide](/rust/tools) — Implementation examples
- [Tool Dispatch Concepts](/concepts/tool-dispatch) — How dispatch works
