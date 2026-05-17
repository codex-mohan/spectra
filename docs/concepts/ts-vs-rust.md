# TypeScript vs Rust

Spectra provides independent SDKs for TypeScript and Rust. This page explains the differences, similarities, and when to use each.

## Same Design, Different Languages

Both SDKs follow the same patterns:
- Agent loop: stream → accumulate → dispatch tools → repeat
- Event-driven architecture with streaming
- Tool system with schema validation
- Extension/middleware hooks

They share **design patterns and type shapes**, not code or runtime.

## Side-by-Side Comparison

| Concept | TypeScript | Rust |
|---|---|---|
| **Agent** | `new Agent(config)` | `AgentBuilder::new().build(client)` |
| **Run** | `for await (const event of agent.run(input))` | `while let Some(event) = stream.next().await` |
| **Tool definition** | `defineTool({ name, description, parameters: z.object(...), execute })` | `impl Tool for MyTool { fn name(), fn description(), fn parameters(), async fn execute() }` |
| **Schema** | Zod (`z.object({ query: z.string() })`) | JSON Schema (`serde_json::json!({...})`) |
| **Events** | `AgentEvent` discriminated union | `StreamEvent` enum |
| **Streaming** | `EventStream` (AsyncIterable) | `LlmStream` (`Pin<Box<dyn Stream>>`) |
| **Error handling** | TypeScript errors, try/catch | `Result<T, SpectraError>`, `?` operator |
| **Hooks** | `beforeToolCall`, `afterToolCall` callbacks | `Extension` trait with hook methods |
| **Tool registry** | `Map<string, AgentTool>` on Agent | `ToolRegistry` (DashMap) |
| **Provider** | `registerProvider({ name, stream })` | `impl LlmClient for MyClient` |

## Code Comparison: Same Agent

### TypeScript

```typescript
import { Agent, defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";

const agent = new Agent({
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
  systemPrompt: "You are helpful.",
  tools: [
    defineTool({
      name: "search",
      description: "Search the web",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ content: [{ type: "text", text: await search(query) }] }),
    }),
  ],
});

for await (const event of agent.run("What's new?")) {
  if (event.type === "message_update") {
    process.stdout.write(event.message.content.filter(c => c.type === "text").map(c => c.text).join(""));
  }
}
```

### Rust

```rust
use spectra_rs::{AgentBuilder, Model, Tool, ToolResult};
use spectra_http::OpenAIClient;
use serde_json::json;

struct SearchTool;

#[async_trait]
impl Tool for SearchTool {
    fn name(&self) -> &str { "search" }
    fn description(&self) -> &str { "Search the web" }
    fn parameters(&self) -> serde_json::Value {
        json!({ "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult, Box<dyn std::error::Error + Send + Sync>> {
        let query = args["query"].as_str().unwrap();
        let result = search(query).await?;
        Ok(ToolResult::text(result))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?;
    let agent = AgentBuilder::new()
        .model(Model::openai("gpt-4o"))
        .system_prompt("You are helpful.")
        .tool(SearchTool)
        .build(client);

    let mut stream = agent.prompt("What's new?").await?;
    while let Some(Ok(event)) = stream.next().await {
        // Handle events
    }
    Ok(())
}
```

## When to Use TypeScript

- Building web applications (Next.js, React, etc.)
- Rapid prototyping
- UI integration with streaming
- Team already knows JavaScript/TypeScript
- Need Zod schema validation

## When to Use Rust

- Performance-critical applications
- CLI tools
- Systems integration
- Memory-constrained environments
- Team already knows Rust
- Need opt-level 3 performance

## Never Mix Them

The SDKs are **independent**. Do not:
- Try to call Rust from TypeScript (no FFI)
- Share configuration between them
- Expect them to interoperate

Choose one SDK per project based on your needs.

## Next Steps

- [**TypeScript Overview**](/typescript/overview) — Deep dive into the TS SDK
- [**Rust Overview**](/rust/overview) — Deep dive into the Rust SDK
