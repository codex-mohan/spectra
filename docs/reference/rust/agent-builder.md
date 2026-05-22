# AgentBuilder Reference

Fluent builder for constructing `Agent` instances.

## Constructor

```rust
AgentBuilder::new(model: Model) -> AgentBuilder
```

## Methods

| Method | Signature | Description |
|---|---|---|
| `model` | (set via `new()`) | Set the LLM model (required constructor param) |
| `system_prompt` | `system_prompt(&str) -> Self` | Set the system prompt |
| `tools` | `tools(Arc<ToolRegistry>) -> Self` | Use a shared tool registry |
| `register_tool` | `register_tool(Arc<dyn Tool>) -> Self` | Register a tool into the internal registry |
| `max_turns` | `max_turns(usize) -> Self` | Max LLM turns before stopping (default: unlimited) |
| `tool_execution` | `tool_execution(ToolExecutionMode) -> Self` | Parallel (default) or Sequential |
| `max_retry_delay_ms` | `max_retry_delay_ms(u64) -> Self` | Max backoff delay for LLM retries (default: 30_000) |
| `tool_choice` | `tool_choice(ToolChoice) -> Self` | Force tool selection behavior |
| `reasoning_effort` | `reasoning_effort(ReasoningEffort) -> Self` | Set reasoning/thinking effort |
| `extensions` | `extensions(ExtensionManager) -> Self` | Register middleware extensions |
| `transform_context` | `transform_context(f) -> Self` | Async transform messages before each LLM call |
| `get_api_key` | `get_api_key(f) -> Self` | Dynamic API key resolution by provider name |
| `build` | `build(Arc<dyn LlmClient>) -> Agent` | Build the agent |

## Usage

```rust
let agent = AgentBuilder::new(Model::openai("gpt-4o"))
    .system_prompt("You are helpful.")
    .register_tool(Arc::new(WeatherTool))
    .max_turns(10)
    .build(client);
```

## Return Type

`AgentBuilder::build()` returns an `Agent`. Calling `agent.run(input)` returns `(mpsc::Receiver<Result<StreamEvent>>, EventChannel, AgentHandle)` — a triple of receiver, broadcast channel, and steering handle.

## Related

- [Rust Agent Guide](/rust/agent) — Usage examples
- [Tool Reference](/reference/rust/tool) — Tool trait and ToolBuilder
