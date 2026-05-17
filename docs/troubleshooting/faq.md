# FAQ

Frequently asked questions about Spectra.

## General

### Why are there separate TypeScript and Rust SDKs?

Each SDK is a complete, independent native implementation. They share design patterns and type shapes, not code or runtime. This gives you the best of both worlds: TypeScript for web/rapid development, Rust for performance/systems work.

### Can I use TypeScript and Rust together?

No. The SDKs are independent. Choose one per project. There is no FFI, no bindings, no shared runtime between them.

### Why no Python SDK yet?

Python SDK is planned (TODO) but not yet implemented. When it arrives, it will also be a native implementation, not a binding to Rust.

## Providers

### Can I use OpenAI-compatible endpoints?

Yes. Register a custom provider that points to the compatible endpoint:

```typescript
registerProvider({
  name: "groq",
  stream: (model, context, options) => {
    const client = new OpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey: "..." });
    // ...
  },
});
```

### Which providers are built in?

- Anthropic (Messages API)
- OpenAI (Chat Completions + Responses API)

### Can I add a new provider?

Yes. See [Adding a Provider Guide](/guides/adding-a-provider).

## Tools

### How many tools should I register?

Start with 2-3. Add more as needed. Too many tools can confuse the LLM and increase errors.

### Can tools call other tools?

Not directly. Tools execute independently. If you need tool chaining, use the agent loop — the LLM will call tools sequentially based on the results.

### How do I handle long tool outputs?

Truncate to ~4000 characters and add a note: `[... truncated, be more specific]`.

## Sessions

### Which session store should I use?

- Development: `InMemorySessionStore`
- Single-server production: `SQLiteSessionStore`
- Multi-server production: `RedisSessionStore` with SQLite cold store

### How do I fork a session?

```typescript
const forked = await sessions.fork(sessionId, messageIndex);
```

## Performance

### How fast is the Rust SDK?

The Rust SDK is built with opt-level 3, thin LTO, codegen-units 1, and strip symbols. It's designed for maximum throughput in async workloads.

### Does streaming add overhead?

No. Streaming is the default behavior, not an add-on. The SSE parsing happens as data arrives with minimal buffering.

## Next Steps

- [**Common Issues**](/troubleshooting/common-issues) — Quick fixes
- [**Contributing**](/contribute/setup) — How to contribute to Spectra
