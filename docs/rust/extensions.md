# Rust Extensions

The `Extension` trait allows synchronous middleware injection into the agent lifecycle.

## Extension Trait

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

All methods have default implementations — implement only the hooks you need.

## Logging Extension

```rust
use spectra_rs::{Extension, BeforeToolCallAction, AfterToolCallAction, ToolCall, ToolContext, ToolResult};

pub struct LoggingExtension;

impl Extension for LoggingExtension {
    fn on_before_tool_call(&self, tool_call: &ToolCall, ctx: &ToolContext) -> BeforeToolCallAction {
        println!("[Tool] Calling: {} with args: {}", tool_call.name, ctx.params);
        BeforeToolCallAction::Allow
    }

    fn on_after_tool_call(&self, tool_call: &ToolCall, _ctx: &ToolContext, result: &ToolResult) -> AfterToolCallAction {
        println!("[Tool] Result for {}: is_error={}", tool_call.name, result.is_error);
        AfterToolCallAction::Passthrough
    }
}
```

## Rate Limiting Extension

```rust
use std::sync::Mutex;

pub struct RateLimitExtension {
    limiter: Mutex<RateLimiter>,
}

impl Extension for RateLimitExtension {
    fn on_before_tool_call(&self, _tool_call: &ToolCall, _ctx: &ToolContext) -> BeforeToolCallAction {
        self.limiter.lock().unwrap().acquire();
        BeforeToolCallAction::Allow
    }
}
```

## Registering Extensions

Extension hooks are composed via `ExtensionManager`:

```rust
use spectra_rs::ExtensionManager;

let mut extensions = ExtensionManager::new();
extensions.add(LoggingExtension);
extensions.add(RateLimitExtension { limiter: Mutex::new(RateLimiter::new(10)) });

let agent = AgentBuilder::new(Model::anthropic("claude-sonnet-4-20250514"))
    .extensions(extensions)
    .build(client);
```

## BeforeToolCallAction

| Variant | Effect |
|---|---|
| `Allow` | Proceed with execution |
| `Block { reason }` | Skip execution, return error to LLM |
| `Transform { modified_args }` | Modify arguments before execution |

## AfterToolCallAction

| Variant | Effect |
|---|---|
| `Passthrough` | Use original tool result |
| `Replace { result }` | Override the tool result |

## Blocking Tool Execution

```rust
fn on_before_tool_call(&self, tool_call: &ToolCall, _ctx: &ToolContext) -> BeforeToolCallAction {
    if tool_call.name == "delete_file" {
        return BeforeToolCallAction::Block {
            reason: "File deletion is not allowed".into(),
        };
    }
    BeforeToolCallAction::Allow
}
```

The block reason is returned to the LLM as a tool execution failure.

## Next Steps

- [**Tool Design Guide**](/guides/tool-design-patterns) — Best practices for tools and extensions
- [**Error Handling Guide**](/guides/error-handling) — Error types and retry patterns
