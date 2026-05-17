# Weather Agent

A simple tool-using agent that fetches weather data for a location.

## What It Does

The agent receives a natural language query like "What's the weather in Tokyo?" and uses a weather tool to fetch real data.

## Prerequisites

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent
export ANTHROPIC_API_KEY=sk-ant-...
```

## Full Code

```typescript
import { Agent, defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";

// Simulated weather API — replace with a real API call
async function fetchWeather(location: string, unit: string): Promise<string> {
  const temps: Record<string, number> = {
    tokyo: 22, london: 15, "new york": 28, sydney: 18,
  };
  const temp = temps[location.toLowerCase()] ?? 20;
  const displayTemp = unit === "fahrenheit" ? (temp * 9) / 5 + 32 : temp;
  return `${displayTemp}°${unit === "fahrenheit" ? "F" : "C"}`;
}

const weatherTool = defineTool({
  name: "get_weather",
  description: "Get the current weather for a city. Use when the user asks about temperature, weather conditions, or climate for a specific location.",
  parameters: z.object({
    location: z.string().describe("City name (e.g., 'Tokyo', 'London')"),
    unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Temperature unit"),
  }),
  execute: async ({ location, unit }) => {
    const weather = await fetchWeather(location, unit);
    return { content: [{ type: "text", text: `The current temperature in ${location} is ${weather}.` }] };
  },
});

const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a weather assistant. Use the get_weather tool to answer weather questions.",
  tools: [weatherTool],
});

console.log("Ask me about the weather anywhere!\n");

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
      console.log(`\n🔧 Calling ${event.toolName}...`);
      break;
    case "tool_execution_end":
      console.log(event.isError ? "\n❌ Tool failed" : "\n✅ Tool succeeded");
      break;
  }
}
console.log();
```

## How It Works

1. User asks "What's the weather in Tokyo?"
2. Agent streams to Claude
3. Claude detects it needs weather data → calls `get_weather(location="Tokyo", unit="celsius")`
4. Tool executes → returns "The current temperature in Tokyo is 22°C"
5. Agent sends result back to Claude
6. Claude composes a natural language response
7. Response streams to the user

## Customization

- Replace `fetchWeather()` with a real API call (OpenWeatherMap, WeatherAPI, etc.)
- Add more parameters (humidity, wind speed, forecast)
- Add `beforeToolCall` hook to validate locations against a known list

## Next Steps

- [**Web Search Agent**](/recipes/web-search-agent) — Agent with external API calls
- [**Tool Design Patterns**](/guides/tool-design-patterns) — Writing effective tools
