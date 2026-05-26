# @singularity-ai/spectra-ai

**LLM provider abstraction layer with real-time streaming.**

A registry-based system for interacting with multiple LLM providers through a unified streaming interface. Built-in providers for Anthropic, OpenAI (Chat Completions + Responses API), Groq, and OpenRouter — all streaming SSE by default.

## Why Spectra?

Every agent framework I tried — **LangChain, LangGraph**, and others — followed the same pattern: endless layers of abstraction for things that are, at their core, just a simple loop. An agent takes input, calls a model, processes the response, dispatches tools, and repeats. That's it. A loop. Everything else — chains, graphs, runnables — is over-engineering dressed up as architecture. I lost months debugging framework bugs instead of building my product.

**Spectra takes the opposite approach.** No graphs. No chains. No runtime that owns your application. Just the primitives — a loop, a model call, a tool dispatch, a stream — that you assemble however you need.

## Features

- **Streaming-first** — Every provider streams SSE events. No polling, no buffering.
- **Provider registry** — Register, resolve, and swap providers at runtime. Extensible for custom implementations.
- **Typed events** — Fine-grained delta events (`text_delta`, `thinking_delta`, `toolcall_delta`) for real-time UI updates.
- **Abort support** — Pass an `AbortSignal` to cancel in-flight requests.
- **Zero SD KB at rest** — SDK is size-zero until streamed; no pre-bundled provider payloads.

## Installation

```bash
bun add @singularity-ai/spectra-ai
```

## Quick Start

```typescript
import { stream, complete, initProviders } from "@singularity-ai/spectra-ai";

// Registers anthropic, openai-completions, openai-responses, groq, openrouter
initProviders();

const model = {
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  provider: "anthropic",
  api: "anthropic-messages",
};

// Stream events as they arrive
const eventStream = stream(model, {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Hello!", timestamp: Date.now() }],
});

for await (const event of eventStream) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}

// Or accumulate into a complete message
const msg = await complete(model, {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Tell me a joke.", timestamp: Date.now() }],
});
console.log(msg.content);
```

## Architecture

```
                    ┌─────────────────────────┐
                    │    Provider Registry     │
                    │  (Map<string, Provider>) │
                    └──────┬──────────────────┘
                           │ resolve by model.provider
              ┌────────────┼────────────┬───────────────┐
              ▼            ▼            ▼               ▼
       ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐
       │anthropic │ │openai-     │ │openai-   │ │  groq /  │
       │          │ │completions │ │responses │ │openrouter│
       └──────────┘ └────────────┘ └──────────┘ └──────────┘
              │            │            │               │
              ▼            ▼            ▼               ▼
       ┌──────────────────────────────────────────────────┐
       │           AssistantMessageEventStream            │
       │   (AsyncIterable<AssistantMessageEvent>)         │
       └──────────────────────────────────────────────────┘
                          │
                    consume via
                for await...of
```

## Built-in Providers

| Provider name | API | Environment variable |
|---|---|---|
| `anthropic` | Anthropic Messages API | `ANTHROPIC_API_KEY` |
| `openai-completions` | OpenAI Chat Completions | `OPENAI_API_KEY` |
| `openai-responses` | OpenAI Responses API | `OPENAI_API_KEY` |
| `groq` | Groq (OpenAI-compatible) | `GROQ_API_KEY` |
| `openrouter` | OpenRouter (OpenAI-compatible) | `OPENROUTER_API_KEY` |

## API

### `stream(model, context, options?)`

Returns an `AssistantMessageEventStream` — an `AsyncIterable` that yields `AssistantMessageEvent` deltas.

### `complete(model, context, options?)`

Convenience wrapper. Returns a `Promise<AssistantMessage>` — accumulates the stream into the final message.

### `registerProvider(provider)`

Register a custom provider:

```typescript
import { registerProvider } from "@singularity-ai/spectra-ai";

registerProvider({
  name: "my-provider",
  stream: (model, context, options) => {
    // Return an AssistantMessageEventStream
    const stream = new AssistantMessageEventStream();
    // ... push events ...
    return stream;
  },
});
```

### `initProviders()`

Registers all built-in providers. Called automatically on import — safe to call multiple times (idempotent).

## Event Types

Each `AssistantMessageEvent` is a discriminated union:

| Event | Payload |
|---|---|
| `start` | Initial `partial: AssistantMessage` |
| `text_start` / `text_delta` / `text_end` | Text content delta |
| `thinking_start` / `thinking_delta` / `thinking_end` | Reasoning/thinking content delta |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | Tool call argument delta |
| `done` | Final `message: AssistantMessage` with `stopReason` |
| `error` | Error with `error: AssistantMessage` containing `errorMessage` |

## Key Types

```typescript
interface Model {
  id: string;           // e.g. "gpt-4o"
  name: string;         // display name
  provider: string;     // registered provider name
  api: string;          // API variant
  baseUrl?: string;     // custom base URL
  reasoning?: boolean;  // enable reasoning features
  maxTokens?: number;
  headers?: Record<string, string>;
}

interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

interface StreamOptions {
  signal?: AbortSignal;
  apiKey?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
}
```

## Message Types

- `UserMessage` — role `"user"`, content is a string or array of `TextContent | ImageContent` blocks
- `AssistantMessage` — role `"assistant"`, content is `(TextContent | ThinkingContent | ToolCall)[]`, includes `usage`, `stopReason`, `provider`, `model`, `responseId`, `errorMessage`
- `ToolResultMessage` — role `"toolResult"`, maps tool call results back to the model

## Usage

```typescript
import { complete } from "@singularity-ai/spectra-ai";

const msg = await complete(
  { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
  {
    systemPrompt: "You are a mathematician.",
    messages: [
      { role: "user", content: "What is 2+2?", timestamp: Date.now() },
    ],
    tools: [{ name: "calculate", description: "Calculate", parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"] } }],
  },
  { apiKey: process.env.OPENAI_API_KEY }
);
```

## Credits

Spectra was deeply inspired by **[pi-mono](https://github.com/badlogic/pi-mono)** by **Mario Zechner** — a beautifully minimal AI stack that proved an agent framework doesn't need layers of abstraction to be powerful.

## License

MIT
