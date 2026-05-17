# Debugging

How to debug Spectra agents when things go wrong.

## Enable Logging

### TypeScript

```typescript
// Set DEBUG env var
process.env.DEBUG = "spectra:*";

// Or use a custom logger
const agent = new Agent({
  model: { /* ... */ },
  // Add logging in hooks
  beforeToolCall: async ({ toolCall, args }) => {
    console.log(`[DEBUG] Calling ${toolCall.name} with`, JSON.stringify(args));
  },
  afterToolCall: async ({ toolCall, result }) => {
    console.log(`[DEBUG] ${toolCall.name} returned`, JSON.stringify(result));
  },
});
```

### Rust

```rust
// Use tracing
use tracing_subscriber;

tracing_subscriber::fmt()
    .with_max_level(tracing::Level::DEBUG)
    .init();

// In your code:
tracing::debug!("Calling tool {} with args: {}", name, args);
```

## Inspect Events

Print all events to understand the agent's behavior:

```typescript
for await (const event of agent.run("Hello")) {
  console.log(`[Event] ${event.type}`, JSON.stringify(event, null, 2));
}
```

## Check the Transcript

After a run, inspect the full conversation:

```typescript
console.log("Transcript:");
for (const msg of agent.messages) {
  console.log(`[${msg.role}]`, msg.content);
}
```

## Network Debugging

### TypeScript

```typescript
// Log raw HTTP requests
const agent = new Agent({
  model: { /* ... */ },
  streamOptions: {
    headers: { "X-Debug": "true" },
  },
});
```

### Rust

```rust
// Enable reqwest logging
RUST_LOG=reqwest=debug cargo run
```

## Common Debug Scenarios

### "Why did the agent call this tool?"

Check the event stream for the LLM's reasoning:
```typescript
if (event.type === "message_update") {
  const text = event.message.content.filter(c => c.type === "text").map(c => c.text).join("");
  console.log("LLM reasoning:", text);
}
```

### "Why didn't the agent call this tool?"

1. Check the tool's `description` — is it clear when to use it?
2. Check the system prompt — does it mention the tool?
3. Check if the LLM can answer directly without the tool

### "Why is the response truncated?"

Check `maxTokens` on the model config and `maxTurns` on the agent.

## Next Steps

- [**Common Issues**](/troubleshooting/common-issues) — Quick fixes
- [**FAQ**](/troubleshooting/faq) — Frequently asked questions
