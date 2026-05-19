---
name: spectra-dev
description: "Build, test, and extend the Spectra AI agent framework. Use when working on Spectra SDKs (TypeScript or Rust), adding providers, tools, or modifying the agent loop."
---

# Spectra Development

## Project Structure

- TypeScript SDK: `packages/ai/` (providers), `packages/agent/` (agent + tools)
- Rust SDK: `crates/spectra-rs/` (core), `crates/spectra-http/` (clients)
- Docs: `docs/` (VitePress)
- Examples: `apps/examples/`

## Commands

```bash
# TypeScript
bun run lint      # tsc --noEmit across all TS packages
bun run test      # vitest --run across all TS packages
bun run build     # tsc build across all TS packages
bun run docs:dev  # vitepress dev server

# Rust
cargo test --workspace
cargo build --release
cargo clippy --workspace

# Pre-commit checklist (run ALL before committing)
bun run lint; if ($?) { bun run test }; if ($?) { bun run build }
```

## Architecture

Each SDK (TypeScript, Rust) is a **complete, independent native implementation** — same API surface, same behavior, no shared runtime, no bindings, no FFI.

- Rust uses trait-based abstraction (`LlmClient`, `Tool`, `Extension`) with builder patterns
- TypeScript uses class-based `Agent` with event listeners and `EventStream` (AsyncIterable)
- Both follow: stream → accumulate deltas → dispatch tools → loop until end-of-turn

## Conventions

### Rust
- `#![forbid(unsafe_code)]` — no unsafe in core logic
- `thiserror` + `miette` for errors — never `unwrap`/`expect` in library code
- `rustls` only — no OpenSSL
- Release: opt-level 3, thin LTO, codegen-units 1, strip symbols, panic=abort
- snake_case for functions/variables, PascalCase for types

### TypeScript
- Zod validation for tool parameters
- `EventStream<T, R>` implements `AsyncIterable<T>`
- Provider pattern: `registerProvider({ name, stream })`
- camelCase for functions/variables, PascalCase for types/classes
- Never use `workspace:*` in published packages

### General
- API keys always from environment variables, never hardcoded
- Naming: describe behavior/storage, not capability level (no `Simple` prefix)
- Python SDK is TODO — do not implement unless explicitly asked

## Common Patterns

### TypeScript Agent
```typescript
import { Agent, defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";

const agent = new Agent({
  model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are a helpful assistant.",
  tools: [defineTool({ name: "tool", description: "...", parameters: z.object({}), execute: async () => ({ content: [] }) })],
});

for await (const event of agent.run("Hello")) {
  if (event.type === "message_update") { /* stream text */ }
}
```

### Rust Agent
```rust
use spectra_rs::{AgentBuilder, Model};
use spectra_http::OpenAIClient;

let client = OpenAIClient::from_env()?;
let agent = AgentBuilder::new().model(Model::openai("gpt-4o")).build(client);
let mut stream = agent.prompt("Hello").await?;
while let Some(event) = stream.next().await { /* handle events */ }
```

## Environment Variables

- `ANTHROPIC_API_KEY` — required for Anthropic provider
- `OPENAI_API_KEY` — required for OpenAI provider

## Documentation

- Full docs plan: `docs/PLAN.md`
- LLM-friendly index: `docs/public/llms.txt`
- Conventions: see AGENTS.md `## Conventions` section
