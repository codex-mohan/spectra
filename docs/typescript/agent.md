# Agent

The `Agent` class orchestrates multi-turn conversations with automatic tool dispatch and streaming event delivery.

## Creating an Agent

```typescript
import { Agent } from "@mohanscodex/spectra-agent";

const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a helpful assistant.",
  maxTurns: 10,
  toolExecution: "parallel",
});
```

### AgentConfig

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `Model` | required | LLM model configuration |
| `systemPrompt` | `string` | — | System prompt for the agent |
| `tools` | `AgentTool[]` | `[]` | Registered tools |
| `maxTurns` | `number` | unlimited | Max LLM turns before stopping |
| `toolExecution` | `"parallel" \| "sequential"` | `"parallel"` | Tool execution strategy |
| `beforeToolCall` | `BeforeToolCallHook` | — | Called before each tool execution |
| `afterToolCall` | `AfterToolCallHook` | — | Called after each tool execution |
| `transformContext` | `TransformContextHook` | — | Transform messages before LLM call |
| `beforeModelCall` | `BeforeModelCallHook` | — | Prepares request-only messages before each model iteration |
| `convertToLlm` | `(messages) => Message[]` | — | Converts request messages immediately before provider streaming |
| `streamOptions` | `StreamOptions` | — | Provider stream options such as thinking effort |
| `steeringMode` / `followUpMode` | `AgentQueueMode` | `"all"` | Queuing behavior for steering and follow-ups |
| `getApiKey` | `GetApiKeyHook` | — | Dynamic API key resolution |


### Runtime Configuration

Use `configure()` between runs to atomically replace the model, system prompt, tools, turn limit, execution mode, and stream options without discarding conversation history:

```typescript
agent.configure({
  model: nextModel,
  systemPrompt: "Use the new operating mode.",
  tools: nextTools,
  maxTurns: 20,
  streamOptions: { thinkingEffort: "high" },
});
```

`configure()` throws while `agent.isStreaming` is true. A single `run()` therefore keeps one fixed runtime configuration; queue a follow-up or wait for the current run to finish before reconfiguring.

### Request-Time Context

`beforeModelCall` can add request-only messages before each model iteration. Its result is not appended to `agent.messages`, and transport retries reuse the prepared request context. The configured system prompt remains stable for the complete run.

```typescript
const agent = new Agent({
  model,
  beforeModelCall: async ({ messages, iteration }) => ({
    messages: [
      ...messages,
      { role: "user", content: `Request iteration: ${iteration}`, timestamp: Date.now() },
    ],
  }),
});
```

Throwing from `beforeModelCall` aborts that request and emits an `audit` event with `eventType: "hook_error"`. The hook cannot alter the system prompt or registered tool set; use `configure()` between runs for those changes.
::: tip
The `model` object requires four fields: `id` (model identifier), `name` (display name), `provider` (registry key), and `api` (API type within the provider).
:::

## Running the Agent

### Generator Pattern (Recommended)

```typescript
for await (const event of agent.run("Tell me a joke")) {
  switch (event.type) {
    case "message_update":
      // Streaming content delta
      const text = event.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      process.stdout.write(text);
      break;
    case "tool_execution_start":
      console.log(`\n[Tool] ${event.toolName}`);
      break;
    case "tool_execution_end":
      console.log(`\n[Result] ${event.isError ? "error" : "ok"}`);
      break;
    case "agent_end":
      console.log("\n[Done]");
      break;
  }
}
```

### Subscriber Pattern

```typescript
const unsubscribe = agent.subscribe((event, signal) => {
  if (event.type === "tool_execution_update") {
    console.log("Tool progress:", event.partialResult);
  }
});

await agent.run("Search for something");
unsubscribe();
```

::: warning
The subscriber pattern is useful for UI components that need to observe agent state without consuming the event stream directly.
:::

## Steering and Queues

Inject messages mid-stream or queue follow-ups:

```typescript
// Inject mid-stream (processed at next turn boundary)
agent.steer("Be more concise");

// Queue after current run completes
agent.followUp("What about X?");

// Abort current run
agent.abort();

// Clear all state
agent.reset();
```

## State Inspection

```typescript
agent.messages;           // Message[] — current transcript
agent.isStreaming;        // boolean — whether a run is active
agent.streamingMessage;   // AssistantMessage | undefined — partial message
agent.pendingToolCalls;   // ReadonlySet<string> — tool calls in flight
agent.errorMessage;       // string | undefined — last error, if any
```

## Multi-Turn Conversations

The agent automatically loops until the LLM stops calling tools or `maxTurns` is reached:

```
Turn 1: User asks question → LLM calls tool → Agent executes tool
Turn 2: LLM receives tool result → LLM calls another tool → Agent executes
Turn 3: LLM receives tool result → LLM responds with text → Agent yields answer
```

Each turn emits `turn_start` and `turn_end` events, letting you track progress.

## Error Handling

```typescript
try {
  for await (const event of agent.run("Hello")) {
    // handle events
  }
} catch (error) {
  // Check agent.errorMessage for the last error
  console.error(agent.errorMessage);
}
```

::: warning
The agent does not throw for LLM API errors during streaming — it emits them as events. Check `event.type` for error conditions.
:::

## Next Steps

- [**Tools**](/typescript/tools) — Define tools with Zod schemas, hooks, execution modes
- [**Events**](/typescript/events) — All event types and when they fire
- [**Providers**](/typescript/providers) — Switch between Anthropic and OpenAI
