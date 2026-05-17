# AgentBuilder Reference

Fluent builder for constructing `Agent` instances.

## Constructor

```rust
AgentBuilder::new() -> AgentBuilder<()>
```

## Methods

| Method | Signature | Description |
|---|---|---|
| `model` | `model(Model) -> Self` | Set the LLM model |
| `system_prompt` | `system_prompt(&str) -> Self` | Set the system prompt |
| `max_turns` | `max_turns(u32) -> Self` | Maximum LLM turns (default: unlimited) |
| `tool` | `tool(T: Tool + 'static) -> Self` | Register a tool |
| `extension` | `extension(E: Extension + 'static) -> Self` | Register a middleware extension |
| `build` | `build(client: L) -> Agent<L> where L: LlmClient` | Build the agent |

## Usage

```rust
let agent = AgentBuilder::new()
    .model(Model::openai("gpt-4o"))
    .system_prompt("You are helpful.")
    .max_turns(10)
    .tool(WeatherTool)
    .extension(LoggingExtension)
    .build(client);
```

## Related

- [Rust Agent Guide](/rust/agent) — Usage examples
- [Tool Reference](/reference/rust/tool) — Tool trait
