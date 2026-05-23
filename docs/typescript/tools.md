# Tools

Define tools with Zod schemas for automatic argument validation and type inference.

## Creating a Tool

```typescript
import { defineTool } from "@mohanscodex/spectra-agent";
import { z } from "zod";

const weatherTool = defineTool({
  name: "get_weather",
  description: "Get current weather for a location",
  parameters: z.object({
    location: z.string().describe("City name"),
    unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  }),
  execute: async (args, { signal, onUpdate }) => {
    // args is fully typed as z.infer<typeof parameters>
    onUpdate?.({ content: [{ type: "text", text: "Fetching weather..." }] });
    const result = await fetchWeather(args.location, args.unit);
    return { content: [{ type: "text", text: result }] };
  },
});
```

### Key Points

- **Zod schema** — arguments are automatically validated before `execute` is called
- **Type inference** — `args` is typed as `z.infer<T>` — no manual casting needed
- **`signal`** — AbortSignal for cancellation support
- **`onUpdate`** — Report partial progress during long-running operations

## Tool Execution Modes

### Parallel (Default)

All tool calls execute concurrently:

```typescript
const agent = new Agent({
  model,
  tools: [searchTool, weatherTool, timeTool],
  toolExecution: "parallel", // default
});
```

### Sequential

Tool calls execute one after another:

```typescript
const agent = new Agent({
  model,
  tools: [searchTool, summarizeTool],
  toolExecution: "sequential",
});
```

::: tip
Use `sequential` when tools depend on each other's output, or when you want to rate-limit API calls.
:::

## Hooks

Intercept tool execution for logging, gating, or result transformation:

```typescript
const agent = new Agent({
  model,
  tools: [sensitiveTool],
  beforeToolCall: async ({ toolCall, args }) => {
    // Block dangerous operations
    if (toolCall.name === "delete_file") {
      return { block: true, reason: "File deletion is not allowed" };
    }
    // Log all tool calls
    console.log(`Calling ${toolCall.name} with`, args);
  },
  afterToolCall: async ({ result, toolCall }) => {
    // Filter sensitive data from results
    if (toolCall.name === "read_secret") {
      return { content: [{ type: "text", text: "[REDACTED]" }] };
    }
  },
});
```

### Hook Return Values

| Return | Effect |
|---|---|
| `undefined` | Continue normally |
| `{ block: true, reason: "..." }` | Skip tool execution, return error to LLM |
| `{ content: [...] }` (in `afterToolCall`) | Replace tool result |

## Tool Context

The `execute` function receives a context object:

```typescript
execute: async (args, context) => {
  context.toolCallId;  // Unique ID for this tool call
  context.signal;      // AbortSignal — check for cancellation
  context.onUpdate;    // Report partial progress
}
```

### Reporting Progress

For long-running tools, report progress to keep the user informed:

```typescript
const downloadTool = defineTool({
  name: "download",
  description: "Download a file",
  parameters: z.object({ url: z.string() }),
  execute: async ({ url }, { onUpdate }) => {
    onUpdate?.({ content: [{ type: "text", text: "Connecting..." }] });

    const response = await fetch(url);
    const total = response.headers.get("content-length");
    let downloaded = 0;

    for await (const chunk of response.body!) {
      downloaded += chunk.length;
      const pct = total ? Math.round((downloaded / Number(total)) * 100) : "?";
      onUpdate?.({ content: [{ type: "text", text: `Downloading... ${pct}%` }] });
    }

    return { content: [{ type: "text", text: `Downloaded ${downloaded} bytes` }] };
  },
});
```

## Prompt Guidelines

Help the LLM use tools correctly by providing clear descriptions:

```typescript
defineTool({
  name: "search_web",
  description: "Search the web for current information. Use when the user asks about recent events, news, or facts that may have changed since your training data.",
  parameters: z.object({
    query: z.string().describe("The search query. Be specific and include relevant keywords."),
    numResults: z.number().min(1).max(10).default(5).describe("Number of results to return"),
  }),
  // ...
});
```

::: tip
The `description` field is the most important part of tool definition. The LLM uses it to decide when to call the tool. Be specific about when to use it.
:::

## Next Steps

- [**Agent**](/typescript/agent) — How tools integrate with the agent loop
- [**Error Handling Guide**](/guides/error-handling) — Retry patterns, circuit breakers
- [**Tool Design Guide**](/guides/tool-design-patterns) — Best practices for effective tools
