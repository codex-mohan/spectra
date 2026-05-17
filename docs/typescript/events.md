# Events

The agent emits a stream of typed events during execution. Consume via `for await...of` on `agent.run()` or via `agent.subscribe()`.

## Generator Pattern (Recommended)

```typescript
for await (const event of agent.run("Hello")) {
  // event is a discriminated union — check event.type
}
```

## Subscriber Pattern

```typescript
const unsubscribe = agent.subscribe((event, signal) => {
  if (signal?.aborted) return;
  // handle event
});

await agent.prompt("Hello");
unsubscribe();
```

## Event Types

### Lifecycle Events

| Event | When | Key Fields |
|---|---|---|
| `agent_start` | Run begins | — |
| `agent_end` | Run complete | `messages` — full transcript |
| `turn_start` | LLM turn begins | — |
| `turn_end` | LLM turn complete | `message`, `toolResults` |

### Message Events

| Event | When | Key Fields |
|---|---|---|
| `message_start` | New message added to transcript | `message` |
| `message_update` | Streaming delta for assistant message | `message`, `assistantMessageEvent` |
| `message_end` | Message fully formed | `message` |

### Tool Events

| Event | When | Key Fields |
|---|---|---|
| `tool_execution_start` | Tool about to execute | `toolCallId`, `toolName`, `args` |
| `tool_execution_update` | Tool reports partial progress | `toolCallId`, `toolName`, `partialResult` |
| `tool_execution_end` | Tool finished | `toolCallId`, `toolName`, `result`, `isError` |

## Streaming Text

The most common pattern — render text as it arrives:

```typescript
for await (const event of agent.run("Hello")) {
  if (event.type === "message_update") {
    const text = event.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    process.stdout.write(text);
  }
}
```

::: tip
Use `process.stdout.write()` instead of `console.log()` — it doesn't add newlines between chunks, giving you smooth streaming output.
:::

## Tracking Tool Execution

```typescript
for await (const event of agent.run("Search for AI news")) {
  switch (event.type) {
    case "tool_execution_start":
      console.log(`\n🔧 Calling ${event.toolName}...`);
      break;
    case "tool_execution_update":
      console.log(`\n   Progress: ${event.partialResult}`);
      break;
    case "tool_execution_end":
      if (event.isError) {
        console.log(`\n   ❌ Failed`);
      } else {
        console.log(`\n   ✅ Done`);
      }
      break;
  }
}
```

## Turn Boundaries

Track when the agent switches between LLM turns:

```typescript
let turnCount = 0;
for await (const event of agent.run("Research quantum computing")) {
  if (event.type === "turn_start") {
    turnCount++;
    console.log(`\n--- Turn ${turnCount} ---`);
  }
  if (event.type === "turn_end") {
    console.log(`\n--- Turn ${turnCount} complete ---`);
  }
}
```

## Event Flow Diagram

```
agent_start
  turn_start
    message_start
      message_update (×N streaming deltas)
    message_end
    [tool_execution_start → tool_execution_update (×N) → tool_execution_end] (×M tools)
  turn_end
  [turn_start → ... → turn_end] (repeat if more turns)
agent_end
```

## Next Steps

- [**Agent**](/typescript/agent) — How events relate to the agent lifecycle
- [**Concepts: Event System**](/concepts/event-system) — Broadcast vs generator patterns
- [**Streaming UI Guide**](/guides/streaming-ui) — Rendering events in a UI
