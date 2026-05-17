# Quickstart

Build a working AI agent in 5 minutes. This guide walks you through creating an agent that can use tools, stream responses, and handle events.

::: tip Prerequisites
- TypeScript: `bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent`
- Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in your environment
:::

## Step 1: Create the Agent

```typescript
import { Agent } from "@singularity-ai/spectra-agent";

const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a helpful assistant.",
});
```

The `Agent` class is the core of Spectra. It handles:
- Streaming responses from the LLM
- Detecting tool calls in the response
- Executing tools and feeding results back
- Emitting events you can subscribe to

## Step 2: Stream the Response

```typescript
for await (const event of agent.run("What is 2+2?")) {
  if (event.type === "message_update") {
    const text = event.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    process.stdout.write(text);
  }
}
```

The `run()` method returns an `AsyncGenerator<AgentEvent>`. Each event is a discriminated union — check `event.type` to handle different event kinds.

::: tip
Use `process.stdout.write()` (not `console.log()`) for streaming text — it doesn't add newlines between chunks.
:::

## Step 3: Add a Tool

Tools let the agent perform actions beyond text generation. Define one with `defineTool()`:

```typescript
import { defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";

const calculatorTool = defineTool({
  name: "calculate",
  description: "Evaluate a math expression",
  parameters: z.object({
    expression: z.string().describe("The math expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    // In production, use a proper math parser — this is simplified
    const result = eval(expression);
    return {
      content: [{ type: "text", text: `${expression} = ${result}` }],
    };
  },
});
```

Key points:
- **Zod schema** — arguments are automatically validated and typed
- **`execute`** — receives typed args, returns a `ToolResult`
- **`description`** — the LLM uses this to decide when to call the tool

## Step 4: Attach the Tool and Run

```typescript
const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a helpful assistant. Use the calculator tool for math.",
  tools: [calculatorTool],
});

for await (const event of agent.run("What is 17 * 23?")) {
  switch (event.type) {
    case "message_update":
      const text = event.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      process.stdout.write(text);
      break;
    case "tool_execution_start":
      console.log(`\n[Tool] Calling ${event.toolName}...`);
      break;
    case "tool_execution_end":
      console.log(`\n[Result] ${event.isError ? "error" : "success"}`);
      break;
  }
}
```

## What Just Happened?

Here's the agent loop in action:

```
1. User: "What is 17 * 23?"
2. Agent streams to LLM
3. LLM responds with tool call: calculate(expression="17 * 23")
4. Agent executes the tool → result: "17 * 23 = 391"
5. Agent sends result back to LLM
6. LLM responds with final answer
7. Agent streams the answer back to you
```

All of this happens automatically. You just consume events from the stream.

## Full Working Example

```typescript
import { Agent, defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";

const calculatorTool = defineTool({
  name: "calculate",
  description: "Evaluate a math expression",
  parameters: z.object({
    expression: z.string().describe("The math expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    const result = eval(expression);
    return {
      content: [{ type: "text", text: `${expression} = ${result}` }],
    };
  },
});

const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a helpful assistant. Use the calculator tool for math.",
  tools: [calculatorTool],
});

for await (const event of agent.run("What is 17 * 23?")) {
  switch (event.type) {
    case "message_update":
      const text = event.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      process.stdout.write(text);
      break;
    case "tool_execution_start":
      console.log(`\n[Tool] Calling ${event.toolName}...`);
      break;
    case "tool_execution_end":
      console.log(`\n[Result] ${event.isError ? "error" : "success"}`);
      break;
  }
}
```

Save this as `agent.ts` and run:

```bash
bun run agent.ts
```

## Next Steps

- [**Agent Guide**](/typescript/agent) — Agent configuration, steering, follow-ups, abort
- [**Tools Guide**](/typescript/tools) — Zod schemas, hooks, execution modes
- [**Providers Guide**](/typescript/providers) — Switch between Anthropic and OpenAI
- [**Recipes**](/recipes/weather-agent) — Real-world examples you can copy-paste
