# Extension Reference (Rust)

Middleware hooks for the agent lifecycle.

## Trait Definition

```rust
#[async_trait]
pub trait Extension: Send + Sync + 'static {
    async fn on_agent_start(&self, ctx: &mut AgentContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_agent_end(&self, ctx: &mut AgentContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_turn_start(&self, ctx: &mut TurnContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_turn_end(&self, ctx: &mut TurnContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_before_tool_call(&self, ctx: &mut BeforeToolCallContext) -> Result<(), SpectraError> { Ok(()) }
    async fn on_after_tool_call(&self, ctx: &mut AfterToolCallContext) -> Result<(), SpectraError> { Ok(()) }
}
```

## Context Types

### BeforeToolCallContext

```rust
pub struct BeforeToolCallContext {
    pub tool_call: ToolCall,
    pub messages: Vec<Message>,
}
```

### AfterToolCallContext

```rust
pub struct AfterToolCallContext {
    pub tool_call: ToolCall,
    pub result: ToolResult,
}
```

## Related

- [Rust Extensions Guide](/rust/extensions) — Usage examples
- [Tool Design Patterns](/guides/tool-design-patterns) — Best practices
