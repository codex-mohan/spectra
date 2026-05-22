# Agent Loop

The agent loop is the core of Spectra. It's the pattern that turns a simple LLM call into a multi-turn, tool-using agent.

## The Loop

```
1. Send user input + conversation history to LLM
2. Stream response tokens
3. Accumulate tokens into a complete message
4. Check: did the LLM request tool calls?
   - YES: Execute tools, append results to history, go to step 1
   - NO: Return final answer, end the loop
```

## Visual Flow

```
┌─────────────────────────────────────────────┐
│                 User Input                   │
└──────────────┬──────────────────────────────┘
               ▼
┌─────────────────────────────────────────────┐
│         LLM Stream (SSE)                     │
│   ┌─────────────────────────────────────┐    │
│   │ Token: "Let"                         │    │
│   │ Token: " me"                         │    │
│   │ Token: " check"                      │    │
│   │ Token: " the"                        │    │
│   │ Token: " weather..."                 │    │
│   │ ToolCall: {name: "get_weather", ...} │    │
│   └─────────────────────────────────────┘    │
└──────────────┬──────────────────────────────┘
               ▼
┌─────────────────────────────────────────────┐
│         Accumulate Deltas                    │
│   → AssistantMessage {                       │
│       content: [Text("Let me check...")],    │
│       toolCalls: [ToolCall("get_weather")]   │
│     }                                        │
└──────────────┬──────────────────────────────┘
               ▼
┌─────────────────────────────────────────────┐
│         Tool Calls Detected?                 │
│   ┌─────────────┐    ┌──────────────────┐    │
│   │ YES: Execute │    │ NO: End loop     │    │
│   │ tools        │    │ Return answer    │    │
│   └──────┬──────┘    └──────────────────┘    │
└──────────┼───────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────┐
│         Tool Results → History               │
│   Append ToolResultMessage to conversation   │
│   Loop back to step 1                        │
└─────────────────────────────────────────────┘
```

## TypeScript Implementation

```typescript
for await (const event of agent.run(input)) {
  // The agent handles the entire loop internally.
  // You just consume events as they happen.
}
```

## Rust Implementation

```rust
let (mut rx, _, _) = agent.run(input).await?;
while let Some(Ok(event)) = stream.next().await {
  // The agent handles the entire loop internally.
  // You just consume events as they happen.
}
```

## Why This Matters

Understanding the loop helps you:
- **Debug** why an agent keeps calling tools (the LLM isn't getting a clear answer)
- **Set `maxTurns`** appropriately (prevent infinite loops)
- **Design tools** that give the LLM enough information to stop
- **Handle errors** at the right point in the cycle

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| Agent loops forever | Tool returns ambiguous result | Make tool output clearer |
| Agent stops after 1 turn | `maxTurns` set to 1 | Increase `maxTurns` |
| Tool called repeatedly | LLM doesn't understand the result | Improve tool description or result format |
| No tool called | Tool description unclear | Add `description` with when-to-use guidance |

## Next Steps

- [**Tool Dispatch**](/concepts/tool-dispatch) — How tools are resolved and executed
- [**Streaming Architecture**](/concepts/streaming-architecture) — SSE parsing and delta accumulation
