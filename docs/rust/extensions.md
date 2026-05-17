# Rust Extensions

The `Extension` trait allows middleware injection into the agent lifecycle.

## Extension Trait

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

All methods have default implementations that return `Ok(())` — implement only the hooks you need.

## Logging Extension

```rust
use async_trait::async_trait;
use spectra_rs::{Extension, BeforeToolCallContext, AfterToolCallContext, SpectraError};

pub struct LoggingExtension;

#[async_trait]
impl Extension for LoggingExtension {
    async fn on_before_tool_call(&self, ctx: &mut BeforeToolCallContext) -> Result<(), SpectraError> {
        println!("[Tool] Calling: {} with args: {}", ctx.tool_call.name, ctx.tool_call.args);
        Ok(())
    }

    async fn on_after_tool_call(&self, ctx: &mut AfterToolCallContext) -> Result<(), SpectraError> {
        println!("[Tool] Result: {}", ctx.result.content.iter().map(|c| c.text()).collect::<String>());
        Ok(())
    }
}
```

## Rate Limiting Extension

```rust
pub struct RateLimitExtension {
    limiter: tokio::sync::Mutex<RateLimiter>,
}

#[async_trait]
impl Extension for RateLimitExtension {
    async fn on_before_tool_call(&self, ctx: &mut BeforeToolCallContext) -> Result<(), SpectraError> {
        self.limiter.lock().await.acquire().await;
        Ok(())
    }
}
```

## Registering Extensions

```rust
let agent = AgentBuilder::new()
    .model(Model::anthropic("claude-sonnet-4-20250514"))
    .extension(LoggingExtension)
    .extension(RateLimitExtension { limiter: tokio::sync::Mutex::new(RateLimiter::new(10)) })
    .build(client);
```

## Context Objects

### BeforeToolCallContext

```rust
pub struct BeforeToolCallContext {
    pub tool_call: ToolCall,       // The pending tool call
    pub messages: Vec<Message>,    // Current conversation history
}
```

### AfterToolCallContext

```rust
pub struct AfterToolCallContext {
    pub tool_call: ToolCall,       // The executed tool call
    pub result: ToolResult,        // The tool's result
}
```

## Blocking Tool Execution

Return an error from `on_before_tool_call` to prevent execution:

```rust
async fn on_before_tool_call(&self, ctx: &mut BeforeToolCallContext) -> Result<(), SpectraError> {
    if ctx.tool_call.name == "delete_file" {
        return Err(SpectraError::ToolError("File deletion is not allowed".into()));
    }
    Ok(())
}
```

The error is returned to the LLM as a tool execution failure.

## Next Steps

- [**Tool Design Guide**](/guides/tool-design-patterns) — Best practices for tools and extensions
- [**Error Handling Guide**](/guides/error-handling) — Error types and retry patterns
