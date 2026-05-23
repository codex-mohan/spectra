# Web Search Agent

An agent that searches the web to answer questions with current information.

## What It Does

The agent uses a web search tool to find current information, then synthesizes an answer from the results.

## Prerequisites

```bash
bun add @mohanscodex/spectra-ai @mohanscodex/spectra-agent
export ANTHROPIC_API_KEY=sk-ant-...
```

## Full Code

```typescript
import { Agent, defineTool } from "@mohanscodex/spectra-agent";
import { z } from "zod";

async function searchWeb(query: string, numResults = 5): Promise<string> {
  // Replace with a real search API (SerpAPI, Tavily, etc.)
  const results = [
    { title: "Latest AI News", snippet: "AI developments in 2026 include..." },
    { title: "Tech Report", snippet: "New benchmarks show..." },
  ];
  return results.map(r => `${r.title}: ${r.snippet}`).join("\n\n");
}

const searchTool = defineTool({
  name: "web_search",
  description: "Search the web for current information. Use when the user asks about recent events, news, or facts that may have changed since your training data. Do NOT use for general knowledge questions.",
  parameters: z.object({
    query: z.string().describe("The search query. Be specific and include relevant keywords."),
    numResults: z.number().min(1).max(10).default(5).describe("Number of results to return"),
  }),
  execute: async ({ query, numResults }) => {
    const results = await searchWeb(query, numResults);
    return { content: [{ type: "text", text: results }] };
  },
});

const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a research assistant. Use the web_search tool to find current information before answering. Always cite your sources.",
  tools: [searchTool],
});

for await (const event of agent.run("What are the latest developments in AI?")) {
  if (event.type === "message_update") {
    const text = event.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    process.stdout.write(text);
  }
}
console.log();
```

## Customization

- Replace `searchWeb()` with Tavily, SerpAPI, or DuckDuckGo API
- Add a `summarize` tool to condense long search results
- Add source URLs to the tool output for citation

## Next Steps

- [**RAG Agent**](/recipes/rag-agent) — Agent with file reading
- [**Multi-Agent Research**](/recipes/multi-agent-research) — Delegation pattern
