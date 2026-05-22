# Event System

Spectra uses two event consumption patterns: generators (TypeScript) and channels (Rust).

## TypeScript: AsyncIterable (Generator)

The primary pattern is consuming events via `for await...of`:

```typescript
for await (const event of agent.run("Hello")) {
  // event is yielded as it happens
}
```

This works because `agent.run()` returns an `AsyncGenerator<AgentEvent>`:

```typescript
async *run(input: string): AsyncGenerator<AgentEvent> {
  for await (const event of this.eventStream) {
    yield event;
  }
}
```

### Subscriber Pattern

For observers that don't consume the stream:

```typescript
const unsubscribe = agent.subscribe((event, signal) => {
  console.log(event.type);
});

await agent.run("Hello");
unsubscribe();
```

The subscriber receives a copy of every event but doesn't affect the primary stream.

## Rust: mpsc Channel + Broadcast

The primary pattern is consuming events via a stream:

```rust
let (mut rx, _, _) = agent.run("Hello").await?;
while let Some(Ok(event)) = stream.next().await {
  // event is yielded as it happens
}
```

Internally, events flow through an `mpsc::channel`:

```rust
let (tx, rx) = tokio::sync::mpsc::channel(32);

// In the agent loop:
let _ = tx.send(Ok(StreamEvent::MessageUpdate { delta })).await;

// Consumer:
while let Some(event) = rx.recv().await {
  // handle event
}
```

### Broadcast Channel

For multiple subscribers:

```rust
let broadcast = EventChannel::new(); // capacity: 256

// Subscribe
let mut sub1 = broadcast.subscribe();
let mut sub2 = broadcast.subscribe();

// Send (in agent loop)
broadcast.emit(event)?;

// Receive
while let Ok(event) = sub1.recv().await {
  // handle event
}
```

## Generator vs Broadcast

| Pattern | Use Case | TypeScript | Rust |
|---|---|---|---|
| Generator/Stream | Primary consumer (UI rendering) | `for await...of` | `while let Some` |
| Broadcast/Subscribe | Observers (logging, analytics) | `agent.subscribe()` | `EventChannel::subscribe()` |

## Event Ordering

Events are emitted in this order:

```
agent_start
  turn_start
    message_start
      message_update (×N)
    message_end
    [tool_execution_start → tool_execution_update (×N) → tool_execution_end] (×M)
  turn_end
  [turn_start → ... → turn_end] (repeat)
agent_end
```

## Backpressure

### TypeScript

The `EventStream` has an internal buffer. If the consumer is slow, events queue up. For very slow consumers, use the subscriber pattern with its own buffer.

### Rust

The `mpsc::channel` has a fixed capacity. If the sender outpaces the receiver, `send()` waits until space is available. The broadcast channel drops events if the subscriber is too slow.

## Next Steps

- [**Events Guide**](/typescript/events) — All event types
- [**Streaming Architecture**](/concepts/streaming-architecture) — How events are generated
