# v0.2.0: Production Ready - Plan

**Phase:** v0.2.0-production
**Objective:** Make Spectra actually usable with real LLM calls, native bindings work, CI/CD in place

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| LLM-01 | Anthropic HTTP client with streaming | 🔲 |
| LLM-02 | OpenAI HTTP client with streaming | 🔲 |
| LLM-03 | Connect agent.run() to LLM clients | 🔲 |
| BUILD-05 | Configure napi-rs build | 🔲 |
| BUILD-06 | Configure PyO3+maturin build | 🔲 |
| CI-01 | GitHub Actions: Rust build + test | 🔲 |
| CI-02 | GitHub Actions: TypeScript package | 🔲 |
| CI-03 | GitHub Actions: Python wheels | 🔲 |
| CI-04 | cargo-audit in CI | 🔲 |
| TEST-01 | Integration tests with wiremock | 🔲 |
| TEST-02 | Native binding smoke tests | 🔲 |

## Success Criteria

1. `spectra-http` can call Anthropic Claude API with streaming ✓/✗
2. `spectra-http` can call OpenAI API with streaming ✓/✗
3. Agent loop invokes LLM and processes responses ✓/✗
4. `spectra-napi` builds as `.node` addon ✓/✗
5. `spectra-pyo3` builds as `.pyd/.so` wheel ✓/✗
6. GitHub Actions: build + test + clippy + audit ✓/✗
7. Integration tests mock LLM with wiremock ✓/✗
8. Native bindings can be installed and used ✓/✗

---

## Task 1: Create spectra-http crate

### Steps
1. Create `crates/spectra-http/Cargo.toml` with dependencies
2. Create `crates/spectra-http/src/lib.rs` with module declarations
3. Add to workspace `Cargo.toml`

### Dependencies
```toml
reqwest = { version = "0.12", features = ["json", "stream"] }
rustls = "0.23"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
futures-core = "0.3"
http = "1"
```

---

## Task 2: Implement Anthropic client

### Steps
1. Create `crates/spectra-http/src/anthropic.rs`
2. Implement `LlmClient` trait for `AnthropicClient`
3. Support streaming via reqwest SSE
4. Handle tool calls, images, prompt caching
5. Map to `LlmStreamEvent` enum

### API Details
- Endpoint: `https://api.anthropic.com/v1/messages`
- Auth: `x-api-key` header
- Streaming: `accept: text/event-stream`
- Body: JSON with `stream: true`

---

## Task 3: Implement OpenAI client

### Steps
1. Create `crates/spectra-http/src/openai.rs`
2. Implement `LlmClient` trait for `OpenAIClient`
3. Support streaming via reqwest SSE
4. Handle tool calls, reasoning
5. Map to `LlmStreamEvent` enum

### API Details
- Endpoint: `https://api.openai.com/v1/chat/completions`
- Auth: `Authorization: Bearer` header
- Streaming: SSE with `stream: true`

---

## Task 4: Connect Agent to LLM clients

### Steps
1. Update `packages/core/src/agent.rs` run_loop()
2. Convert messages to LLM format
3. Stream events back via channel
4. Handle tool calls - dispatch to registry
5. Build message history from responses

### Event Flow
```
User message → Agent.run() → LLM request → Stream response
                ↓
            Emit: agent_start, turn_start, message_start
                ↓
            LLM response → Parse tool calls
                ↓
            Emit: content_delta per chunk
                ↓
            Tool result → Add to history
                ↓
            Emit: message_end, turn_end, agent_end
```

---

## Task 5: Integration tests with wiremock

### Steps
1. Add `wiremock` crate to dev dependencies
2. Create `crates/spectra-http/tests/` directory
3. Write mock tests for Anthropic streaming
4. Write mock tests for OpenAI streaming
5. Test agent loop with mock LLM

### Test Cases
- Streaming text response
- Tool call with parameters
- Tool result returned to LLM
- Error handling (timeout, invalid response)
- Message history maintained across turns

---

## Task 6: Configure napi-rs build

### Steps
1. Add build configuration to `crates/spectra-napi/`
2. Create `crates/spectra-napi/build.rs` for cross-platform
3. Add npm scripts for local build
4. Document build process

### Local Build
```bash
cd crates/spectra-napi
npm install
npm run build
```

---

## Task 7: Configure PyO3+maturin build

### Steps
1. Update `crates/spectra-pyo3/Cargo.toml` for maturin
2. Add `pyproject.toml` configuration
3. Add maturin config to build for cross-platform
4. Document build process

### Local Build
```bash
cd crates/spectra-pyo3
pip install maturin
maturin develop
```

---

## Task 8: GitHub Actions CI/CD

### Steps
1. Create `.github/workflows/rust.yml`
   - cargo build, test, clippy, audit
   - Matrix: ubuntu, windows, macos
   
2. Create `.github/workflows/release-native.yml`
   - napi-rs build for all platforms
   - maturin build wheels
   - Trigger on version tags

3. Add badges to README

---

## Task 9: Native binding smoke tests

### Steps
1. Add npm package with pre-built addon tests
2. Add pip package with wheel tests
3. Verify addon loads and basic operations work

---

## Dependencies

```
Task 2 ← Task 1
Task 3 ← Task 1
Task 4 ← Task 2, Task 3
Task 5 ← Task 2, Task 3, Task 4
Task 6 ← independent
Task 7 ← independent
Task 8 ← Task 1-5
Task 9 ← Task 6, Task 7
```

---

## Verification

After all tasks:
1. `cargo build --release` succeeds
2. `cargo test -p spectra-http` passes with wiremock
3. `npm run build` in spectra-ts produces .node
4. `maturin build` in spectra-py produces .pyd
5. GitHub Actions passes on PR
6. Release workflow builds all platform binaries

---

*Plan created: 2026-04-09*
*Context: `.planning/phases/05-v0.2-production/05-CONTEXT.md`*