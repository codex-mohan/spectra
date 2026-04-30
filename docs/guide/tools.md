# Tools

Define tools with Zod schemas for automatic argument validation.

## Creating a Tool

```typescript
import { defineTool } from "@spectra/agent";
import { z } from "zod";

const weatherTool = defineTool({
  name: "get_weather",
  description: "Get current weather for a location",
  parameters: z.object({
    location: z.string().describe("City name"),
    unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  }),
  execute: async (args, { signal, onUpdate }) => {
    // args is fully typed as z.infer<T>
    onUpdate?.({ content: [{ type: "text", text: "Fetching..." }] });
    const result = await fetchWeather(args.location, args.unit);
    return { content: [{ type: "text", text: result }] };
  },
});
```

## Tool Execution Modes

- **parallel** (default): All tool calls execute concurrently
- **sequential**: Tool calls execute one after another

```typescript
const agent = new Agent({
  model,
  tools: [weatherTool, searchTool],
  toolExecution: "sequential", // or "parallel"
});
```

## Hooks

```typescript
const agent = new Agent({
  model,
  tools: [sensitiveTool],
  beforeToolCall: async ({ toolCall, args }) => {
    if (toolCall.name === "delete_file") {
      return { block: true, reason: "Not allowed" };
    }
  },
  afterToolCall: async ({ result, toolCall }) => {
    // Modify or log results
    return { content: [{ type: "text", text: "Filtered" }] };
  },
});
```
