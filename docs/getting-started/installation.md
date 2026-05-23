# Installation

Spectra provides independent SDKs for TypeScript and Rust. Choose the one that matches your project.

## TypeScript

### Prerequisites

- Node.js 18+ or Bun 1.0+
- A package manager (Bun recommended, npm/yarn/pnpm also work)

### Install

```bash
# Using Bun (recommended)
bun add @mohanscodex/spectra-ai @mohanscodex/spectra-agent

# Using npm
npm install @mohanscodex/spectra-ai @mohanscodex/spectra-agent

# Using yarn
yarn add @mohanscodex/spectra-ai @mohanscodex/spectra-agent
```

### Optional: Session Management & Orchestration

For production features (persistent sessions, rate limiting, multi-agent delegation):

```bash
bun add @mohanscodex/spectra-app
```

### Environment Variables

Set at least one provider API key:

```bash
# For Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# For OpenAI
export OPENAI_API_KEY="sk-..."
```

::: tip
Never hardcode API keys in your source code. Always use environment variables or a secrets manager.
:::

### Verify Installation

Create a test file `test.ts`:

```typescript
import { Agent } from "@mohanscodex/spectra-agent";

const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a helpful assistant.",
});

for await (const event of agent.run("Say hello")) {
  if (event.type === "message_update") {
    const text = event.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    process.stdout.write(text);
  }
}
```

Run it:

```bash
bun run test.ts
```

You should see the agent respond with a greeting.

---

## Rust

### Prerequisites

- Rust 1.75+ (install via [rustup](https://rustup.rs/))
- Cargo (included with rustup)

### Install

Add the core crate and HTTP clients to your `Cargo.toml`:

```bash
cargo add spectra-rs spectra-http
cargo add tokio --features full
```

Or manually edit `Cargo.toml`:

```toml
[dependencies]
spectra-rs = "0.2"
spectra-http = "0.2"
tokio = { version = "1", features = ["full"] }
```

### Environment Variables

```bash
# For OpenAI
export OPENAI_API_KEY="sk-..."

# For Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Verify Installation

Create `src/main.rs`:

```rust
use spectra_rs::{AgentBuilder, Model};
use spectra_http::OpenAIClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::from_env()?;

    let agent = AgentBuilder::new()
        .model(Model::openai("gpt-4o"))
        .system_prompt("You are a helpful assistant.")
        .build(client);

    let (mut rx, _, _) = agent.run("Say hello").await?;
    while let Some(Ok(event)) = stream.next().await {
        println!("{:?}", event);
    }

    Ok(())
}
```

Run it:

```bash
cargo run
```

You should see streaming events from the LLM.

---

## What's Installed?

### TypeScript Packages

| Package | Purpose |
|---|---|
| `@mohanscodex/spectra-ai` | LLM provider layer — Anthropic, OpenAI, custom providers |
| `@mohanscodex/spectra-agent` | Agent class, tool system, event streaming |
| `@mohanscodex/spectra-app` | (Optional) Session management, orchestration, rate limiting |

### Rust Crates

| Crate | Purpose |
|---|---|
| `spectra-rs` | Core types, Agent, LlmClient trait, Tool trait, Extension trait |
| `spectra-http` | HTTP clients — AnthropicClient, OpenAIClient with SSE streaming |

---

## Next Steps

- [**Quickstart**](/getting-started/quickstart) — Build your first agent in 5 minutes
- [**TypeScript Overview**](/typescript/overview) — Deep dive into the TS SDK
- [**Rust Overview**](/rust/overview) — Deep dive into the Rust SDK
