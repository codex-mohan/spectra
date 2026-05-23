---
layout: home

hero:
  name: Spectra
  text: Minimal, ultra-fast AI agent framework
  tagline: A construction kit, not a pre-built house. Independent TypeScript and Rust SDKs — no shared runtime, no bindings, no FFI.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/introduction
    - theme: alt
      text: TypeScript SDK
      link: /typescript/overview
    - theme: alt
      text: Rust SDK
      link: /rust/overview
    - theme: alt
      text: View on GitHub
      link: https://github.com/codex-mohan/spectra

features:
  - icon: ⚡
    title: Streaming-First
    details: All LLM providers stream SSE by default. Event-driven architecture with real-time token deltas, tool call observation, and incremental UI updates.
  - icon: 🔀
    title: Multi-Language
    details: TypeScript and Rust SDKs with the same API surface and behavior. Each is a complete, independent native implementation — not bindings, not wrappers.
  - icon: 🔌
    title: Provider Abstraction
    details: Built-in Anthropic and OpenAI support. Register any custom LLM provider with a single function call.
  - icon: 🛠️
    title: Tool System
    details: Define tools with Zod schemas (TypeScript) or trait implementations (Rust). Automatic argument validation, parallel or sequential execution.
  - icon: 🔄
    title: Agent Loop
    details: Multi-turn conversations with automatic tool dispatch, delta accumulation, and event streaming. Stream, accumulate, dispatch, repeat.
  - icon: 🪝
    title: Extension Hooks
    details: Before/after tool call hooks, context transformation, and composable middleware. Inject logging, rate limiting, or audit trails.
---

## Why Spectra?

Most AI agent frameworks are pre-built houses — you get a fixed architecture and fight to customize it. Spectra is a **construction kit**. Ship only primitives that let you build anything beyond the core without fighting the framework.

| | Spectra | LangChain | CrewAI | Vercel AI SDK |
|---|---|---|---|---|
| **Philosophy** | Construction kit | Pre-built house | Pre-built house | UI-focused toolkit |
| **Languages** | TypeScript + Rust | Python + JS | Python | TypeScript |
| **SDK Model** | Independent native | Shared runtime | Shared runtime | Single runtime |
| **Streaming** | First-class | Supported | Limited | First-class |
| **Tool System** | Zod / traits | Function calling | Agent delegation | Tool calling |
| **Performance** | Ultra-fast (Rust opt-level 3) | Python overhead | Python overhead | JS runtime |
| **Bundle Size** | Minimal | Large | Large | Moderate |
| **Learning Curve** | Low (primitives only) | High (many abstractions) | Medium | Low |

## Who Is This For?

- **You want control** over the agent loop, not a black box
- **You need performance** — Rust SDK for systems-level work
- **You build for the web** — TypeScript SDK with streaming UI patterns
- **You hate vendor lock-in** — swap providers without rewriting your agent
- **You value simplicity** — 4 core concepts, not 47 abstractions

## Quick Preview

::: code-group

```typescript [TypeScript]
import { Agent, defineTool } from "@mohanscodex/spectra-agent";
import { z } from "zod";

const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a helpful assistant.",
  tools: [
    defineTool({
      name: "search",
      description: "Search the web",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({
        content: [{ type: "text", text: await webSearch(query) }],
      }),
    }),
  ],
});

for await (const event of agent.run("What's new in AI?")) {
  if (event.type === "message_update") {
    process.stdout.write(event.message.content
      .filter(c => c.type === "text")
      .map(c => c.text).join(""));
  }
}
```

```rust [Rust]
use spectra_rs::{AgentBuilder, Model, Tool, ToolResult};
use spectra_http::OpenAIClient;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?;

    let agent = AgentBuilder::new()
        .model(Model::openai("gpt-4o"))
        .system_prompt("You are a helpful assistant.")
        .tool(SearchTool)
        .build(client);

    let (mut rx, _, _) = agent.run("What's new in AI?").await?;
    while let Some(Ok(event)) = stream.next().await {
        // Handle streaming events
    }

    Ok(())
}
```

:::

## Next Steps

- [**Introduction**](/getting-started/introduction) — What is Spectra, why it exists
- [**Installation**](/getting-started/installation) — Set up TypeScript or Rust
- [**Quickstart**](/getting-started/quickstart) — Build your first agent in 5 minutes
- [**Recipes**](/recipes/weather-agent) — Real-world copy-paste examples
