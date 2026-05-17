# TypeScript SDK Overview

The TypeScript SDK consists of three packages that work together to provide a complete AI agent framework.

## Packages

| Package | Purpose | Install |
|---|---|---|
| `@singularity-ai/spectra-ai` | LLM provider layer — streaming, SSE parsing, provider registry | `bun add @singularity-ai/spectra-ai` |
| `@singularity-ai/spectra-agent` | Agent orchestration — run loop, tool dispatch, event streaming | `bun add @singularity-ai/spectra-agent` |
| `@singularity-ai/spectra-app` | Production features — sessions, rate limiting, multi-agent | `bun add @singularity-ai/spectra-app` |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Your Application                    │
├─────────────────────────────────────────────────────┤
│  @singularity-ai/spectra-agent                      │
│  ┌───────────┐  ┌────────────┐  ┌────────────────┐  │
│  │  Agent     │  │ defineTool │  │  AgentEvent    │  │
│  │  (run loop)│  │ (Zod + exec)│  │  (streaming)   │  │
│  └─────┬─────┘  └────────────┘  └────────────────┘  │
│        │                                             │
│        ▼                                             │
│  @singularity-ai/spectra-ai                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Provider      │  │ EventStream  │  │  Registry │  │
│  │ (Anthropic)   │  │ (AsyncIter)  │  │           │  │
│  ├──────────────┤  ├──────────────┤  ├───────────┤  │
│  │ Provider      │  │              │  │           │  │
│  │ (OpenAI)      │  │              │  │           │  │
│  └──────────────┘  └──────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────┘
```

## Data Flow

```
User input → Agent.run()
  → Provider.stream() → SSE events
  → EventStream.push() → deltas
  → accumulate AssistantMessage
  → detect tool calls
  → executeTools() (parallel or sequential)
  → yield AgentEvent
  → repeat until end-of-turn
```

## Core Concepts

### 1. Agent

The `Agent` class orchestrates multi-turn conversations. It streams to the LLM, accumulates response deltas, detects tool calls, executes them, and feeds results back — all automatically.

```typescript
const agent = new Agent({
  model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are helpful.",
  tools: [myTool],
});

for await (const event of agent.run("Hello")) {
  // handle events
}
```

### 2. Tools

Tools are defined with Zod schemas for automatic argument validation:

```typescript
const tool = defineTool({
  name: "search",
  description: "Search the web",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ content: [{ type: "text", text: await search(query) }] }),
});
```

### 3. Providers

Providers handle the actual LLM communication. Built-in: Anthropic, OpenAI Chat Completions, OpenAI Responses. Register custom ones:

```typescript
registerProvider({ name: "my-provider", stream: (model, context, options) => { ... } });
```

### 4. Events

The agent emits typed events during execution. Consume via `for await...of` or `agent.subscribe()`:

```typescript
for await (const event of agent.run("Hello")) {
  switch (event.type) {
    case "message_update": /* streaming text */ break;
    case "tool_execution_start": /* tool about to run */ break;
    case "tool_execution_end": /* tool finished */ break;
    case "agent_end": /* run complete */ break;
  }
}
```

## Next Steps

- [**Agent**](/typescript/agent) — Configuration, run(), subscribe(), steer(), followUp()
- [**Tools**](/typescript/tools) — defineTool(), hooks, execution modes
- [**Providers**](/typescript/providers) — Built-in providers, custom registration, API keys
- [**Events**](/typescript/events) — Event types, generator vs subscriber patterns
