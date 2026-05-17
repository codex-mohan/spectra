# Tool Dispatch

When the LLM requests a tool call, the agent must resolve, validate, and execute it.

## The Dispatch Pipeline

```
LLM responds with tool call
  → Parse tool name and arguments from response
  → Look up tool in registry by name
  → Validate arguments against schema (TypeScript: Zod, Rust: JSON Schema)
  → Run beforeToolCall hook (if any)
  → Execute tool
  → Run afterToolCall hook (if any)
  → Format result as ToolResultMessage
  → Append to conversation history
  → Loop back to LLM
```

## Tool Resolution

### TypeScript

Tools are stored in a `Map` on the Agent:

```typescript
// Internal lookup
const tool = this.tools.get(toolCall.name);
if (!tool) {
  throw new Error(`Unknown tool: ${toolCall.name}`);
}
```

### Rust

Tools are stored in a `ToolRegistry` (DashMap):

```rust
// Internal lookup
let tool = self.registry.get(&tool_call.name)
    .ok_or_else(|| SpectraError::ToolError(format!("Unknown tool: {}", tool_call.name)))?;
```

## Argument Validation

### TypeScript (Zod)

```typescript
// defineTool uses Zod → arguments are automatically validated
const tool = defineTool({
  parameters: z.object({
    query: z.string().min(1),
    limit: z.number().min(1).max(10).default(5),
  }),
  execute: async (args) => {
    // args is guaranteed to match the schema
    args.query; // string, non-empty
    args.limit; // number, 1-10
  },
});
```

If validation fails, the error is returned to the LLM as a tool execution failure.

### Rust (JSON Schema)

```rust
// Tool returns JSON Schema → caller validates before execute()
fn parameters(&self) -> serde_json::Value {
    json!({
        "type": "object",
        "properties": { "query": { "type": "string" } },
        "required": ["query"]
    })
}

async fn execute(&self, args: serde_json::Value) -> Result<ToolResult, ...> {
    // args is a raw JSON Value — tool must parse/validate itself
    let query = args["query"].as_str().ok_or("missing query")?;
}
```

::: tip
TypeScript's Zod validation is stricter — invalid args never reach `execute()`. Rust tools must handle validation internally.
:::

## Execution Modes

### Parallel (Default)

All tool calls in a single LLM response execute concurrently:

```typescript
// TypeScript
const results = await Promise.all(
  toolCalls.map(call => executeTool(call))
);
```

```rust
// Rust
let results = futures::future::join_all(
  tool_calls.iter().map(|call| execute_tool(call))
).await;
```

### Sequential

Tool calls execute one after another:

```typescript
const results = [];
for (const call of toolCalls) {
  results.push(await executeTool(call));
}
```

Use sequential when tools depend on each other's output or when rate-limiting is needed.

## Error Handling

If a tool fails:

1. The error is caught
2. A `ToolResult` with `isError: true` is created
3. The error message is sent back to the LLM
4. The LLM can retry, use a different tool, or respond with an explanation

```typescript
try {
  const result = await tool.execute(args);
} catch (error) {
  return {
    content: [{ type: "text", text: `Error: ${error.message}` }],
    isError: true,
  };
}
```

## Next Steps

- [**Tools Guide**](/typescript/tools) — Defining effective tools
- [**Tool Design Patterns**](/guides/tool-design-patterns) — Best practices
