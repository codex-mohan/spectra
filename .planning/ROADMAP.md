# Roadmap: Spectra

**Created:** 2026-04-08
**Updated:** 2026-04-09
**Granularity:** Coarse
**Total Milestones:** 5 (v0.1.0-v0.5.0)

## Milestone Summary

| Milestone | Goal | Status | Key Deliverables |
|-----------|------|--------|------------------|
| **v0.1.0** | Core Primitives | ✅ Complete | Agent trait, LLM trait, tool registry, typed errors, event stream, SDK wrappers |
| **v0.2.0** | Production Ready | 🔲 Next | LLM implementations, native builds, CI/CD, integration tests |
| **v0.3.0** | Feature Complete | 🔲 Future | More providers, vision, retry/rate-limit, token tracking |
| **v0.4.0** | Developer Experience | 🔲 Future | CLI, REPL, debug mode, documentation |
| **v0.5.0** | Enterprise | 🔲 Future | Multi-agent, persistence, budgets |

---

## v0.1.0: Core Primitives ✅

**Completed:** 2026-04-09

### What Was Built

| Component | Files | Status |
|-----------|-------|--------|
| spectra-core | `packages/core/src/*.rs` | ✅ |
| spectra-rs | `crates/spectra-rs/` | ✅ |
| spectra-ts (types) | `packages/spectra-ts/` | ✅ |
| spectra-py (types) | `packages/spectra-py/` | ✅ |

### Success Criteria Met

- [x] Agent loop with message history management
- [x] LLM client abstraction trait (no implementations yet)
- [x] Tool registry with concurrent dispatch
- [x] Typed error system with miette diagnostics
- [x] Event stream for real-time updates
- [x] Message types (User, Assistant, ToolResult)
- [x] System prompt handling
- [x] Abort signal support
- [x] Extension trait for hooks
- [x] `spectra_rs::prelude::*` with all types

### Verification

```
cargo build --release ✓
cargo test -p spectra-core -p spectra-rs ✓
Doctests pass ✓
```

---

## v0.2.0: Production Ready 🔲

**Goal:** Make Spectra actually usable - real LLM calls, native bindings work, CI/CD in place

### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| LLM-01 | Anthropic HTTP client with streaming | Critical |
| LLM-02 | OpenAI HTTP client with streaming | Critical |
| LLM-03 | Connect agent.run() to LLM clients | Critical |
| BUILD-05 | Configure napi-rs build for Windows/macOS/Linux | High |
| BUILD-06 | Configure PyO3+maturin build for wheels | High |
| CI-01 | GitHub Actions: build + test Rust | High |
| CI-02 | GitHub Actions: build TypeScript package | Medium |
| CI-03 | GitHub Actions: build Python wheels | Medium |
| CI-04 | cargo-audit in CI | Medium |
| TEST-01 | Integration tests with wiremock | High |
| TEST-02 | Native binding smoke tests | Medium |

### Success Criteria

1. `spectra-core` can call Anthropic Claude API with streaming
2. `spectra-core` can call OpenAI API with streaming
3. Agent loop actually invokes LLM and processes responses
4. `spectra-napi` builds as `.node` addon on all platforms
5. `spectra-pyo3` builds as `.pyd/.so` wheel on all platforms
6. GitHub Actions runs: `cargo build`, `cargo test`, `cargo clippy`, `cargo audit`
7. Integration tests mock LLM responses with wiremock
8. Native bindings can be installed and used from TS/Python

### Dependencies

- **Blockers:** None
- **Depends on:** v0.1.0 (complete)

---

## v0.3.0: Feature Complete 🔲

**Goal:** Full feature parity with production agent frameworks

### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| LLM-04 | Groq client support | Medium |
| LLM-05 | Ollama/local model support | Medium |
| VISION-01 | Image/video input support for vision models | Medium |
| RESILIENCE-01 | Retry logic with exponential backoff | High |
| RESILIENCE-02 | Rate limiting per provider | Medium |
| RESILIENCE-03 | Circuit breaker for failed providers | Low |
| TRACKING-01 | Token usage tracking | Medium |
| TRACKING-02 | Cost estimation | Low |
| TOOLS-01 | Tool result caching | Low |

### Success Criteria

1. Groq models can be used as LLM provider
2. Local Ollama models work via HTTP
3. Vision models process image inputs
4. Failed LLM calls retry automatically
5. Rate limits are respected per provider
6. Token usage is tracked and reported

---

## v0.4.0: Developer Experience 🔲

**Goal:** Make it easy to build with and debug Spectra

### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| CLI-01 | `spectra` CLI tool | High |
| CLI-02 | Interactive REPL for testing | Medium |
| DEBUG-01 | Debug logging mode | High |
| DEBUG-02 | Structured tracing with tracing crate | High |
| DOCS-01 | README with quick start | High |
| DOCS-02 | API documentation (docs.rs) | High |
| DOCS-03 | Examples for each language | Medium |
| DX-01 | Comprehensive error messages | Medium |

### Success Criteria

1. `cargo install spectra` installs CLI
2. `spectra repl` opens interactive REPL
3. `RUST_LOG=spectra=debug` enables verbose logging
4. docs.rs has complete API docs
5. Working examples in Rust, TypeScript, Python

---

## v0.5.0: Enterprise 🔲

**Goal:** Features for production deployments

### Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| MULTI-01 | Multi-agent orchestration | High |
| PERSIST-01 | Conversation persistence (file/DB) | Medium |
| PERSIST-02 | Conversation import/export | Low |
| BUDGET-01 | Token budget enforcement | Medium |
| BUDGET-02 | Spending alerts | Low |
| SEC-01 | API key rotation | Low |
| SEC-02 | Audit logging | Low |

### Success Criteria

1. Multiple agents can communicate
2. Conversations persist across restarts
3. Budget limits prevent overspending

---

## Traceability Matrix

| Requirement | Milestone |
|-------------|-----------|
| CORE-01 to CORE-09 | v0.1.0 |
| RUST-01 to RUST-04 | v0.1.0 |
| TS-01, TS-03 to TS-06 | v0.1.0 |
| PY-01, PY-03 to PY-06 | v0.1.0 |
| LLM-01, LLM-02, LLM-03 | v0.2.0 |
| BUILD-05, BUILD-06 | v0.2.0 |
| CI-01 to CI-04 | v0.2.0 |
| TEST-01, TEST-02 | v0.2.0 |
| LLM-04, LLM-05 | v0.3.0 |
| VISION-01 | v0.3.0 |
| RESILIENCE-01 to RESILIENCE-03 | v0.3.0 |
| TRACKING-01, TRACKING-02 | v0.3.0 |
| CLI-01, CLI-02 | v0.4.0 |
| DEBUG-01, DEBUG-02 | v0.4.0 |
| DOCS-01 to DOCS-03 | v0.4.0 |
| MULTI-01 | v0.5.0 |
| PERSIST-01, PERSIST-02 | v0.5.0 |
| BUDGET-01, BUDGET-02 | v0.5.0 |

---

## Key Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-08 | Zero unsafe policy | Memory safety is non-negotiable |
| 2026-04-08 | rustls over OpenSSL | Avoid C dependencies and CVEs |
| 2026-04-09 | Trait-based LLM abstraction | Enable provider flexibility |

---

*Roadmap updated: 2026-04-09*
