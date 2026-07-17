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
| `contextMessages` | `ContextMessage[]` | `[]` | Request-only developer context; never persisted in conversation history |
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

Use `configure()` between runs to atomically replace the model, system prompt, request-only context messages, tools, turn limit, execution mode, and stream options without discarding conversation history:

```typescript
agent.configure({
  model: nextModel,
  systemPrompt: "Use the new operating mode.",
  contextMessages: [{ role: "developer", content: "Use plan mode for this turn." }],
  tools: nextTools,
  maxTurns: 20,
  streamOptions: { thinkingEffort: "high" },
});
```

`configure()` throws while `agent.isStreaming` is true. A single `run()` therefore keeps one fixed runtime configuration; queue a follow-up or wait for the current run to finish before reconfiguring.

### Request-Time Context

Use `contextMessages` for agent modes, tenant policy, retrieved context, and other instructions that apply to a request but must not become durable conversation history. Spectra sends them on every model iteration in the run, including tool loops, without appending them to `agent.messages`:

```typescript
const agent = new Agent({
  model,
  systemPrompt: "Stable application and project instructions.",
  contextMessages: [
    { role: "developer", content: "Operate in read-only planning mode." },
  ],
});
```

OpenAI transports receive native `developer` messages. Anthropic and OpenAI-compatible transports without developer-role support receive equivalent tagged context immediately before the latest user input. This placement preserves the longest stable prompt prefix when context changes between turns.

`beforeModelCall` may replace `contextMessages` or the request message copy for one model iteration. Hook results are not persisted, and transport retries reuse the already-prepared request:

```typescript
const agent = new Agent({
  model,
  contextMessages: [{ role: "developer", content: "Default request context." }],
  beforeModelCall: async ({ iteration }) => iteration === 1
    ? { contextMessages: [{ role: "developer", content: "First-iteration context." }] }
    : undefined,
});
```

Throwing from `beforeModelCall` aborts that request and emits an `audit` event with `eventType: "hook_error"`. The hook cannot alter the stable system prompt or registered tool set; use `configure()` between runs for those changes.

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
