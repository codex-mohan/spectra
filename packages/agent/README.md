# @singularity-ai/spectra-agent

**Agent runtime with multi-turn tool dispatch and streaming event delivery.**

Orchestrates conversations with LLMs: streams responses, dispatches tool calls (parallel or sequential), injects intermediate messages mid-turn, and emits typed events for every phase of execution.

## Features

- **Multi-turn loop** — Automatically feeds tool results back to the model. Configurable `maxTurns`.
- **Tool execution** — Parallel or sequential dispatch. Tools defined with Zod schemas for type-safe argument validation.
- **Streaming events** — AsyncGenerator yields `AgentEvent` discriminated unions. Subscribe via `for await` or side-channel listeners.
- **Hooks** — `beforeToolCall` (block/modify), `afterToolCall` (modify results), `transformContext` (rewrite messages), `getApiKey` (dynamic key resolution).
- **Steering & follow-up queues** — Inject messages mid-turn (`steer()`) or queue them for the next run (`followUp()`).
- **Automatic retry** — Exponential backoff (up to 3 retries) for transient API errors. Configurable max delay.
- **Abort support** — `agent.abort()` cancels in-flight requests with `AbortController`.
- **Subscriber pattern** — Push-based listeners for side-channel logging, metrics, or persistence.

## Installation

```bash
bun add @singularity-ai/spectra-agent
```

Depends on `@singularity-ai/spectra-ai` (automatically resolved as a workspace dependency).

## Quick Start

```typescript
import { Agent, defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";

const weatherTool = defineTool({
  name: "get_weather",
  description: "Get current weather for a location",
  parameters: z.object({
    location: z.string().describe("City name"),
  }),
  execute: async ({ location }) => ({
    content: [{ type: "text", text: `The weather in ${location} is sunny.` }],
  }),
});

const agent = new Agent({
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
  systemPrompt: "You are a helpful assistant with weather data.",
  tools: [weatherTool],
});

for await (const event of agent.run("What's the weather in Tokyo?")) {
  switch (event.type) {
    case "message_update":
      const text = event.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      process.stdout.write(text);
      break;
    case "tool_execution_start":
      console.log(`\n[Tool: ${event.toolName}]`);
      break;
    case "tool_execution_end":
      console.log(`\n[Result: ${event.isError ? "error" : "ok"}]`);
      break;
    case "agent_end":
      console.log("\nDone. Transcript length:", event.messages.length);
      break;
  }
}
```

## Architecture

```
agent.run("Hello")
  │
  ├─ emit agent_start
  ├─ emit message_start/user
  ├─ emit turn_start
  │
  ├─ LLM stream (via @spectra-ai)
  │   ├─ emit message_start (assistant)
  │   ├─ emit message_update (deltas)
  │   └─ emit message_end (complete)
  │
  ├─ toolCalls detected?
  │   ├─ NO  → emit turn_end → emit agent_end → done
  │   └─ YES → prepare (beforeToolCall hook)
  │              ├─ sequential: execute one-by-one
  │              └─ parallel: prepare all, then execute concurrently
  │             → attach tool results to transcript
  │             → emit turn_end
  │             → check steering queue / follow-up queue
  │             → loop back to LLM stream
  │
  └─ agent_end (final transcript in event.messages)
```

## API

### `new Agent(config)`

```typescript
interface AgentConfig {
  model: Model;                         // LLM model to use
  systemPrompt?: string;                // system prompt
  tools?: AgentTool[];                  // registered tools
  maxTurns?: number;                    // max loop iterations (default: unlimited)
  toolExecution?: "parallel" | "sequential";  // default: "parallel"
  beforeToolCall?: (ctx, signal?) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (ctx, signal?) => Promise<AfterToolCallResult | undefined>;
  transformContext?: (messages, signal?) => Promise<Message[]>;
  getApiKey?: (provider) => string | undefined | Promise<string | undefined>;
}
```

### `agent.run(input)`

Returns `AsyncGenerator<AgentEvent>`. Input is a `string`, `Message`, or `Message[]`.

### `agent.subscribe(listener)`

Returns an unsubscribe function. Listeners fire for every event in parallel with the generator consumer.

```typescript
const unsub = agent.subscribe((event, signal) => {
  if (event.type === "tool_execution_start") {
    metrics.counter.inc({ tool: event.toolName });
  }
});
```

### `agent.steer(message)` / `agent.followUp(message)`

- `steer()` — Injects a user message into the current run loop. Processed on the next turn.
- `followUp()` — Queues a message for after the current `run()` completes.

### State

```typescript
agent.messages           // Message[] — full conversation transcript
agent.isStreaming        // boolean — run in progress
agent.streamingMessage   // AssistantMessage | undefined
agent.pendingToolCalls   // Set<string> — tool call IDs in flight
agent.errorMessage       // string | undefined
agent.signal             // AbortSignal | undefined
```

### `agent.abort()` / `agent.reset()` / `agent.restoreHistory(messages)`

## Tool Definition

```typescript
import { defineTool, textResult, errorResult } from "@singularity-ai/spectra-agent";
import { z } from "zod";

const searchTool = defineTool({
  name: "search_web",
  description: "Search the web for information",
  parameters: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().optional().default(5),
  }),
  execute: async (args, { toolCallId, signal, onUpdate }) => {
    // args is fully typed: { query: string; maxResults?: number }
    if (!args.query) return errorResult("Query is required");
    onUpdate?.({ content: [{ type: "text", text: "Searching..." }] });
    const results = await fetchResults(args.query, args.maxResults, signal);
    return textResult(results);
  },
});
```

## Events

| Event | When | Payload |
|---|---|---|
| `agent_start` | Run begins | — |
| `agent_end` | Run complete | `messages: Message[]` |
| `turn_start` | LLM turn begins | — |
| `turn_end` | Turn complete | `message`, `toolResults` |
| `message_start` | Message added to transcript | `message` |
| `message_update` | Assistant message delta | `message`, `assistantMessageEvent` |
| `message_end` | Message fully formed | `message` |
| `tool_execution_start` | Tool call begins | `toolCallId`, `toolName`, `args` |
| `tool_execution_update` | Tool reports partial progress | `toolCallId`, `toolName`, `partialResult` |
| `tool_execution_end` | Tool call completes | `toolCallId`, `toolName`, `result`, `isError` |

## Hooks

### `beforeToolCall`

Block or modify a tool call before execution:

```typescript
beforeToolCall: async ({ toolCall, args }) => {
  if (toolCall.name === "delete_file") {
    return { block: true, reason: "Not allowed in current context" };
  }
}
```

### `afterToolCall`

Transform tool results:

```typescript
afterToolCall: async ({ result, isError }) => {
  if (isError) return { content: [{ type: "text", text: "Tool failed, retrying..." }], isError: false };
}
```

### `transformContext`

Rewrite messages before sending to the LLM:

```typescript
transformContext: async (messages) => {
  return messages.filter(m => m.role !== "system");
}
```

### `getApiKey`

Resolve API keys dynamically:

```typescript
getApiKey: async (provider) => {
  if (provider === "anthropic") return process.env.ANTHROPIC_KEY;
  return process.env.OPENAI_API_KEY;
}
```

## Retry Behavior

The agent retries LLM calls up to 3 times with exponential backoff (1s, 2s, 4s) capped at `maxRetryDelayMs` (default 30s). Does not retry on:
- 4xx client errors (400, 401, 403, 404)
- Aborted requests

## License

MIT
