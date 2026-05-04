# Getting Started

## Installation

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent
```

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
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a helpful assistant.",
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
      console.log(`\n[Tool] ${event.toolName}`);
      break;
    case "tool_execution_end":
      console.log(`\n[Result] ${event.isError ? "error" : "ok"}`);
      break;
  }
}
```
