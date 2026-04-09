# Spectra — Agent Framework Specification

> **Spectra** is a minimal, ultra-fast, multi-language AI agent framework with a Rust core.  
> Inspired by pi-mono's "anti-framework" philosophy: give developers sharp primitives, not a walled garden.

---

## Table of Contents

1. [Philosophy](#1-philosophy)
2. [Architecture Overview](#2-architecture-overview)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Turborepo + Rust — Yes, It Works](#4-turborepo--rust--yes-it-works)
5. [Development Phases](#5-development-phases)
6. [Phase 1 — Rust Core (`spectra-core`)](#6-phase-1--rust-core-spectra-core)
7. [Phase 2 — Rust SDK (`spectra-rs`)](#7-phase-2--rust-sdk-spectra-rs)
8. [Phase 3 — TypeScript/JavaScript SDK (`spectra-ts`)](#8-phase-3--typescriptjavascript-sdk-spectra-ts)
9. [Phase 4 — Python SDK (`spectra-py`)](#9-phase-4--python-sdk-spectra-py)
10. [Spectra Coder — Coding Agent App](#10-spectra-coder--coding-agent-app)
11. [Error Handling & Diagnostics](#11-error-handling--diagnostics)
12. [Concurrency Model](#12-concurrency-model)
13. [Performance Rules](#13-performance-rules)
14. [Documentation Standards](#14-documentation-standards)
15. [Engineering Principles](#15-engineering-principles)
16. [Dependency Policy](#16-dependency-policy)

---

## 1. Philosophy

Spectra is the **construction kit**, not the pre-built house.

| Principle | What it means for Spectra |
|---|---|
| **Minimal surface** | Ship only primitives. Every feature beyond the primitive set must be buildable by the user. |
| **No magic** | No hidden state, no implicit retries, no surprise allocations. |
| **Performance by default** | Correctness and speed are co-equal. Slow code is a bug. |
| **Polyglot, one core** | All SDKs are thin bindings over the same Rust core. Behaviour is identical across languages. |
| **Errors are first-class** | Every failure path is typed, structured, and human-readable. |

Spectra intentionally does **not** ship: sub-agents, plan mode, permission popups, automatic retry policies, or built-in memory stores. These are **extension territory** — composable by the user from Spectra primitives.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   USER CODE                         │
│  (Rust app / TS app / Python app / Spectra Coder)   │
└───────────┬──────────────┬──────────────┬───────────┘
            │              │              │
     ┌──────▼──────┐ ┌─────▼──────┐ ┌───▼──────────┐
     │  spectra-rs  │ │ spectra-ts │ │  spectra-py  │
     │  (Rust SDK)  │ │ (TS/JS SDK)│ │ (Python SDK) │
     └──────┬──────┘ └─────┬──────┘ └───┬──────────┘
            │              │  FFI / IPC  │
            └──────────────▼─────────────┘
                   ┌────────────────┐
                   │  spectra-core  │  ← Rust, zero unsafe* policy
                   │                │
                   │  • AgentLoop   │
                   │  • LLM Client  │
                   │  • Tool Engine │
                   │  • Stream Bus  │
                   │  • Error Types │
                   └────────────────┘
```

> *`unsafe` is only permitted in FFI boundary crates, not in core logic.

**How SDKs connect to the core:**
- `spectra-rs` — direct crate dependency (zero overhead, same process)
- `spectra-ts` — via `napi-rs` N-API bindings compiled into a `.node` native addon
- `spectra-py` — via `PyO3` Python extension module (`.pyd` / `.so`)

---

## 3. Monorepo Structure

```
spectra/
├── Cargo.toml                   ← Cargo workspace root
├── package.json                 ← pnpm workspace root (for Turborepo)
├── turbo.json                   ← Turborepo pipeline config
├── pnpm-workspace.yaml          ← pnpm workspace globs
│
├── crates/                      ← All Rust crates live here
│   ├── spectra-core/            ← The heart: agent loop, LLM, tools, streaming
│   ├── spectra-rs/              ← Rust-facing public SDK (re-exports + ergonomic wrappers)
│   ├── spectra-napi/            ← napi-rs bindings (compiled → spectra-ts/native/)
│   └── spectra-pyo3/            ← PyO3 bindings (compiled → spectra-py/spectra/_native.so)
│
├── packages/
│   ├── spectra-ts/              ← TypeScript/JavaScript SDK
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── agent.ts
│   │   │   ├── model.ts
│   │   │   ├── tool.ts
│   │   │   ├── stream.ts
│   │   │   └── errors.ts
│   │   ├── native/              ← Compiled .node binary lands here
│   │   └── tsconfig.json
│   │
│   └── spectra-py/              ← Python SDK
│       ├── pyproject.toml
│       ├── spectra/
│       │   ├── __init__.py
│       │   ├── agent.py
│       │   ├── model.py
│       │   ├── tool.py
│       │   ├── stream.py
│       │   └── errors.py
│       └── Cargo.toml           ← Points to crates/spectra-pyo3 for maturin
│
├── apps/
│   └── spectra-coder/           ← Coding agent CLI (Spectra Coder)
│       ├── package.json
│       └── src/
│
└── docs/
    ├── core.md
    ├── rust-sdk.md
    ├── ts-sdk.md
    ├── python-sdk.md
    ├── errors.md
    └── extensions.md
```

---

## 4. Turborepo + Rust — Yes, It Works

**Short answer:** Turborepo is language-agnostic. It orchestrates *tasks*, not languages. Each package in the workspace exposes tasks via `package.json` scripts. The Rust crate's `package.json` wraps `cargo build`, `cargo test`, etc., and Turborepo caches the `target/` outputs.

### How to wire it

**`pnpm-workspace.yaml`**
```yaml
packages:
  - "crates/*"       # Rust crates get a package.json wrapper each
  - "packages/*"
  - "apps/*"
```

**`crates/spectra-core/package.json`** (wrapper — Turborepo sees this)
```json
{
  "name": "@spectra/core-native",
  "version": "0.1.0",
  "scripts": {
    "build": "cargo build --release --package spectra-core",
    "build:debug": "cargo build --package spectra-core",
    "test": "cargo test --package spectra-core",
    "lint": "cargo clippy --package spectra-core -- -D warnings",
    "clean": "cargo clean --package spectra-core"
  }
}
```

**`turbo.json`**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [
        "target/release/**",
        "dist/**",
        "spectra/_native*.so",
        "native/**/*.node"
      ],
      "cache": true
    },
    "test": {
      "dependsOn": ["build"],
      "cache": false
    },
    "lint": {
      "cache": true
    }
  }
}
```

### Build dependency order (enforced by Turborepo)

```
spectra-core  →  spectra-napi  →  spectra-ts
                 spectra-pyo3  →  spectra-py
                 spectra-rs
```

`turbo run build` builds everything in the right order, parallelizing where possible, and caches Rust compilation artifacts so they aren't rebuilt unless source changes.

---

## 5. Development Phases

Phases are sequential. Do not begin a later phase until the prior phase has:
- All public APIs documented
- Test coverage ≥ 80 % for logic code
- Zero `cargo clippy` warnings
- Zero `cargo audit` vulnerabilities

```
Phase 1 ──► spectra-core     (Rust, ~4-6 weeks)
Phase 2 ──► spectra-rs       (Rust SDK, ~1-2 weeks)
Phase 3 ──► spectra-ts       (TS/JS SDK, ~2-3 weeks)
Phase 4 ──► spectra-py       (Python SDK, ~2 weeks)

Parallel (after Phase 1):
         ──► spectra-coder   (Coding agent app, ongoing)
```

---

## 6. Phase 1 — Rust Core (`spectra-core`)

The core is the **only** place where LLM calls, tool execution, streaming, and the agent loop live. SDKs expose these; they do not reimplement them.

### 6.1 Cargo.toml (core crate)

```toml
[package]
name        = "spectra-core"
version     = "0.1.0"
edition     = "2024"
description = "Spectra agent framework — ultra-fast Rust core"
license     = "MIT"

[dependencies]
# Async runtime — use Tokio, the standard
tokio          = { version = "1", features = ["full"] }

# HTTP client — reqwest with rustls (no openssl dependency)
reqwest        = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }

# Serialisation — serde + serde_json only
serde          = { version = "1", features = ["derive"] }
serde_json     = "1"

# Async streaming — futures-core for Stream trait
futures-core   = "0.3"
futures-util   = "0.3"

# Error handling — thiserror for library errors
thiserror      = "2"

# Diagnostics — miette for human-friendly error display
miette         = { version = "7", features = ["fancy"] }

# Logging — tracing (structured, zero-cost when disabled)
tracing        = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# Concurrency utilities
tokio-util     = { version = "0.7", features = ["codec"] }
async-trait    = "0.1"
dashmap        = "6"    # concurrent hash map, lock-free reads

# Bytes — zero-copy buffer handling for streaming
bytes          = "1"

[dev-dependencies]
tokio-test     = "0.4"
wiremock       = "0.6"   # HTTP mocking
insta          = "1"     # snapshot testing

[profile.release]
opt-level     = 3
lto           = "thin"   # thin LTO — good balance of speed vs compile time
codegen-units = 1
strip         = "symbols"
panic         = "abort"   # smaller binary, faster

[profile.dev]
opt-level     = 0
debug         = 1
```

> **Rule:** No `unwrap()` or `expect()` in library code. Every fallible operation returns `Result<T, SpectraError>`.

### 6.2 Core Modules

#### `core/src/error.rs` — Unified Error Type

```rust
use miette::Diagnostic;
use thiserror::Error;

/// All errors emitted by spectra-core.
/// `miette::Diagnostic` gives rich, human-readable terminal output.
#[derive(Error, Debug, Diagnostic)]
pub enum SpectraError {
    #[error("LLM provider error: {provider} — {message}")]
    #[diagnostic(
        code(spectra::llm::provider),
        help("Check your API key and network connection for provider '{provider}'")
    )]
    ProviderError {
        provider: String,
        message:  String,
        #[source]
        source:   Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    #[error("Tool execution failed: '{tool}' — {reason}")]
    #[diagnostic(
        code(spectra::tool::exec),
        help("Ensure the tool handler returns a valid ToolOutput")
    )]
    ToolError { tool: String, reason: String },

    #[error("Stream interrupted: {reason}")]
    #[diagnostic(code(spectra::stream::interrupted))]
    StreamInterrupted { reason: String },

    #[error("Schema validation failed for tool '{tool}': {detail}")]
    #[diagnostic(
        code(spectra::tool::schema),
        help("The model returned arguments that do not match the tool's JSON schema")
    )]
    SchemaValidation { tool: String, detail: String },

    #[error("Configuration error: {field} — {detail}")]
    #[diagnostic(code(spectra::config))]
    Config { field: String, detail: String },

    #[error("HTTP error: {status} — {url}")]
    #[diagnostic(code(spectra::http))]
    Http { status: u16, url: String },

    #[error("Serialisation error: {0}")]
    #[diagnostic(code(spectra::serde))]
    Serialise(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    #[diagnostic(code(spectra::io))]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, SpectraError>;
```

#### `core/src/model.rs` — Provider Abstraction

```rust
use crate::error::Result;
use async_trait::async_trait;
use futures_core::Stream;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

/// A model handle — cheap to clone, points to provider config.
#[derive(Debug, Clone)]
pub struct Model {
    pub provider: Provider,
    pub model_id: String,
    pub config:   ModelConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub max_tokens:   u32,
    pub temperature:  Option<f32>,
    pub top_p:        Option<f32>,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self { max_tokens: 4096, temperature: None, top_p: None }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Provider {
    Anthropic,
    OpenAI,
    Groq,
    Custom(String),
}

/// The core streaming event emitted by every LLM call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    TextDelta  { delta: String },
    ToolCall   { id: String, name: String, args_json: String },
    ToolResult { id: String, output: serde_json::Value },
    Done       { stop_reason: StopReason, usage: Usage },
    Error      { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StopReason { EndTurn, ToolUse, MaxTokens, StopSequence }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Usage { pub input_tokens: u32, pub output_tokens: u32 }

pub type EventStream = Pin<Box<dyn Stream<Item = Result<StreamEvent>> + Send>>;

/// Implement this trait to add a new LLM provider.
#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn complete(
        &self,
        messages: &[Message],
        tools:    &[ToolDefinition],
        config:   &ModelConfig,
    ) -> Result<EventStream>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role:    Role,
    pub content: Vec<ContentBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role { User, Assistant }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text        { text: String },
    ToolUse     { id: String, name: String, input: serde_json::Value },
    ToolResult  { tool_use_id: String, content: serde_json::Value },
}
```

#### `core/src/tool.rs` — Tool Engine

```rust
use crate::error::{Result, SpectraError};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name:        String,
    pub description: String,
    pub schema:      Value,   // JSON Schema for input validation
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    pub content: Value,
    pub is_error: bool,
}

/// Any callable tool implements this trait.
#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;

    async fn call(&self, input: Value) -> Result<ToolOutput>;
}

/// Registry — holds tools by name, concurrent-read safe.
pub struct ToolRegistry {
    tools: dashmap::DashMap<String, Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self { tools: dashmap::DashMap::new() }
    }

    pub fn register(&self, tool: impl Tool + 'static) {
        self.tools.insert(tool.definition().name.clone(), Box::new(tool));
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.tools.iter().map(|e| e.definition()).collect()
    }

    pub async fn dispatch(&self, name: &str, input: Value) -> Result<ToolOutput> {
        match self.tools.get(name) {
            Some(tool) => tool.call(input).await,
            None       => Err(SpectraError::ToolError {
                tool:   name.to_string(),
                reason: "Tool not registered".to_string(),
            }),
        }
    }
}
```

#### `core/src/agent.rs` — The Agent Loop

```rust
use crate::{
    error::Result,
    model::{ContentBlock, EventStream, LlmClient, Message, ModelConfig, Role, StreamEvent},
    tool::ToolRegistry,
};
use std::sync::Arc;
use tokio::sync::mpsc;

pub struct AgentConfig {
    pub system_prompt: String,
    pub model_config:  ModelConfig,
    /// Maximum tool-call rounds before stopping. None = unlimited.
    pub max_rounds:    Option<u32>,
}

pub struct Agent {
    client:   Arc<dyn LlmClient>,
    registry: Arc<ToolRegistry>,
    config:   AgentConfig,
    history:  Vec<Message>,
}

impl Agent {
    pub fn new(
        client:   Arc<dyn LlmClient>,
        registry: Arc<ToolRegistry>,
        config:   AgentConfig,
    ) -> Self {
        Self { client, registry, config, history: Vec::new() }
    }

    /// Run a prompt through the agent loop, returning a stream of events.
    /// Callers consume the stream; tool calls are handled internally.
    pub async fn prompt(
        &mut self,
        user_input: impl Into<String>,
    ) -> Result<mpsc::Receiver<StreamEvent>> {
        let (tx, rx) = mpsc::channel(256);

        self.history.push(Message {
            role:    Role::User,
            content: vec![ContentBlock::Text { text: user_input.into() }],
        });

        let client   = Arc::clone(&self.client);
        let registry = Arc::clone(&self.registry);
        let history  = self.history.clone();
        let config   = self.config.model_config.clone();
        let tools    = registry.definitions();

        tokio::spawn(async move {
            if let Err(e) = run_loop(client, registry, history, tools, config, tx).await {
                tracing::error!(error = %e, "Agent loop error");
            }
        });

        Ok(rx)
    }
}

async fn run_loop(
    client:   Arc<dyn LlmClient>,
    registry: Arc<ToolRegistry>,
    mut history: Vec<Message>,
    tools:    Vec<crate::model::ToolDefinition>,
    config:   ModelConfig,
    tx:       mpsc::Sender<StreamEvent>,
) -> Result<()> {
    loop {
        let mut stream: EventStream = client.complete(&history, &tools, &config).await?;
        let mut tool_calls: Vec<(String, String, String)> = Vec::new(); // (id, name, args)
        let mut assistant_text = String::new();

        use futures_util::StreamExt;
        while let Some(event) = stream.next().await {
            let event = event?;
            match &event {
                StreamEvent::TextDelta { delta } => assistant_text.push_str(delta),
                StreamEvent::ToolCall  { id, name, args_json } => {
                    tool_calls.push((id.clone(), name.clone(), args_json.clone()));
                }
                StreamEvent::Done { .. } => {}
                StreamEvent::Error { message } => {
                    tracing::warn!(%message, "Stream error event");
                }
                _ => {}
            }
            // Forward every event to the caller
            if tx.send(event).await.is_err() { return Ok(()); }
        }

        if tool_calls.is_empty() {
            // No more tool calls — loop ends
            break;
        }

        // Execute all tool calls concurrently
        let mut handles = Vec::with_capacity(tool_calls.len());
        for (id, name, args_json) in &tool_calls {
            let registry = Arc::clone(&registry);
            let id       = id.clone();
            let name     = name.clone();
            let args: serde_json::Value = serde_json::from_str(args_json)
                .unwrap_or(serde_json::Value::Null);
            handles.push(tokio::spawn(async move {
                let output = registry.dispatch(&name, args).await;
                (id, name, output)
            }));
        }

        let mut tool_result_blocks = Vec::new();
        for handle in handles {
            let (id, name, result) = handle.await.expect("Tool task panicked");
            let content = match result {
                Ok(out)  => out.content,
                Err(err) => {
                    tracing::error!(%err, tool = %name, "Tool call failed");
                    serde_json::json!({ "error": err.to_string() })
                }
            };
            let event = StreamEvent::ToolResult { id: id.clone(), output: content.clone() };
            let _ = tx.send(event).await;
            tool_result_blocks.push(ContentBlock::ToolResult {
                tool_use_id: id,
                content,
            });
        }

        // Append assistant turn + tool results to history
        history.push(Message {
            role:    Role::Assistant,
            content: vec![ContentBlock::Text { text: assistant_text }],
        });
        history.push(Message { role: Role::User, content: tool_result_blocks });
    }

    Ok(())
}
```

---

## 7. Phase 2 — Rust SDK (`spectra-rs`)

`spectra-rs` is the ergonomic public API for Rust users. It re-exports `spectra-core` types and adds builder patterns, convenience functions, and first-class Rust extension support.

### 7.1 Cargo.toml

```toml
[package]
name    = "spectra-rs"
version = "0.1.0"
edition = "2024"

[dependencies]
spectra-core = { path = "../spectra-core" }
tokio        = { version = "1", features = ["full"] }
serde        = { version = "1", features = ["derive"] }
serde_json   = "1"
async-trait  = "0.1"
```

### 7.2 Public API Shape

```rust
// The entire public surface — keep it this small
pub use spectra_core::{
    agent::{Agent, AgentConfig},
    error::{Result, SpectraError},
    model::{ContentBlock, Message, Model, ModelConfig, Provider, Role, StreamEvent},
    tool::{Tool, ToolDefinition, ToolOutput, ToolRegistry},
};

pub mod prelude {
    pub use super::{Agent, AgentConfig, Model, Provider, SpectraError, Tool, ToolRegistry};
}

/// Builder for AgentConfig — KISS, no macro magic
pub struct AgentBuilder { /* ... */ }
```

### 7.3 Extension API (Rust)

```rust
pub trait Extension: Send + Sync {
    fn on_tool_call(&self, _name: &str, _input: &serde_json::Value) {}
    fn on_tool_result(&self, _name: &str, _output: &serde_json::Value) {}
    fn on_stream_event(&self, _event: &StreamEvent) {}
}
```

---

## 8. Phase 3 — TypeScript/JavaScript SDK (`spectra-ts`)

### 8.1 Binding Strategy

Use **`napi-rs`** to compile `crates/spectra-napi` into a `.node` native addon. The `spectra-ts` package ships this binary and wraps it with a thin, idiomatic TypeScript API.

```
crates/spectra-napi/  (napi-rs crate)
  └── Compiles to packages/spectra-ts/native/spectra.node
```

### 8.2 Package Structure

```
packages/spectra-ts/
├── src/
│   ├── index.ts        ← re-exports everything
│   ├── agent.ts        ← Agent class
│   ├── model.ts        ← getModel() factory
│   ├── tool.ts         ← Tool interface + registry
│   ├── stream.ts       ← AsyncIterable wrapper over native stream
│   └── errors.ts       ← SpectraError + typed error classes
├── native/
│   └── spectra.node    ← built by napi-rs
├── package.json
└── tsconfig.json
```

### 8.3 package.json

```json
{
  "name": "@spectra/sdk",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "napi build --platform --release && tsc",
    "test":  "vitest run",
    "lint":  "eslint src --max-warnings 0"
  },
  "dependencies": {},
  "devDependencies": {
    "@napi-rs/cli":   "^3",
    "typescript":     "^5",
    "vitest":         "^2",
    "zod":            "^3"
  }
}
```

### 8.4 TypeScript API

#### `errors.ts`

```typescript
/** All errors from Spectra are instances of SpectraError */
export class SpectraError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "SpectraError";
  }
}

export class ProviderError   extends SpectraError {}
export class ToolError       extends SpectraError {}
export class StreamError     extends SpectraError {}
export class SchemaError     extends SpectraError {}
export class ConfigError     extends SpectraError {}
```

#### `tool.ts` — Zod integration

```typescript
import { z, ZodTypeAny } from "zod";
import { SpectraError } from "./errors.js";

export interface ToolDefinition<TInput extends ZodTypeAny = ZodTypeAny> {
  name:        string;
  description: string;
  schema:      TInput;
  execute(input: z.infer<TInput>): Promise<unknown>;
}

/** Define a tool with full Zod validation */
export function defineTool<TInput extends ZodTypeAny>(
  def: ToolDefinition<TInput>,
): ToolDefinition<TInput> {
  return def;
}

/** Internal: validates input before passing to execute */
export async function dispatchTool(
  tool:  ToolDefinition,
  input: unknown,
): Promise<unknown> {
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    throw new SchemaError(
      "spectra.tool.schema",
      `Tool '${tool.name}' received invalid input`,
      parsed.error.flatten(),
    );
  }
  return tool.execute(parsed.data);
}
```

#### `agent.ts`

```typescript
import type { ToolDefinition } from "./tool.js";

export interface AgentConfig {
  systemPrompt: string;
  model:        Model;
  tools?:       ToolDefinition[];
  maxRounds?:   number;
}

export class Agent {
  constructor(private readonly config: AgentConfig) {}

  /** Returns an async iterable of StreamEvents */
  async *prompt(userInput: string): AsyncIterable<StreamEvent> {
    // delegates to native addon via the compiled .node binary
    yield* nativePrompt(this.config, userInput);
  }
}
```

#### `stream.ts`

```typescript
export type StreamEvent =
  | { type: "text_delta";   delta:       string }
  | { type: "tool_call";    id: string;  name: string; argsJson: string }
  | { type: "tool_result";  id: string;  output: unknown }
  | { type: "done";         stopReason:  StopReason; usage: Usage }
  | { type: "error";        message:     string };

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
export interface Usage { inputTokens: number; outputTokens: number; }
```

#### `model.ts`

```typescript
export type Provider = "anthropic" | "openai" | "groq" | (string & {});

export interface ModelConfig {
  maxTokens?:  number;
  temperature?: number;
  topP?:       number;
}

export interface Model {
  provider: Provider;
  modelId:  string;
  config:   ModelConfig;
}

export function getModel(
  provider: Provider,
  modelId:  string,
  config:   ModelConfig = {},
): Model {
  return { provider, modelId, config };
}
```

---

## 9. Phase 4 — Python SDK (`spectra-py`)

### 9.1 Binding Strategy

Use **`PyO3`** + **`maturin`** to compile `crates/spectra-pyo3` into a Python extension module (`spectra/_native.so`). `maturin develop` for development, `maturin build --release` for distribution.

### 9.2 `pyproject.toml`

```toml
[build-system]
requires      = ["maturin>=1.7"]
build-backend = "maturin"

[project]
name            = "spectra-sdk"
version         = "0.1.0"
requires-python = ">=3.11"
dependencies    = ["pydantic>=2.0"]

[tool.maturin]
features        = ["pyo3/extension-module"]
module-name     = "spectra._native"
python-packages = ["spectra"]
```

### 9.3 Python API

#### `spectra/errors.py`

```python
class SpectraError(Exception):
    """Base class for all Spectra errors."""
    def __init__(self, code: str, message: str, detail: object = None) -> None:
        super().__init__(message)
        self.code   = code
        self.detail = detail

class ProviderError(SpectraError): ...
class ToolError(SpectraError):     ...
class StreamError(SpectraError):   ...
class SchemaError(SpectraError):   ...
class ConfigError(SpectraError):   ...
```

#### `spectra/tool.py` — Pydantic integration

```python
from __future__ import annotations
from collections.abc import Awaitable, Callable
from typing import Any, Generic, TypeVar
from pydantic import BaseModel, ValidationError
from .errors import SchemaError

TInput = TypeVar("TInput", bound=BaseModel)


class ToolDefinition(Generic[TInput]):
    def __init__(
        self,
        name:        str,
        description: str,
        schema:      type[TInput],
        execute:     Callable[[TInput], Awaitable[Any]],
    ) -> None:
        self.name        = name
        self.description = description
        self.schema      = schema
        self._execute    = execute

    def json_schema(self) -> dict[str, Any]:
        return self.schema.model_json_schema()

    async def dispatch(self, raw_input: dict[str, Any]) -> Any:
        try:
            parsed = self.schema.model_validate(raw_input)
        except ValidationError as e:
            raise SchemaError(
                "spectra.tool.schema",
                f"Tool '{self.name}' received invalid input",
                detail=e.errors(),
            ) from e
        return await self._execute(parsed)


def define_tool(
    name:        str,
    description: str,
    schema:      type[TInput],
    execute:     Callable[[TInput], Awaitable[Any]],
) -> ToolDefinition[TInput]:
    return ToolDefinition(name, description, schema, execute)
```

#### `spectra/agent.py`

```python
from __future__ import annotations
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any
from .model import Model
from .tool  import ToolDefinition
from .      import _native  # compiled PyO3 module


@dataclass
class AgentConfig:
    system_prompt: str
    model:         Model
    tools:         list[ToolDefinition[Any]] = field(default_factory=list)
    max_rounds:    int | None = None


class Agent:
    def __init__(self, config: AgentConfig) -> None:
        self._config = config

    async def prompt(self, user_input: str) -> AsyncIterator[dict[str, Any]]:
        """Yields StreamEvent dicts. Iterate with `async for`."""
        async for event in _native.run_agent(self._config, user_input):
            yield event
```

#### `spectra/model.py`

```python
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelConfig:
    max_tokens:  int   = 4096
    temperature: float | None = None
    top_p:       float | None = None


@dataclass(frozen=True)
class Model:
    provider: str
    model_id: str
    config:   ModelConfig = ModelConfig()


def get_model(
    provider: str,
    model_id: str,
    **kwargs: object,
) -> Model:
    return Model(provider=provider, model_id=model_id, config=ModelConfig(**kwargs))
```

---

## 10. Spectra Coder — Coding Agent App

`apps/spectra-coder/` is the **Spectra Coder** — a minimal terminal coding agent built on `@spectra/sdk`, analogous to pi-mono's `coding-agent`.

### 10.1 Scope

Spectra Coder ships exactly **4 built-in tools:**

| Tool    | Action                                          |
|---------|-------------------------------------------------|
| `read`  | Read a file or directory listing                |
| `write` | Write content to a file                         |
| `edit`  | Apply a search-replace edit to a file           |
| `bash`  | Execute a shell command, capture stdout/stderr  |

Everything beyond these four — git commit on write, sub-agents, plan mode — is an **extension**, not a built-in.

### 10.2 Extension API (TypeScript)

```typescript
import type { Agent, StreamEvent, ToolDefinition } from "@spectra/sdk";

export interface ExtensionAPI {
  registerTool(tool: ToolDefinition): void;
  on(event: "tool_call" | "tool_result" | "stream_event", handler: (e: StreamEvent) => void): void;
}

export type Extension = (api: ExtensionAPI) => void;
```

Extensions are placed in `~/.spectra-coder/extensions/` or `.spectra/extensions/` in a project and loaded at startup.

### 10.3 Run Modes

| Mode          | How                                             |
|---------------|-------------------------------------------------|
| `interactive` | REPL-style terminal session                     |
| `print`       | One-shot, output to stdout as plain text        |
| `json`        | One-shot, output to stdout as JSON stream       |
| `sdk`         | Embedded — import and call programmatically    |

---

## 11. Error Handling & Diagnostics

### Rust Core

- All errors are `SpectraError` variants (typed, not stringly typed).
- `miette` renders errors with source, help text, and error code in the terminal.
- Use `?` for propagation. Never `.unwrap()` in library code.
- Warnings go through `tracing::warn!`, never `eprintln!`.
- Log structured fields: `tracing::error!(tool = %name, input = ?args, "Tool failed")`.

**Example terminal output (miette fancy mode):**

```
  × LLM provider error: anthropic — 401 Unauthorized
  ╰─▶ Check your API key and network connection for provider 'anthropic'
       help: Set the ANTHROPIC_API_KEY environment variable
```

### TypeScript SDK

- All errors thrown are `SpectraError` subclasses (never plain `Error` or string throws).
- Errors include a `code` string (`"spectra.tool.schema"`) for programmatic handling.
- Zod `ZodError` is caught at the tool dispatch boundary and re-thrown as `SchemaError`.

```typescript
try {
  for await (const event of agent.prompt("...")) { /* ... */ }
} catch (err) {
  if (err instanceof ToolError)   { /* handle */ }
  if (err instanceof ProviderError) { /* handle */ }
  throw err; // unknown errors bubble
}
```

### Python SDK

- All errors raised are `SpectraError` subclasses.
- Pydantic `ValidationError` is caught at the tool dispatch boundary and re-raised as `SchemaError`.
- Never raise bare `Exception` or `RuntimeError` from SDK code.

```python
try:
    async for event in agent.prompt("..."):
        ...
except ToolError as e:
    print(f"[{e.code}] {e}")
except ProviderError as e:
    print(f"[{e.code}] {e}")
```

### Warnings vs. Errors

| Situation | Mechanism |
|---|---|
| Unrecoverable failure | `SpectraError` (typed, raised/returned) |
| Recoverable advisory | `tracing::warn!` / console log at WARN level |
| Debug information | `tracing::debug!` / console log at DEBUG level |
| Never | `println!` / `eprintln!` in library code |

---

## 12. Concurrency Model

Spectra is **async-first** and **concurrency-ready** across all SDKs.

| Layer | Concurrency Primitive |
|---|---|
| Rust core | `tokio` async runtime; tool calls run concurrently via `tokio::spawn` |
| Tool dispatch | Concurrent by default (all tool calls in a round run in parallel) |
| TS SDK | `AsyncIterable<StreamEvent>` — native async iteration |
| Python SDK | `AsyncIterator` — `async for` |
| Shared state | `dashmap::DashMap` for the tool registry (lock-free reads) |

**Concurrency contract:**
- The agent loop dispatches all tool calls in a given round **concurrently** (see `run_loop` above).
- Tools must be `Send + Sync` in Rust; they are assumed thread-safe in TS/Python.
- Message history is **not** shared across concurrent `Agent` instances — each agent owns its history.
- If you need multiple concurrent agents, construct multiple `Agent` instances (cheap).

---

## 13. Performance Rules

These rules are **mandatory** for all code merged into Spectra.

### Rust

1. **Release profile:** always `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`, `panic = "abort"`.
2. **Zero unnecessary allocations:** prefer `&str` over `String`, slices over `Vec` in hot paths.
3. **Async, not threads:** use `tokio::spawn` for concurrency; never `std::thread::spawn` in async code.
4. **No `clone()` on large types in hot paths** — use `Arc<T>` for shared ownership.
5. **Profile before optimising:** use `cargo flamegraph` or `samply` — do not optimise by intuition.
6. **Buffer reuse:** use `bytes::BytesMut` for streaming response buffers; avoid per-chunk allocation.

### TypeScript

1. Avoid unnecessary `JSON.parse` / `JSON.stringify` round-trips — native types flow through the `.node` addon.
2. Use `AsyncIterable` (not callbacks or event emitters) for streaming — zero buffering overhead.
3. Zod parsing happens once per tool call at the boundary — not inside the hot loop.

### Python

1. Pydantic v2 (Rust-backed) for all schema validation — do not use `dataclasses` for tool inputs.
2. `async for` over all agent streams — never `.run_until_complete()` in async contexts.
3. Avoid repeated Python-to-Rust data conversion — batch where possible.

### Build

1. CI always runs `cargo build --release` — never ship a debug build as a benchmark.
2. Docker / distribution builds use `--release` with `strip = "symbols"`.
3. Turborepo caches `target/release/` — CI hits cache on unchanged crates.

---

## 14. Documentation Standards

Every public symbol must have documentation.

### Rust

```rust
/// Brief one-line description.
///
/// Longer explanation if needed. Explain *why*, not just *what*.
///
/// # Errors
///
/// Returns [`SpectraError::ToolError`] if the tool is not registered.
///
/// # Example
///
/// ```rust
/// let registry = ToolRegistry::new();
/// registry.register(my_tool);
/// ```
pub async fn dispatch(&self, name: &str, input: Value) -> Result<ToolOutput> {
```

- Run `cargo doc --no-deps --open` to verify documentation builds.
- All public modules have a module-level `//!` doc comment.

### TypeScript

```typescript
/**
 * Define a tool with Zod-validated input.
 *
 * @param def - Tool definition including name, description, Zod schema, and execute function.
 * @returns   - A validated ToolDefinition ready to pass to `AgentConfig.tools`.
 *
 * @example
 * ```typescript
 * const readTool = defineTool({
 *   name:        "read",
 *   description: "Read a file",
 *   schema:      z.object({ path: z.string() }),
 *   execute:     async ({ path }) => fs.readFile(path, "utf8"),
 * });
 * ```
 */
export function defineTool<TInput extends ZodTypeAny>(def: ToolDefinition<TInput>) {
```

### Python

```python
def define_tool(
    name:        str,
    description: str,
    schema:      type[TInput],
    execute:     Callable[[TInput], Awaitable[Any]],
) -> ToolDefinition[TInput]:
    """
    Define a tool with Pydantic-validated input.

    Args:
        name:        Tool name (must match what the model sends in tool_call events).
        description: Human-readable description sent to the LLM.
        schema:      A Pydantic BaseModel class describing the tool's input.
        execute:     Async function receiving a validated schema instance.

    Returns:
        A ToolDefinition ready to pass to AgentConfig.

    Example:
        ```python
        class ReadInput(BaseModel):
            path: str

        read_tool = define_tool(
            name="read",
            description="Read a file",
            schema=ReadInput,
            execute=lambda inp: Path(inp.path).read_text(),
        )
        ```
    """
```

### Docs folder

| File | Contents |
|---|---|
| `docs/core.md` | Rust core internals, architecture decisions, extension points |
| `docs/rust-sdk.md` | `spectra-rs` public API reference with examples |
| `docs/ts-sdk.md` | `@spectra/sdk` reference, Zod patterns, bundling guide |
| `docs/python-sdk.md` | `spectra-sdk` reference, Pydantic patterns, async patterns |
| `docs/errors.md` | All error codes, what causes them, how to fix them |
| `docs/extensions.md` | How to write extensions for Spectra Coder |

---

## 15. Engineering Principles

Spectra follows three governing principles. When in doubt, apply them in order.

### DRY — Don't Repeat Yourself

- Logic lives in `spectra-core`. SDKs bind; they do not reimplement.
- Error types are defined once in Rust and surfaced idiomatically in each SDK.
- Tool schema JSON is derived from Zod/Pydantic definitions — never hand-written twice.

### KISS — Keep It Simple, Stupid

- The agent loop is a single function (`run_loop`). No class hierarchy.
- The public API surface is intentionally tiny: `getModel`, `new Agent`, `agent.prompt`.
- Resist adding config knobs. Every knob is a maintenance burden and a decision the user shouldn't have to make.

### YAGNI — You Aren't Gonna Need It

- Sub-agents: not built in. Build it as an extension.
- Plan mode: not built in. Build it as an extension.
- Retry logic: not built in. Wrap `agent.prompt` in your own retry loop.
- Memory/vector store: not built in. Inject history yourself.
- Telemetry/tracing: `tracing` subscriber is opt-in — not forced on the user.

---

## 16. Dependency Policy

All dependencies must be **actively maintained**, **minimal**, and **purposeful**.

### Approved Core Dependencies

| Crate / Package | Purpose | Why |
|---|---|---|
| `tokio` | Async runtime | Industry standard, best performance |
| `reqwest` (rustls feature) | HTTP client | No OpenSSL, pure Rust TLS |
| `serde` + `serde_json` | Serialisation | Zero-cost, universal |
| `thiserror` | Error derive | Zero overhead, idiomatic |
| `miette` | Error display | Best-in-class human-readable errors |
| `tracing` | Structured logging | Zero-cost when disabled |
| `dashmap` | Concurrent map | Lock-free reads, well-maintained |
| `bytes` | Buffer management | Zero-copy streaming |
| `futures-core/util` | Stream traits | Standard async utilities |
| `async-trait` | Async in traits | Until AFIT is stable across MSRV |
| `napi-rs` | TS bindings | Fastest N-API Rust binding |
| `pyo3` + `maturin` | Python bindings | Fastest Python Rust binding |
| `zod` (TS) | Schema validation | Standard, composable |
| `pydantic` v2 (Python) | Schema validation | Rust-backed, fastest Python validator |

### Rules

1. **No transitive dependency on OpenSSL.** Use `rustls` throughout.
2. **No runtime reflection / dynamic dispatch in hot paths.** Static dispatch via generics.
3. **No dependencies that pull in `syn` in production** (only dev/build).
4. **Audit dependencies:** run `cargo audit` and `npm audit` in CI on every PR.
5. **A new dependency requires a written justification in the PR description.**

---

*Spectra — ultrafast by default, minimal by design.*
