# Tool Reference

Trait defining a capability the agent can use, plus convenience builders.

## Trait Definition

```rust
#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> &ToolDef;
    async fn execute(&self, ctx: ToolContext) -> Result<ToolResult>;
}
```

## ToolDef

```rust
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value, // JSON Schema
}

impl ToolDef {
    pub fn new(name: impl Into<String>, description: impl Into<String>, parameters: Value) -> Self;
}
```

## ToolContext

```rust
pub struct ToolContext {
    pub tool_call_id: String,
    pub params: Value,                          // parsed JSON arguments
    pub signal: Option<watch::Receiver<bool>>,  // abort signal
    pub progress_tx: Option<UnboundedSender<ToolResult>>, // progress reporting
}

impl ToolContext {
    pub fn new(tool_call_id: String, params: Value) -> Self;
    pub fn with_signal(tool_call_id: String, params: Value, signal: watch::Receiver<bool>) -> Self;
    pub fn is_aborted(&self) -> bool;
    pub fn report_progress(&self, result: ToolResult);
}
```

## ToolResult

```rust
pub struct ToolResult {
    pub content: Value, // serde_json::Value
    pub is_error: bool,
}

impl ToolResult {
    pub fn success(content: Value) -> Self;
    pub fn error(message: impl Into<String>) -> Self;
}
```

## ToolBuilder

Convenience builder for creating tools without implementing the trait:

```rust
pub struct ToolBuilder { /* private fields */ }

impl ToolBuilder {
    pub fn new(name: impl Into<String>) -> Self;
    pub fn description(mut self, description: impl Into<String>) -> Self;
    pub fn parameters(mut self, parameters: Value) -> Self;
    pub fn execute<F, Fut>(mut self, f: F) -> Self
    where
        F: Fn(ToolContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<ToolResult>> + Send + 'static;
    pub fn build(self) -> Arc<dyn Tool>;
}
```

## ToolRegistry

```rust
pub struct ToolRegistry {
    // Backed by DashMap for concurrent access
}

impl ToolRegistry {
    pub fn new() -> Self;
    pub fn register(&self, tool: Arc<dyn Tool>);
    pub fn unregister(&self, name: &str);
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>>;
    pub fn list(&self) -> Vec<ToolDef>;
    pub fn definitions(&self) -> Vec<ToolDef>;
    pub async fn dispatch(&self, name: &str, ctx: ToolContext) -> Result<ToolResult>;
    pub fn contains(&self, name: &str) -> bool;
    pub fn len(&self) -> usize;
    pub fn is_empty(&self) -> bool;
}
```

## Related

- [Rust Tools Guide](/rust/tools) — Implementation examples
- [Tool Dispatch Concepts](/concepts/tool-dispatch) — How dispatch works
