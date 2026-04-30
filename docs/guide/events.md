# Events

The agent emits a stream of typed events during execution. Consume via `for await...of` on `agent.run()` or via `agent.subscribe()`.

## Generator Pattern

```typescript
for await (const event of agent.run("Hello")) {
  // event is a discriminated union
}
```

## Subscriber Pattern

```typescript
agent.subscribe((event, signal) => {
  if (signal?.aborted) return;
});
```

## Event Types

### Lifecycle

| Event | When |
|-------|------|
| `agent_start` | Run begins |
| `agent_end` | Run complete, contains final `messages` |
| `turn_start` | LLM turn begins |
| `turn_end` | LLM turn complete, contains `message` and `toolResults` |

### Messages

| Event | When |
|-------|------|
| `message_start` | New message added to transcript |
| `message_update` | Streaming delta for assistant message |
| `message_end` | Message fully formed |

### Tools

| Event | When |
|-------|------|
| `tool_execution_start` | Tool about to execute |
| `tool_execution_update` | Tool reports partial progress |
| `tool_execution_end` | Tool finished, contains `result` and `isError` |
