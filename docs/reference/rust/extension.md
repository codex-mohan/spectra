# Extension Reference (Rust)

Middleware hooks for the agent lifecycle.

## Extension Trait

Synchronous hooks with action-based return types (not async Result):

```rust
pub trait Extension: Send + Sync {
    fn on_before_tool_call(&self, tool_call: &ToolCall, ctx: &ToolContext) -> BeforeToolCallAction {
        BeforeToolCallAction::Allow
    }

    fn on_after_tool_call(&self, tool_call: &ToolCall, ctx: &ToolContext, result: &ToolResult) -> AfterToolCallAction {
        AfterToolCallAction::Passthrough
    }

    fn on_agent_start(&self) {}
    fn on_agent_end(&self) {}
    fn on_turn_start(&self) {}
    fn on_turn_end(&self) {}
}
```

## BeforeToolCallAction

```rust
pub enum BeforeToolCallAction {
    Allow,
    Block { reason: String },
    Transform { modified_args: Value },
}
```

## AfterToolCallAction

```rust
pub enum AfterToolCallAction {
    Passthrough,
    Replace { result: ToolResult },
}
```

## ExtensionManager

Collects and dispatches to all registered extensions:

```rust
pub struct ExtensionManager {
    // Vec<Arc<dyn Extension>>
}

impl ExtensionManager {
    pub fn new() -> Self;
    pub fn add<E: Extension + 'static>(&mut self, ext: E);
    pub fn on_before_tool_call(&self, tool_call: &ToolCall, ctx: &ToolContext) -> Vec<BeforeToolCallAction>;
    pub fn on_after_tool_call(&self, tool_call: &ToolCall, ctx: &ToolContext, result: &ToolResult) -> Vec<AfterToolCallAction>;
    pub fn on_agent_start(&self);
    pub fn on_agent_end(&self);
    pub fn on_turn_start(&self);
    pub fn on_turn_end(&self);
}
```

## Related

- [Rust Extensions Guide](/rust/extensions) — Usage examples
- [Tool Design Patterns](/guides/tool-design-patterns) — Best practices
