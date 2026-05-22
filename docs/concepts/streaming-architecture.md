# Streaming Architecture

Spectra is built around streaming — not as an afterthought, but as the core data flow.

## Why Streaming?

LLMs generate text token by token. Waiting for the full response before showing anything creates a poor user experience. Streaming lets you:

- Show text as it arrives (like a typewriter effect)
- Detect tool calls early
- Cancel long-running responses
- Build real-time UIs

## SSE (Server-Sent Events)

Both Anthropic and OpenAI use SSE for streaming. Each event looks like:

```
data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}

data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": " world"}}

data: {"type": "message_stop"}
```

## Parsing Pipeline

```
HTTP Response (SSE stream)
  → Split by "\n\n" (SSE event separator)
  → Parse "data: {...}" lines
  → Map to provider-specific event types
  → Convert to unified ContentDelta
  → Push to EventStream
```

### TypeScript

```typescript
// Provider stream handler
for await (const chunk of response) {
  const text = chunk.choices[0]?.delta?.content;
  if (text) {
    stream.push({
      type: "content_delta",
      delta: { type: "text", text },
    });
  }
}
```

### Rust

```rust
// SSE parser in spectra-http
let mut stream = response.bytes_stream();
while let Some(chunk) = stream.next().await {
    // Parse "data: {...}" lines
    // Yield LlmStreamEvent::ContentDelta events
}
```

## Delta Accumulation

Each `ContentDelta` is a small piece of the full response. The agent accumulates them:

```
Delta: Text "Hello"       → AssistantMessage: "Hello"
Delta: Text " world"      → AssistantMessage: "Hello world"
Delta: Text "!"           → AssistantMessage: "Hello world!"
```

### TypeScript

```typescript
// EventStream accumulates internally
stream.push({ type: "content_delta", delta: { type: "text", text: "Hello" } });
// The accumulated message is available on the stream
```

### Rust

```rust
// apply_delta() accumulates into AssistantMessage
fn apply_delta(msg: &mut AssistantMessage, delta: &ContentDelta) {
    match delta {
        ContentDelta::Text { delta: text } => {
            // Append to last text block or push new one
        }
        ContentDelta::Thinking { delta, signature } => {
            // Append to last thinking block or push new one
        }
        ContentDelta::ToolCallStart { id, name } => {
            msg.tool_calls.push(ToolCall { id, name, .. });
        }
        ContentDelta::ToolCallDelta { id, args_delta } => {
            // Accumulate partial JSON args
        }
        ContentDelta::ToolCallEnd { .. } => {}
    }
}
```

## AsyncIterable Pattern

TypeScript uses `AsyncIterable` for streaming:

```typescript
class EventStream<T> implements AsyncIterable<T> {
  async *[Symbol.asyncIterator]() {
    while (!this.ended) {
      yield await this.nextEvent();
    }
  }
}
```

This enables the clean `for await...of` syntax:

```typescript
for await (const event of agent.run("Hello")) {
  // Each event is yielded as it arrives
}
```

## Rust Stream Pattern

Rust uses `tokio_stream::Stream`:

```rust
type LlmStream = Pin<Box<dyn Stream<Item = Result<LlmStreamEvent>> + Send>>;
```

Consumed with `StreamExt::next()`:

```rust
while let Some(event) = stream.next().await {
  // Each event is yielded as it arrives
}
```

## Next Steps

- [**Agent Loop**](/concepts/agent-loop) — How streaming fits into the agent cycle
- [**Streaming UI Guide**](/guides/streaming-ui) — Rendering streams in a UI
