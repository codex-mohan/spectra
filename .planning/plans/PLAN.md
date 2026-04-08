# Phase 1 Plan: spectra-core

**Phase:** 1 of 4  
**Goal:** Rust core with agent loop, LLM client, tool engine, and error types  
**Requirements:** CORE-01 to CORE-09, BUILD-01 to BUILD-03  
**Granularity:** Coarse

---

## Implementation Strategy

Based on pi-mono patterns, the implementation follows:

1. **Types-first**: Define message types, errors, events before logic
2. **Trait-based**: LLM client as trait for provider abstraction
3. **Async streaming**: tokio + broadcast channel for events
4. **Tool registry**: DashMap for concurrent access
5. **Approval hook**: before_tool_call callback pattern

---

## Directory Structure

```
spectra/
├── Cargo.toml              # Workspace root
├── pnpm-workspace.yaml     # pnpm monorepo
├── turbo.json              # Turborepo config
├── packages/
│   └── core/               # spectra-core crate
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── messages.rs     # CORE-06: Message types
│           ├── error.rs        # CORE-04: Typed errors with miette
│           ├── event.rs         # CORE-05: Event stream
│           ├── llm.rs           # CORE-02: LLM client trait
│           ├── tool.rs          # CORE-03: Tool registry
│           ├── approval.rs      # CORE-09: Tool approval
│           └── agent.rs         # CORE-01, CORE-07, CORE-08
└── package.json            # Turborepo root
```

---

## Tasks

### Task 1: Workspace Foundation
**Requirements:** BUILD-01, BUILD-02, BUILD-03

- [ ] Create `Cargo.toml` with workspace configuration
- [ ] Create `packages/core/Cargo.toml` with dependencies:
  - tokio (full features)
  - serde, serde_json
  - thiserror, miette
  - tracing
  - dashmap
  - reqwest (with rustls)
- [ ] Create `pnpm-workspace.yaml`
- [ ] Create `turbo.json` with pipeline: build, test, lint
- [ ] Create root `package.json` with scripts

**Dependencies:** None

---

### Task 2: Core Types
**Requirements:** CORE-04, CORE-06

#### 2.1 Error System (CORE-04)
- [ ] Define `SpectraError` enum with variants:
  - `LlmError` - LLM provider failures
  - `ToolError` - Tool execution failures
  - `ValidationError` - Schema validation failures
  - `StreamError` - Event stream failures
  - `ConfigError` - Configuration errors
- [ ] Implement `thiserror::Error` derive
- [ ] Add miette `Diagnostic` impl for rich errors
- [ ] Add `source()` for chained errors
- [ ] Add error context via `.context()` pattern

#### 2.2 Message Types (CORE-06)
- [ ] Define `Message` enum with roles:
  - `User` - User messages with content
  - `Assistant` - Assistant responses with tool calls
  - `ToolResult` - Tool execution results
- [ ] Define `Content` enum:
  - `Text(String)`
  - `Image { url: String, detail: ImageDetail }`
- [ ] Define `ToolCall` struct:
  - `id: String`
  - `name: String`
  - `arguments: Value` (JSON)
- [ ] Define `StopReason` enum:
  - `EndOfTurn`, `ToolCalls`, `Error`, `Aborted`
- [ ] Add `timestamp: DateTime<Utc>` to all messages

**Dependencies:** Task 1

---

### Task 3: Event Stream
**Requirements:** CORE-05

- [ ] Define `StreamEvent` enum:
  - `AgentStart`
  - `TurnStart`
  - `MessageStart { message: Message }`
  - `MessageUpdate { delta: ContentDelta }`
  - `MessageEnd { message: Message }`
  - `TurnEnd { tool_results: Vec<Message> }`
  - `ToolExecutionStart { tool_call: ToolCall }`
  - `ToolExecutionUpdate { partial: ToolResult }`
  - `ToolExecutionEnd { result: ToolResult, is_error: bool }`
  - `AgentEnd { messages: Vec<Message> }`
- [ ] Implement `EventStream` struct with:
  - `broadcast::Sender<StreamEvent>` internals
  - `subscribe() -> broadcast::Receiver<StreamEvent>`
  - `emit(event)` method
  - `close()` method
- [ ] Make stream cloneable for multiple subscribers
- [ ] Handle backpressure gracefully

**Dependencies:** Task 2

---

### Task 4: LLM Client Trait
**Requirements:** CORE-02

- [ ] Define `LlmProvider` trait:
  ```rust
  #[async_trait]
  pub trait LlmProvider: Send + Sync {
      async fn complete(
          &self,
          request: LlmRequest,
          signal: Option<AbortSignal>,
      ) -> Result<LlmResponse, SpectraError>;
      
      async fn stream(
          &self,
          request: LlmRequest,
          signal: Option<AbortSignal>,
      ) -> Result<Pin<Box<dyn Stream<Item = LlmStreamEvent> + Send>>, SpectraError>;
  }
  ```
- [ ] Define `LlmRequest` struct:
  - `model: ModelId`
  - `system_prompt: Option<String>`
  - `messages: Vec<Message>`
  - `tools: Vec<ToolDef>`
- [ ] Define `LlmResponse` struct:
  - `message: Message`
  - `usage: TokenUsage`
  - `stop_reason: StopReason`
- [ ] Define `LlmStreamEvent` enum:
  - `Start { partial: Message }`
  - `ContentDelta { delta: ContentDelta }`
  - `ToolCallDelta { id: String, name: Option<String>, args_delta: String }`
  - `Done { message: Message }`
  - `Error { message: String }`
- [ ] Implement abort signal propagation to reqwest

**Dependencies:** Task 2, Task 3

---

### Task 5: Tool Registry
**Requirements:** CORE-03

- [ ] Define `Tool` struct:
  - `name: String`
  - `description: String`
  - `parameters: Value` (JSON Schema)
  - `execute: Arc<dyn ToolExecutor>`
- [ ] Define `ToolExecutor` trait:
  ```rust
  #[async_trait]
  pub trait ToolExecutor: Send + Sync {
      async fn execute(
          &self,
          id: String,
          params: Value,
          signal: Option<AbortSignal>,
          on_update: Box<dyn Fn(ToolResult) + Send>,
      ) -> Result<ToolResult, SpectraError>;
  }
  ```
- [ ] Implement `ToolRegistry`:
  - `DashMap<String, Tool>` storage
  - `register(tool: Tool)` - add tool
  - `unregister(name: &str)` - remove tool
  - `get(name: &str) -> Option<Tool>`
  - `list() -> Vec<Tool>`
- [ ] Add concurrent dispatch in `execute_tools()`:
  - Sequential preparation (validate args)
  - Parallel execution via `tokio::spawn`
  - Preserve order in results

**Dependencies:** Task 2, Task 4

---

### Task 6: Tool Approval
**Requirements:** CORE-09

- [ ] Define `ApprovalRequest`:
  - `tool_call: ToolCall`
  - `tool_name: String`
  - `arguments: Value`
  - `context: AgentContext`
- [ ] Define `ApprovalResult`:
  - `Allow` - proceed with execution
  - `Block { reason: String }` - reject with reason
- [ ] Define `ApprovalCallback` trait:
  ```rust
  pub trait ApprovalCallback: Send + Sync {
      fn request_approval(&self, request: ApprovalRequest) -> ApprovalResult;
  }
  ```
- [ ] Integrate into tool execution:
  - Before execution: call `approval_callback.request_approval()`
  - If blocked: return error ToolResult with reason
  - Emit `ToolExecutionStart` event regardless
- [ ] Provide default `AlwaysAllow` implementation

**Dependencies:** Task 3, Task 5

---

### Task 7: Agent Loop
**Requirements:** CORE-01, CORE-07, CORE-08

#### 7.1 Core Loop Structure
- [ ] Define `AgentConfig`:
  - `model: ModelId`
  - `tools: Arc<ToolRegistry>`
  - `approval_callback: Arc<dyn ApprovalCallback>`
  - `convert_to_llm: Arc<dyn Fn(Vec<Message>) -> Vec<LlmMessage>>`
- [ ] Define `AgentContext`:
  - `system_prompt: String`
  - `messages: Vec<Message>`
  - `tools: Vec<Tool>`
- [ ] Implement `run_agent_loop()`:
  - Takes initial messages + config + signal
  - Returns `EventStream`
  - Implements the turn loop pattern

#### 7.2 Turn Processing
- [ ] Stream assistant response via LLM client
- [ ] Parse tool calls from response
- [ ] Execute tools (with approval)
- [ ] Add tool results to history
- [ ] Loop until no more tool calls

#### 7.3 System Prompt (CORE-07)
- [ ] Include system prompt in LLM request
- [ ] Allow runtime update via context

#### 7.4 Abort Signal (CORE-08)
- [ ] Propagate signal to LLM streaming
- [ ] Propagate signal to tool execution
- [ ] Clean shutdown on abort (emit `AgentEnd` with abort status)

#### 7.5 History Management (CORE-01)
- [ ] Maintain message history across turns
- [ ] Provide `AgentContext` snapshots for tools
- [ ] Support continuation from existing context

**Dependencies:** Task 3, Task 4, Task 5, Task 6

---

### Task 8: Module Exports
**Requirements:** All

- [ ] Export all public types from `lib.rs`
- [ ] Create `prelude` module with commonly used types
- [ ] Add module-level documentation

---

## Verification

### Build Verification
- `cargo build --release` completes without errors
- All dependencies resolve
- Zero unsafe code in core logic

### Test Verification
- Unit tests for each module
- Integration test: full agent loop with mock LLM
- Tool approval test: block/allow scenarios
- Abort signal test: cancellation mid-stream

### Style Verification
- `cargo fmt`
- `cargo clippy -- -D warnings`

---

## Notes

### Zero Unsafe Policy
- No `unsafe` in core modules
- FFI only when binding to TypeScript/Python (separate crates)

### Error Handling
- All fallible operations return `Result<T, SpectraError>`
- No `unwrap()`, `expect()`, `unwrap_or()` in library code
- `?` operator propagation throughout

### Async Runtime
- Built on tokio
- All async functions use `#[async_trait]`
- Proper async cancellation via `AbortSignal`

---

**Plan Status:** Ready for Execution  
**Estimated Tasks:** 8 task groups, ~40 individual items
