# EventStream Reference

`EventStream<T, R>` implements `AsyncIterable<T>` for streaming event consumption.

## Signature

```typescript
class EventStream<T, R> implements AsyncIterable<T> {
  push(event: T): void;
  end(result?: R): void;
  result(): Promise<R>;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}
```

## Methods

| Method | Description |
|---|---|
| `push(event: T)` | Push an event into the stream |
| `end(result?: R)` | Signal stream completion with optional result |
| `result()` | Promise that resolves when the stream ends |

## Usage

```typescript
const stream = new EventStream<AgentEvent, AssistantMessage>();

// Producer
stream.push({ type: "message_update", message: partialMessage });
stream.end({ content: [{ type: "text", text: "Hello" }], stopReason: "stop" });

// Consumer
for await (const event of stream) {
  console.log(event.type);
}

const finalResult = await stream.result();
```

## AssistantMessageEventStream

Extends `EventStream` with message completion logic for LLM responses.

## Related

- [Events Guide](/typescript/events) — Event types
- [Event System Concepts](/concepts/event-system) — Patterns
