# @mohanscodex/spectra-ai

**LLM provider abstraction layer with real-time streaming.**

A registry-based system for interacting with multiple LLM providers through a unified streaming interface. Built-in providers include Anthropic, OpenAI Chat Completions, OpenAI Responses, OpenRouter, OpenAI-compatible cloud providers, coding-plan providers, and local runtimes such as Ollama, LM Studio, llama.cpp, vLLM, and SGLang.

## Features

- **Streaming-first** — Every provider streams SSE events. No polling, no buffering.
- **Provider registry** — Register, resolve, and swap providers at runtime. Extensible for custom implementations.
- **Typed events** — Fine-grained delta events (`text_delta`, `thinking_delta`, `toolcall_delta`) for real-time UI updates.
- **File content support** — User messages can include text, images, and local file blocks with filename/path/MIME/size metadata.
- **Usage metadata** — Assistant messages include token usage, cache read/write, provider, model, response ID, and stop reason.
- **Abort support** — Pass an `AbortSignal` to cancel in-flight requests.

## Installation

```bash
bun add @mohanscodex/spectra-ai
```

## Quick Start

```typescript
import { stream, complete, initProviders } from "@mohanscodex/spectra-ai";

// Registers built-in cloud, coding-plan, and local OpenAI-compatible providers
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
       │anthropic │ │openai-     │ │openai-   │ │OpenAI-  │
       │          │ │completions │ │responses │ │compatible│
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
| `openrouter` | OpenRouter (OpenAI-compatible) | `OPENROUTER_API_KEY` |
| `groq`, `xai`, `deepseek`, `mistral`, `cerebras`, `google`, `fireworks-ai`, `togetherai`, `perplexity`, `cohere`, `moonshotai`, and others | OpenAI-compatible APIs | Provider-specific API key |
| `ollama`, `lm-studio`, `llama-cpp`, `vllm`, `sglang` | Local OpenAI-compatible runtimes | No API key; base URLs configurable with `*_BASE_URL` env vars |
| `kimi-code`, `opencode-go`, `alibaba-coding-plan`, `zai-coding-plan`, and related coding-plan providers | OpenAI-compatible coding endpoints | Provider-specific API key or OAuth flow in Spectra Code |

## API

### `stream(model, context, options?)`

Returns an `AssistantMessageEventStream` — an `AsyncIterable` that yields `AssistantMessageEvent` deltas.

### `complete(model, context, options?)`

Convenience wrapper. Returns a `Promise<AssistantMessage>` — accumulates the stream into the final message.

### `registerProvider(provider)`

Register a custom provider:

```typescript
import { registerProvider } from "@mohanscodex/spectra-ai";

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

- `UserMessage` — role `"user"`, content is a string or array of `TextContent | ImageContent | FileContent` blocks
- `AssistantMessage` — role `"assistant"`, content is `(TextContent | ThinkingContent | ToolCall)[]`, includes `usage`, `stopReason`, `provider`, `model`, `responseId`, `errorMessage`
- `ToolResultMessage` — role `"toolResult"`, maps tool call results back to the model

## Usage

```typescript
import { complete } from "@mohanscodex/spectra-ai";

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

## License

MIT
