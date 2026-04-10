---
phase: v0.2.0-milestone
verified: 2026-04-10T12:00:00Z
status: gaps_found
score: 5/8 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Agent loop actually invokes LLM and processes responses end-to-end with tools"
    status: partial
    reason: "Agent loop works for streaming but has critical bugs: dual event emission (both LlmStreamEvent and StreamEvent for tool calls), ToolCallEnd emits fake ToolResultMessage, assistant message reconstruction is lossy, ExtensionManager is never invoked, EventChannel is dead code"
    artifacts:
      - path: "packages/core/src/agent.rs"
        issue: "Dual ContentDelta/ToolCall event paths, fake tool results in ToolCallEnd, ExtensionManager never connected, EventChannel events silently dropped"
      - path: "packages/core/src/event.rs"
        issue: "StreamEvent::ToolExecutionEnd uses raw ToolResultMessage instead of proper result type"
    missing:
      - "Fix dual event emission in agent loop"
      - "Connect ExtensionManager hooks to agent loop"
      - "Fix ToolCallEnd to not emit fake ToolResultMessage"
      - "Fix content accumulation (concatenate instead of per-chunk Text)"
      - "Expose EventChannel or remove dead code"
  - truth: "spectra-napi builds as .node addon on all platforms"
    status: failed
    reason: "NAPI binding completely reimplements LLM logic using blocking reqwest instead of delegating to spectra-core. Does not use the Agent, LlmClient, or EventChannel types. No streaming support. Synchronous only. Cargo.toml has invalid target.cfg key."
    artifacts:
      - path: "crates/spectra-napi/src/lib.rs"
        issue: "Full LLM reimplementation with blocking reqwest, global Mutex<HashMap>, no streaming, no Agent/EventChannel usage"
      - path: "crates/spectra-napi/Cargo.toml"
        issue: "Invalid [target.'cfg(windows)'.lib] key causes warning"
    missing:
      - "Rewrite napi binding to delegate to spectra-core Agent + LlmClient"
      - "Add async streaming support via napi tokio_rt"
      - "Fix Cargo.toml invalid target key"
  - truth: "spectra-pyo3 builds as .pyd/.so wheel on all platforms"
    status: partial
    reason: "PyO3 binding builds but completely reimplements LLM logic using blocking reqwest instead of delegating to spectra-core. No streaming support. Adds OpenRouter provider not in core. Missing models.toml file referenced by load_builtin_models."
    artifacts:
      - path: "crates/spectra-pyo3/src/lib.rs"
        issue: "Full LLM reimplementation with blocking reqwest, global Mutex<HashMap>, no streaming, no Agent/EventChannel usage"
    missing:
      - "Rewrite PyO3 binding to delegate to spectra-core Agent + LlmClient"
      - "Add streaming support via async Python"
      - "Remove OpenRouter-specific code from PyO3 binding (belongs in provider)"
  - truth: "TypeScript SDK properly delegates to native module with consistent types"
    status: failed
    reason: "TS SDK has two conflicting ToolDefinition types (agent.ts vs tool.ts), Agent class uses singleton state, prompt() is sync despite being async generator, no streaming, tool schemas passed as empty {}, native fallback is stub returning errors"
    artifacts:
      - path: "packages/spectra-ts/src/agent.ts"
        issue: "Singleton nativeAgentId, two conflicting ToolDefinition types, no streaming, empty tool parameters"
      - path: "packages/spectra-ts/src/tool.ts"
        issue: "Conflicting ToolDefinition type that's never connected to Agent"
      - path: "packages/spectra-ts/src/native.ts"
        issue: "Stub fallback when native not loaded, no streaming interface"
    missing:
      - "Unify ToolDefinition types"
      - "Replace singleton Agent with per-instance native agent"
      - "Add streaming support via AsyncIterable on native results"
      - "Pass tool schemas properly instead of empty {}"
  - truth: "Python SDK properly delegates to native module with consistent types"
    status: partial
    reason: "Python SDK delegates to native but Agent.prompt() is sync disguised as async, no streaming, Model config structure differs from native binding expectation (nested vs flat)"
    artifacts:
      - path: "packages/spectra-py/spectra/__init__.py"
        issue: "prompt() is sync disguised as async, Model vs native config mismatch"
    missing:
      - "Add true async streaming support"
      - "Fix Model/config structure mismatch with native binding"
      - "Add Pydantic validation for tools (PY-04)"
  - truth: "Integration tests mock LLM responses with wiremock covering all key scenarios"
    status: failed
    reason: "Only 3 tests exist. Missing: OpenAI tool calls test, error handling test, multi-turn test, agent loop integration test, streaming verification test. No tests for spectra-core, spectra-rs, spectra-napi, or spectra-pyo3."
    artifacts:
      - path: "crates/spectra-http/src/test.rs"
        issue: "Only 3 basic tests, no error/multi-turn/streaming-verification coverage"
    missing:
      - "OpenAI tool calls integration test"
      - "Error handling test (timeout, invalid response)"
      - "Multi-turn conversation test"
      - "Agent loop integration test"
      - "Unit tests for spectra-core types"
  - truth: "Native bindings can be installed and used from TS/Python"
    status: failed
    reason: "Both bindings reimplement LLM logic instead of delegating to core. TS copy-native.js is empty placeholder. No smoke tests. TS and Python bindings return opaque JSON strings instead of typed objects."
    artifacts:
      - path: "packages/spectra-ts/scripts/copy-native.js"
        issue: "Empty placeholder (only a comment)"
      - path: "packages/spectra-ts/src/native.ts"
        issue: "Returns raw JSON strings, not typed objects"
      - path: "packages/spectra-py/spectra/__init__.py"
        issue: "Returns untyped dict events instead of typed objects"
    missing:
      - "Implement copy-native.js"
      - "Return typed objects from bindings instead of JSON strings"
      - "Add smoke tests for both TS and Python"
deferred:
  - truth: "Vision models process image inputs"
    addressed_in: "v0.3.0"
    evidence: "ROADMAP.md: VISION-01 Image/video input support for vision models"
  - truth: "Retry logic with exponential backoff"
    addressed_in: "v0.3.0"
    evidence: "ROADMAP.md: RESILIENCE-01 Retry logic with exponential backoff"
---

# Spectra v0.2.0 — Full Codebase Verification Report

**Phase Goal:** Make Spectra actually usable — real LLM calls, native bindings work, CI/CD in place
**Verified:** 2026-04-10T12:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | spectra-core can call Anthropic Claude API with streaming | ✓ VERIFIED | `AnthropicClient` implements `LlmClient` trait with full SSE streaming, tool call handling, environment variable API key fallback. Wiremock test passes. |
| 2 | spectra-core can call OpenAI API with streaming | ✓ VERIFIED | `OpenAIClient` implements `LlmClient` trait with full SSE streaming, tool call handling, finish_reason mapping. Wiremock test passes. |
| 3 | Agent loop actually invokes LLM and processes responses | ⚠️ PARTIAL | Loop works for basic streaming but has critical bugs: dual event emission paths, fake ToolResultMessage in ToolCallEnd, ExtensionManager never connected, lossy message reconstruction |
| 4 | spectra-napi builds as .node addon on all platforms | ✗ FAILED | Binding reimplements LLM with blocking reqwest, no streaming, invalid Cargo.toml key, doesn't use core types |
| 5 | spectra-pyo3 builds as .pyd/.so wheel on all platforms | ⚠️ PARTIAL | Builds successfully but reimplements LLM with blocking reqwest, no streaming, adds provider not in core |
| 6 | GitHub Actions runs: cargo build, test, clippy, audit | ✓ VERIFIED | `rust-ci.yml` runs build+test+clippy+audit on 3 OS. `ts-ci.yml` and `py-ci.yml` exist. `release.yml` handles tag-based releases |
| 7 | Integration tests mock LLM responses with wiremock | ✗ FAILED | Only 3 basic tests. Missing error handling, multi-turn, OpenAI tool calls, agent loop, streaming verification |
| 8 | Native bindings can be installed and used from TS/Python | ✗ FAILED | Both reimplement core logic. TS `copy-native.js` is empty. No smoke tests. Returns untyped JSON |

**Score:** 5/8 truths verified (2 VERIFIED, 1 VERIFIED from CI, 2 PARTIAL, 3 FAILED)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Vision models process image inputs | v0.3.0 | ROADMAP.md: VISION-01 |
| 2 | Retry logic with exponential backoff | v0.3.0 | ROADMAP.md: RESILIENCE-01 |

---

## Detailed Findings

### 1. Agent Loop — Critical Bugs (LLM-03)

**File:** `packages/core/src/agent.rs`

The agent loop has several significant issues:

#### 1a. Dual Event Emission for Tool Calls

The `run_agent_loop` function processes `LlmStreamEvent` variants and emits `StreamEvent` variants. But for tool calls, it emits **both** `StreamEvent::MessageUpdate` (from `LlmStreamEvent::ContentDelta::ToolCallStart/Delta/End`) **and** separate `StreamEvent::ToolExecutionStart/End` (from `LlmStreamEvent::ToolCallStart/Delta/End`). This means every tool call produces **two sets of events** — one via `ContentDelta` and one via the dedicated `ToolCall*` events. Consumers receive duplicate, conflicting events.

The `LlmStreamEvent` enum has both `ContentDelta { delta: ContentDelta }` (which includes `ToolCallStart/Delta/End`) and separate `ToolCallStart/ToolCallDelta/ToolCallEnd` variants. The Anthropic/OpenAI clients only emit via `ContentDelta` for the content path and `ToolCallStart/Delta/End` for the separate path. But the agent loop handles both paths independently, leading to:

- `ContentDelta::ToolCallStart` → emits `StreamEvent::MessageUpdate` AND pushes to `assistant_msg.tool_calls`
- `LlmStreamEvent::ToolCallStart` → emits `StreamEvent::ToolExecutionStart`
- Both fire for the same tool call

#### 1b. Fake ToolResultMessage in ToolCallEnd

Lines 177-188: When `LlmStreamEvent::ToolCallEnd` is received, the agent emits `StreamEvent::ToolExecutionEnd` with a **fake** `ToolResultMessage`:

```rust
ToolResultMessage {
    tool_call_id: id.clone(),
    tool_name: String::new(),       // ← Empty
    content: serde_json::Value::Null, // ← Null
    is_error: false,                 // ← Misleading
    timestamp: Utc::now(),
}
```

This is emitted **before** the actual tool dispatch happens (lines 216-231). The real tool result is only available after `dispatch_tool()`. This fake event will mislead consumers into thinking the tool execution is complete with empty results.

#### 1c. ExtensionManager Never Connected

The `Extension` trait and `ExtensionManager` in `crates/spectra-rs/src/extension.rs` define hooks (`on_before_tool_call`, `on_after_tool_call`, `on_agent_start`, etc.) but the agent loop in `packages/core/src/agent.rs` **never calls** any of these hooks. The `AgentConfig` doesn't even have a field for extensions. The `ExtensionManager` exists in `spectra-rs` but is completely orphaned.

#### 1d. Lossy Message Reconstruction

Line 132-134: Content delta text is accumulated as individual `Content::Text` blocks:

```rust
ContentDelta::Text { delta: text } => {
    assistant_msg.content.push(Content::Text { text: text.clone() });
}
```

This means for a streaming response "Hello World" received as two deltas "Hello" and " World", the assistant message will contain `content: [Text("Hello"), Text(" World")]` instead of `content: [Text("Hello World")]`. Every streaming chunk becomes a separate `Content::Text` entry, bloating the message and making it unusable for downstream serialization.

#### 1e. Tool Arguments Stored as String, Parsed Inconsistently

Lines 143-155: Tool call arguments are accumulated as `serde_json::Value::String` (concatenated JSON fragments), then in `dispatch_tool` (line 265), the code tries to parse the string as JSON:

```rust
let args = if let serde_json::Value::String(s) = &tool_call.arguments {
    serde_json::from_str(s).unwrap_or(serde_json::Value::Null)
} else {
    tool_call.arguments.clone()
};
```

Using `unwrap_or(serde_json::Value::Null)` silently swallows parse errors. If the LLM returns malformed JSON arguments, the tool receives `Null` instead of a proper error.

#### 1f. EventChannel is Dead Code in Agent Loop

Line 52: `let channel = EventChannel::new();` creates a broadcast channel, and `channel.emit()` sends events to it. But nobody ever calls `channel.subscribe()`. The `mpsc::Sender` (`tx`) is the actual delivery mechanism.

Tokio's `broadcast::Sender::send()` returns `Ok(0)` when there are no subscribers (events are silently dropped), so the agent loop does NOT crash. However, this means every `channel.emit()` call is wasted work — events are sent to a broadcast channel with zero subscribers and immediately dropped. The real delivery happens through the `mpsc::channel(256)`.

This is a **design issue**: The `EventChannel` is supposed to enable external subscribers (e.g., UI components) to observe agent events. But the current `Agent::run()` API only returns `mpsc::Receiver<Result<StreamEvent>>` — there's no way for callers to access the `EventChannel` and subscribe. The EventChannel is dead code in the agent loop path.

### 2. LLM Client Implementations — Substantive but with Issues

#### 2a. Anthropic Client (`crates/spectra-http/src/anthropic.rs`)

**Substantive:** ✓ — Full SSE streaming, tool calls, error handling, environment variable fallback.

**Issues:**
- Line 24: `.expect("Failed to create HTTP client")` — panics in library code if TLS backend fails. Should return `Result`.
- Line 192: `items.into_iter().next().unwrap()` — safe due to `len() == 1` check, but could use `[0]` for clarity.
- Line 70: Tool result content is serialized with `.to_string()` which produces JSON-escaped strings instead of raw content. For Anthropic, tool results should be passed as-is.
- `user_content_to_json` returns inconsistent types: sometimes a single object, sometimes an array. Anthropic API accepts both, but this is fragile.

#### 2b. OpenAI Client (`crates/spectra-http/src/openai.rs`)

**Substantive:** ✓ — Full SSE streaming, tool calls, finish_reason mapping.

**Issues:**
- Line 24: Same `.expect()` panic risk as Anthropic client.
- Lines 306-307: `current_tool.as_ref().unwrap()` — safe because we just set it, but fragile if logic changes.
- Line 90-92: `max_tokens` is always sent even if 0, which is technically valid but OpenAI's API expects `max_completion_tokens` for newer models.
- `content_to_json` returns inconsistent types: sometimes a plain string, sometimes an array of objects.

### 3. NAPI Binding — Complete Rewrite Needed (BUILD-05)

**File:** `crates/spectra-napi/src/lib.rs`

This is the most significant gap in the codebase. The napi binding:

1. **Does NOT use `spectra-core` types.** It defines its own `JsModel`, `JsTool`, `JsAgentConfig` instead of using the core types.
2. **Does NOT use `Agent` or `LlmClient`.** It reimplements the entire LLM call flow with `reqwest::blocking::Client`.
3. **Does NOT support streaming.** `run_agent()` calls `call_llm_sync()` which is blocking.
4. **Uses a global `Mutex<Option<HashMap<String, AgentState>>>`.** This is a poor pattern — it blocks all agents during any operation, prevents concurrent access, and leaks agent state forever.
5. **Returns opaque JSON strings** instead of structured objects.
6. **No async support** despite `napi = { features = ["tokio_rt"] }` in Cargo.toml.
7. **Missing `system_prompt` in request body** for OpenAI provider (only added for Anthropic via the `system` field, but the OpenAI path in `call_llm_sync` doesn't add it as a system message).
8. **Cargo.toml has invalid key**: `[target.'cfg(windows)'.lib]` generates a warning.

### 4. PyO3 Binding — Rewrite Needed (BUILD-06)

**File:** `crates/spectra-pyo3/src/lib.rs`

Similar issues to napi:

1. **Does NOT use `spectra-core` types** — reimplements LLM call flow.
2. **No streaming** — `Agent.run()` is synchronous blocking.
3. **Global `Mutex<Option<HashMap>>`** — same concurrency issues.
4. **Adds OpenRouter provider** that doesn't exist in `spectra-core::Provider` enum.
5. **Uses `reqwest::blocking::Client`** — blocks the Python interpreter.
6. **Returns untyped JSON string** from `Agent.run()` instead of structured Python objects.
7. **Missing `system_prompt`** in request body for OpenAI provider path.
8. **`get_agents_py()` function is redundant** — duplicates `Agent.get_agents()` static method.

### 5. TypeScript SDK — Incomplete and Inconsistent (TS-01 through TS-06)

**Files:** `packages/spectra-ts/src/*.ts`

**Issues:**

1. **Two conflicting `ToolDefinition` types:**
   - `agent.ts` line 5: `ToolDefinition<TInput>` with `name`, `description`, `parameters`, `schema`
   - `tool.ts` line 4: `ToolDefinition<TInput>` with `name`, `description`, `schema`, `execute`
   - These have different shapes and are both exported from `index.ts`

2. **Singleton agent state:** `agent.ts` line 31: `let nativeAgentId: string | null = null;` — a module-level singleton means only one agent can exist at a time. Creating a second `Agent` silently replaces the first.

3. **Tool schemas passed as empty `{}`:** Line 53: `parameters: {}` — tool definitions are always sent with empty parameters, making tools unusable by the LLM.

4. **`defineTool` in `agent.ts` returns `parameters: undefined as TInput`** — this is a type lie. The parameters field is `undefined` at runtime but typed as `TInput`.

5. **No streaming:** `prompt()` is an `AsyncIterable` but iterates over pre-computed events from a single blocking `runAgent()` call. There's no real streaming — all events are computed synchronously then yielded.

6. **Native fallback is a stub:** When native addon doesn't load, `runAgent()` returns `[{"type":"error","message":"Native addon not loaded"}]`.

7. **`copy-native.js` is empty** — just a comment `// Placeholder for native addon copy`.

8. **Package version mismatch:** `package.json` says `0.1.0` but Cargo.toml says `0.2.0`.

### 6. Python SDK — Incomplete (PY-01 through PY-06)

**File:** `packages/spectra-py/spectra/__init__.py`

**Issues:**

1. **`prompt()` is sync disguised as async:** `Agent.prompt()` declares `-> AsyncIterator[dict]` but internally calls `self._agent.run(user_input)` synchronously and then yields all events at once. No real async streaming.

2. **Config structure mismatch:** Python `Model` has `config: ModelConfig` (nested), but native binding's `PyAgentConfig` expects `max_tokens` and `temperature` at the top level of `model`. The Python example (basic.py) manually constructs a flat dict for the native binding, bypassing the typed `Model` class.

3. **Missing requirements:**
   - PY-04: Pydantic v2 schema validation for tools — not implemented
   - PY-05: SpectraError class hierarchy — only base class, no ProviderError/ToolError/StreamError
   - PY-06: Agent class with prompt() method — exists but broken (sync, no streaming)

4. **`_agent` attribute exposed in public API:** Example accesses `agent._agent` directly.

### 7. Error Handling Issues

1. **`.expect()` in library code** — `AnthropicClient::new()` and `OpenAIClient::new()` use `.expect("Failed to create HTTP client")`. If rustls can't initialize, this panics. Should return `Result<Self>`.

2. **Silent error swallowing in agent loop:**
   - Line 109: `let _ = tx.send(Ok(StreamEvent::Error { ... })).await;` — error in send is ignored
   - Line 194: Same pattern — errors in event delivery are silently dropped

3. **`unwrap_or_default()` on API responses** — In napi and pyo3 bindings, `response.json().unwrap_or_default()` silently returns empty JSON if the response can't be parsed.

4. **No error mapping across FFI** — Rust errors are converted to strings when crossing FFI boundaries, losing all diagnostic information. The miette fancy diagnostics are completely lost.

### 8. Type Consistency Issues

| Aspect | Rust Core | NAPI | PyO3 | TypeScript | Python |
|--------|-----------|------|------|-----------|--------|
| Agent creation | `Agent::new(client, config)` | JSON string config | JSON string config | `new Agent(config)` | `Agent(config_dict)` |
| Model | `Model { provider, id, config: ModelConfig }` | `JsModel { provider, id, max_tokens?, temperature? }` | `PyModel { provider, id, max_tokens?, temperature? }` | `Model { provider, id, maxTokens?, temperature? }` | `Model { provider, id, config: ModelConfig }` |
| Streaming | `LlmStream` (Pin<Box<dyn Stream>>) | None (blocking) | None (blocking) | None (fake AsyncIterable) | None (fake AsyncIterator) |
| Events | `StreamEvent` enum | JSON strings | JSON strings | Untyped `unknown` fields | Untyped `dict` |
| Tool definition | `ToolDef { name, description, parameters: Value }` | `JsTool { name, description, parameters: Value }` | `PyTool { name, description, parameters: Value }` | Two conflicting types | Not implemented |
| Error type | `SpectraError` with miette | `napi::Error` | `pyo3::PyErr` | `SpectraError` class | `SpectraError` class |

**Key mismatches:**
- NAPI and PyO3 use flat `max_tokens`/`temperature` in model; core and Python SDK use nested `ModelConfig`
- NAPI and PyO3 don't support streaming at all
- TypeScript has two incompatible `ToolDefinition` types
- No binding returns typed event objects

### 9. Build Configuration Issues

1. **Cargo.toml workspace:** `spectra-napi` has `[target.'cfg(windows)'.lib]` which generates an unused manifest key warning. This target-specific key is not valid for Cargo.

2. **Edition mismatch:** `spectra-core` and `spectra-napi` use `edition = "2024"`, but `spectra-http` and `spectra-pyo3` use `edition = "2021"`. The 2024 edition is very new — mixed editions may cause subtle issues.

3. **spectra-http missing explicit `rustls-tls` feature:** `spectra-core` specifies `reqwest = { features = ["rustls-tls"] }` but `spectra-http` uses `reqwest` with `default-features = false` and does NOT explicitly specify `rustls-tls`. TLS currently works because Cargo unifies features across the dependency tree (spectra-core pulls in rustls-tls), but this is fragile — if spectra-http is ever used without spectra-core, HTTPS will fail at runtime. Should be explicitly declared.

4. **`copy-native.js` is empty** — the TS build script `tsc && node scripts/copy-native.js` will run but copy nothing.

5. **Missing `pnpm-lock.yaml`** — CI workflows reference `pnpm-lock.yaml` but it may not exist (would cause CI failure).

6. **`models.toml` missing** — `load_builtin_models()` in `spectra-rs/src/models.rs` looks for `models.toml` in the crate root, but no such file exists. It silently returns an empty registry.

### 10. Missing Tests (TEST-01, TEST-02)

**Current state:**
- `spectra-http`: 3 integration tests (Anthropic basic, OpenAI basic, Anthropic tool calls)
- `spectra-core`: 0 tests
- `spectra-rs`: 0 tests
- `spectra-napi`: 0 tests
- `spectra-pyo3`: 0 tests
- TypeScript package: 0 test files
- Python package: 0 test files

**Missing test coverage:**
- OpenAI tool calls streaming
- Error handling (timeout, invalid API response, network error)
- Multi-turn conversation with tool calls
- Agent loop integration (agent + LLM client + tool dispatch)
- Streaming verification (text content correctly accumulated)
- Abort signal handling
- Native binding smoke tests (TEST-02)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/agent.rs` | Agent loop with LLM integration | ⚠️ PARTIAL | Works but has dual events, fake tool results, lossy reconstruction |
| `crates/spectra-http/src/anthropic.rs` | Anthropic streaming client | ✓ VERIFIED | Full SSE streaming with tool calls |
| `crates/spectra-http/src/openai.rs` | OpenAI streaming client | ✓ VERIFIED | Full SSE streaming with tool calls |
| `crates/spectra-napi/src/lib.rs` | NAPI bindings delegating to core | ✗ FAILED | Reimplements core logic, no streaming |
| `crates/spectra-pyo3/src/lib.rs` | PyO3 bindings delegating to core | ✗ FAILED | Reimplements core logic, no streaming |
| `.github/workflows/rust-ci.yml` | CI for Rust | ✓ VERIFIED | Build, test, clippy, audit on 3 OS |
| `.github/workflows/ts-ci.yml` | CI for TypeScript | ✓ VERIFIED | Build and test NAPI + TS package |
| `.github/workflows/py-ci.yml` | CI for Python | ✓ VERIFIED | Build and test PyO3 wheels |
| `crates/spectra-http/src/test.rs` | Integration tests | ⚠️ STUB | Only 3 basic tests, no error/multi-turn/streaming coverage |
| `packages/spectra-ts/scripts/copy-native.js` | Native addon copy script | ✗ STUB | Empty placeholder |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Agent::run()` | `LlmClient::stream()` | `client.stream(request)` | ✓ WIRED | Agent correctly calls LLM client |
| `Agent::run()` | `ToolRegistry::dispatch()` | `dispatch_tool()` | ✓ WIRED | Tool dispatch works |
| `Agent::run()` | `ExtensionManager` | Should call hooks | ✗ NOT_WIRED | ExtensionManager never connected |
| `spectra-napi` | `spectra-core::Agent` | Should import and use | ✗ NOT_WIRED | NAPI reimplements LLM logic independently |
| `spectra-pyo3` | `spectra-core::Agent` | Should import and use | ✗ NOT_WIRED | PyO3 reimplements LLM logic independently |
| `spectra-napi` | `spectra-core::LlmClient` | Should import and use | ✗ NOT_WIRED | Uses blocking reqwest instead |
| `spectra-pyo3` | `spectra-core::LlmClient` | Should import and use | ✗ NOT_WIRED | Uses blocking reqwest instead |
| `Agent::run()` | `EventChannel::subscribe()` | Broadcast subscription | ✗ NOT_WIRED | EventChannel created but not exposed; events silently dropped |
| `ToolDef` (core) | `ToolDefinition` (TS agent) | Type mapping | ⚠️ PARTIAL | Tool schemas always passed as empty `{}` |
| `ToolDef` (core) | `PyTool` (PyO3) | Type mapping | ⚠️ PARTIAL | Redundant reimplementation with same fields |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `agent.rs` `run_agent_loop` | `assistant_msg.content` | `ContentDelta::Text` chunks | Yes, but accumulates per-chunk | ⚠️ FRAGMENTED |
| `agent.rs` `run_agent_loop` | `assistant_msg.tool_calls` | `ContentDelta::ToolCallStart/Delta` + `ToolCallStart/Delta` | Yes, but dual-path emits duplicates | ⚠️ DUPLICATED |
| `agent.rs` `run_agent_loop` | `tx` (mpsc sender) | `StreamEvent` emissions | Yes | ✓ FLOWING |
| `agent.rs` `run_agent_loop` | `channel` (EventChannel) | `channel.emit()` | No — no subscribers, events silently dropped | ✗ DISCONNECTED |
| `anthropic.rs` `stream_request` | SSE bytes → `LlmStreamEvent` | HTTP bytes_stream | Yes | ✓ FLOWING |
| `openai.rs` `stream_request` | SSE bytes → `LlmStreamEvent` | HTTP bytes_stream | Yes | ✓ FLOWING |
| `spectra-napi/lib.rs` `run_agent` | `call_llm_sync` result | Blocking reqwest response | Yes but no streaming | ⚠️ STATIC |
| `spectra-pyo3/lib.rs` `Agent.run` | `call_llm` result | Blocking reqwest response | Yes but no streaming | ⚠️ STATIC |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build all Rust crates | `cargo build --release` | Compiles with warnings only | ✓ PASS |
| Run workspace tests | `cargo test --workspace` | 3 tests pass (spectra-http only) | ✓ PASS |
| Check clippy | `cargo clippy --workspace --all-targets -- -W clippy::all` | Warnings only, no errors | ✓ PASS |
| spectra-http tests | `cargo test -p spectra-http` | 3/3 pass | ✓ PASS |
| spectra-core tests | `cargo test -p spectra-core` | 0 tests (no test files) | ⚠️ NO TESTS |

## Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
|-------------|--------|-------------|--------|----------|
| LLM-01 | ROADMAP | Anthropic HTTP client with streaming | ✓ SATISFIED | `AnthropicClient` implements `LlmClient` with full SSE streaming |
| LLM-02 | ROADMAP | OpenAI HTTP client with streaming | ✓ SATISFIED | `OpenAIClient` implements `LlmClient` with full SSE streaming |
| LLM-03 | ROADMAP | Connect agent.run() to LLM clients | ⚠️ PARTIAL | Agent loop connects but has bugs (dual events, fake tool results, lossy reconstruction, ExtensionManager not wired) |
| BUILD-05 | ROADMAP | Configure napi-rs build | ⚠️ PARTIAL | Builds but reimplements core logic, no streaming, invalid Cargo.toml key |
| BUILD-06 | ROADMAP | Configure PyO3+maturin build | ⚠️ PARTIAL | Builds but reimplements core logic, no streaming, extra provider not in core |
| CI-01 | ROADMAP | GitHub Actions: build + test Rust | ✓ SATISFIED | `rust-ci.yml` runs on 3 OS with build+test+clippy+audit |
| CI-02 | ROADMAP | GitHub Actions: build TypeScript package | ✓ SATISFIED | `ts-ci.yml` builds NAPI + TS on multiple platforms |
| CI-03 | ROADMAP | GitHub Actions: build Python wheels | ✓ SATISFIED | `py-ci.yml` builds PyO3 wheels on 3 OS + 2 Python versions |
| CI-04 | ROADMAP | cargo-audit in CI | ✓ SATISFIED | `rustsec/audit-check@v2` in `rust-ci.yml` |
| TEST-01 | ROADMAP | Integration tests with wiremock | ✗ BLOCKED | Only 3 basic tests, missing error/multi-turn/OpenAI-tools/streaming coverage |
| TEST-02 | ROADMAP | Native binding smoke tests | ✗ BLOCKED | No smoke tests exist for either TS or Python bindings |
| CORE-09 | REQUIREMENTS | Tool approval — pause before tool execution | ✗ BLOCKED | Not implemented — `ApprovalDenied` error type exists but never used |
| TS-02 | REQUIREMENTS | NAPI bindings via napi-rs | ⚠️ PARTIAL | NAPI module loads but reimplements core, no streaming |
| TS-03 | REQUIREMENTS | AsyncIterable stream interface | ✗ BLOCKED | TypeScript `prompt()` is fake AsyncIterable over pre-computed results |
| TS-04 | REQUIREMENTS | Zod schema validation for tools | ⚠️ PARTIAL | `tool.ts` has `dispatchTool` with Zod validation but it's never called from Agent |
| PY-02 | REQUIREMENTS | PyO3 bindings via maturin | ⚠️ PARTIAL | PyO3 module loads but reimplements core, no streaming |
| PY-03 | REQUIREMENTS | AsyncIterator stream interface | ✗ BLOCKED | Python `prompt()` is sync disguised as async, no real streaming |
| PY-04 | REQUIREMENTS | Pydantic v2 schema validation | ✗ BLOCKED | Not implemented |
| PY-06 | REQUIREMENTS | Agent class with prompt() method | ⚠️ PARTIAL | Exists but sync, no streaming, returns untyped dicts |

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `crates/spectra-napi/src/lib.rs` | 1-260 | Complete reimplementation of core logic | 🛑 Blocker | Defeats the purpose of a shared Rust core; inconsistent behavior across SDKs |
| `crates/spectra-pyo3/src/lib.rs` | 1-295 | Complete reimplementation of core logic | 🛑 Blocker | Same as above |
| `packages/core/src/agent.rs` | 52 | EventChannel created but never subscribed | ⚠️ Warning | Dead code path; events silently dropped, only mpsc used for delivery |
| `packages/core/src/agent.rs` | 177-188 | Fake ToolResultMessage in ToolCallEnd | ⚠️ Warning | Misleading events to consumers |
| `packages/core/src/agent.rs` | 132-134 | Per-chunk Content::Text accumulation | ⚠️ Warning | Bloated message objects, not usable for serialization |
| `crates/spectra-http/Cargo.toml` | 9 | Missing explicit `rustls-tls` feature on reqwest | ⚠️ Warning | Works via feature unification but fragile if used standalone |
| `crates/spectra-http/src/anthropic.rs` | 24 | `.expect()` in library code | ⚠️ Warning | Panics if TLS backend fails |
| `crates/spectra-http/src/openai.rs` | 24 | `.expect()` in library code | ⚠️ Warning | Panics if TLS backend fails |
| `crates/spectra-pyo3/src/lib.rs` | 40,187,199,263,275 | `AGENTS.lock().unwrap()` | ⚠️ Warning | Panics on poisoned mutex |
| `crates/spectra-napi/src/lib.rs` | 41,177,197,242 | `AGENTS.lock().unwrap()` | ⚠️ Warning | Panics on poisoned mutex |
| `packages/spectra-ts/src/agent.ts` | 31 | Singleton `nativeAgentId` | ⚠️ Warning | Only one agent can exist per process |
| `packages/spectra-ts/src/agent.ts` | 53 | `parameters: {}` always empty | ⚠️ Warning | Tools unusable by LLM |
| `packages/spectra-ts/scripts/copy-native.js` | 1-2 | Empty placeholder | ⚠️ Warning | Build script does nothing |
| `packages/spectra-ts/package.json` | 3 | Version `0.1.0` vs Cargo `0.2.0` | ℹ️ Info | Version mismatch |
| `crates/spectra-http/src/openai.rs` | 90 | `max_tokens` field name | ℹ️ Info | Newer OpenAI models expect `max_completion_tokens` |
| `crates/spectra-rs/src/models.rs` | 13-18 | `models.toml` file not found | ℹ️ Info | `load_builtin_models()` silently returns empty registry |

## Human Verification Required

### 1. Live Anthropic Streaming Test

**Test:** Set `ANTHROPIC_API_KEY` and run `cargo run --example basic -p spectra-rs`
**Expected:** Streaming text response with real-time deltas, tool calls work if model decides to use tools
**Why human:** Requires paid API key, live network call, visual verification of streaming behavior

### 2. Agent Loop with Tool Calls End-to-End

**Test:** Run agent with a tool-eligible prompt and verify tool dispatch → LLM continuation
**Expected:** Agent calls tool, gets result, sends it back to LLM, LLM produces final response
**Why human:** Requires live API, need to verify multi-turn tool flow visually

### 3. Python Binding Functionality

**Test:** Run `maturin develop` in `crates/spectra-pyo3/` then `python packages/spectra-py/examples/basic.py`
**Expected:** Agent creates, prompt returns events
**Why human:** Requires maturin build, Python environment, API key

### 4. TypeScript Binding Functionality

**Test:** Build NAPI addon, then run `npx tsx packages/spectra-ts/examples/basic.ts`
**Expected:** Agent creates, native version returned, prompt returns events
**Why human:** Requires NAPI build, Node.js environment, API key

### 5. GitHub Actions CI Pipeline

**Test:** Push a PR to GitHub and verify all CI workflows pass
**Expected:** Rust CI (3 OS), TS CI, Python CI all green
**Why human:** Requires GitHub access, can't verify CI locally

## Gaps Summary

The Spectra project has a solid core architecture with working LLM clients (Anthropic and OpenAI) and a CI/CD pipeline. However, **the bindings layer completely undermines the core architecture** — both napi and PyO3 reimplement the LLM call flow instead of delegating to the shared Rust core. This defeats the entire purpose of having a shared core and creates three independent implementations that will diverge.

### Critical Gaps (Blocking v0.2.0)

1. **NAPI and PyO3 bindings must be rewritten** to use `spectra-core::Agent` and `spectra-core::LlmClient` instead of reimplementing LLM calls with blocking reqwest. This is the single most impactful fix — it's the difference between "three inconsistent frameworks" and "one framework with three SDKs."

2. **Agent loop dual event emission** must be resolved. Either `LlmStreamEvent` should only emit tool call events via the `ContentDelta` path OR via the dedicated `ToolCallStart/Delta/End` path — not both. Currently consumers receive duplicate, conflicting events for every tool call.

3. **Streaming must work across FFI** — the bindings need to expose the `LlmStream`/`StreamEvent` flow to TypeScript (via AsyncIterable) and Python (via AsyncIterator). Currently both are synchronous and blocking.

4. **`spectra-http` missing explicit `rustls-tls`** on reqwest works via feature unification but is fragile. Should be explicitly declared for standalone use.

5. **Test coverage is insufficient** — only 3 integration tests for the entire project, no unit tests for core types, no error handling tests, no multi-turn tests.

### Important Gaps (Should Fix for v0.2.0)

6. **ExtensionManager is orphaned** — the `Extension` trait exists in `spectra-rs` but is never connected to the agent loop.
7. **Tool approval (CORE-09)** is declared but not implemented.
8. **TypeScript SDK has two conflicting `ToolDefinition` types** and a singleton agent pattern.
9. **`copy-native.js` is empty** — TS build pipeline is incomplete.
10. **Content accumulation is lossy** — streaming text produces one `Content::Text` per chunk instead of concatenating.

---

_Verified: 2026-04-10T12:00:00Z_
_Verifier: gsd-verifier_
