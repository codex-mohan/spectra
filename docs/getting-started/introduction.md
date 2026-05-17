# Introduction

> Spectra is a construction kit, not a pre-built house.

## What Is Spectra?

Spectra is a minimal, ultra-fast, multi-language AI agent framework. It provides the **primitives** you need to build AI agents — streaming, tool execution, event systems, session management — without imposing a specific architecture on you.

Each SDK (TypeScript, Rust) is a **complete, independent native implementation**. They share design patterns and type shapes, not code or runtime. There are no bindings, no FFI, no shared runtime between them.

## Core Philosophy

### Construction Kit, Not Pre-Built House

Most AI frameworks give you a fixed architecture and make you fight to customize it. Spectra ships only **primitives** — the minimal building blocks that let you construct any pattern you need:

- Single agent with tools
- Multi-agent delegation
- RAG pipelines
- Streaming chat interfaces
- Background job processing

You compose these primitives. The framework doesn't compose them for you.

### Streaming-First

Every LLM provider streams Server-Sent Events (SSE) by default. Spectra's architecture is built around this:

1. **Stream** tokens from the LLM
2. **Accumulate** deltas into a complete message
3. **Dispatch** tool calls when the model requests them
4. **Repeat** until the turn ends

This isn't an afterthought — it's the core data flow.

### Independent SDKs

| | TypeScript | Rust |
|---|---|---|
| **Packages** | `@singularity-ai/spectra-ai`, `@singularity-ai/spectra-agent` | `spectra-rs`, `spectra-http` |
| **Runtime** | Node.js / Bun | Tokio async runtime |
| **Error handling** | TypeScript errors, Zod validation | `thiserror` + `miette` diagnostics |
| **Tool definition** | `defineTool()` with Zod schemas | `Tool` trait implementation |
| **Agent** | `Agent` class with `run()` | `AgentBuilder` with `prompt()` |
| **Events** | `EventStream` (AsyncIterable) | `mpsc::channel` + `EventChannel` (broadcast) |

Both SDKs produce the same behavior — streaming, tool dispatch, event emission — but are implemented natively in their respective languages.

## Why Not LangChain, CrewAI, or Vercel AI SDK?

| Concern | LangChain | CrewAI | Vercel AI SDK | Spectra |
|---|---|---|---|---|
| **Abstraction depth** | 47+ concepts to learn | Role-based agent paradigm | UI-focused, limited agent loop | 4 core concepts |
| **Performance** | Python overhead | Python overhead | JS only | Rust opt-level 3 available |
| **Vendor lock-in** | Tied to LangChain ecosystem | Tied to CrewAI patterns | Tied to Vercel ecosystem | Provider-agnostic |
| **Customization** | Hard to override internals | Fixed agent roles | Focused on UI, not agents | Primitives, not presets |
| **Bundle size** | Large dependency tree | Large dependency tree | Moderate | Minimal |

**Use LangChain if:** You want a comprehensive, batteries-included framework with every integration pre-built.

**Use CrewAI if:** You need role-based multi-agent collaboration out of the box.

**Use Vercel AI SDK if:** You're building a Next.js chat UI and don't need agent loops.

**Use Spectra if:** You want control over the agent loop, need performance, value simplicity, or are building in Rust.

## When NOT to Use Spectra

- You want a drag-and-drop agent builder
- You need 100+ pre-built integrations on day one
- You're building a simple chatbot without tool use
- You need Python SDK (it's TODO)

## Architecture Overview

```
User → Agent.run(input)
  → Provider.stream(model, context)
    → SSE events → push deltas
  → accumulate AssistantMessage
  → if toolCalls → executeTools (parallel or sequential)
    → beforeToolCall hook → execute → afterToolCall hook
  → yield AgentEvent
  → repeat until end-of-turn
```

The same pattern exists in Rust, just with different types:

```
User → agent.prompt(input)
  → LlmClient::stream(LlmRequest)
    → SSE parse → ContentDelta
  → apply_delta() → accumulate AssistantMessage
  → if ToolCalls → ToolRegistry::dispatch()
  → emit StreamEvent
  → repeat until end-of-turn
```

## Next Steps

- [**Installation**](/getting-started/installation) — Set up TypeScript or Rust in your project
- [**Quickstart**](/getting-started/quickstart) — Build your first agent in 5 minutes
- [**Project Structure**](/getting-started/project-structure) — Understand the monorepo layout
