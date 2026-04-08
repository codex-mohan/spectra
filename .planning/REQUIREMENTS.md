# Requirements: Spectra

**Defined:** 2026-04-08
**Core Value:** A construction kit, not a pre-built house — ship only primitives that enable developers to build anything beyond the core without fighting the framework.

## v1 Requirements

### Core (spectra-core)

- [ ] **CORE-01**: Agent loop with message history management
- [ ] **CORE-02**: LLM client abstraction trait with streaming support
- [ ] **CORE-03**: Tool registry with concurrent tool dispatch
- [ ] **CORE-04**: Typed error system with miette diagnostics
- [ ] **CORE-05**: Event stream for real-time updates
- [ ] **CORE-06**: Message types (User, Assistant, ToolResult)
- [ ] **CORE-07**: System prompt handling
- [ ] **CORE-08**: Abort signal support for cancellation

### Rust SDK (spectra-rs)

- [ ] **RUST-01**: Re-export all spectra-core types
- [ ] **RUST-02**: Agent builder pattern
- [ ] **RUST-03**: Extension trait for hooks (before/after tool call)
- [ ] **RUST-04**: getModel() factory function

### TypeScript SDK (spectra-ts)

- [ ] **TS-01**: TypeScript package with full type definitions
- [ ] **TS-02**: NAPI bindings via napi-rs (.node addon)
- [ ] **TS-03**: AsyncIterable stream interface
- [ ] **TS-04**: Zod schema validation for tools
- [ ] **TS-05**: SpectraError class hierarchy
- [ ] **TS-06**: Agent class with prompt() method

### Python SDK (spectra-py)

- [ ] **PY-01**: Python package with type stubs
- [ ] **PY-02**: PyO3 bindings via maturin (.pyd/.so)
- [ ] **PY-03**: AsyncIterator stream interface
- [ ] **PY-04**: Pydantic v2 schema validation for tools
- [ ] **PY-05**: SpectraError class hierarchy
- [ ] **PY-06**: Agent class with prompt() method

### Build System

- [ ] **BUILD-01**: Cargo workspace configuration
- [ ] **BUILD-02**: pnpm workspace with Turborepo
- [ ] **BUILD-03**: Turborepo pipeline (build, test, lint tasks)
- [ ] **BUILD-04**: Native addon build scripts

## v2 Requirements

### Extension API

- **EXT-01**: Extension trait for custom hooks
- **EXT-02**: Extension registration system

### Spectra Coder App

- **CODE-01**: CLI coding agent with read/write/edit/bash tools
- **CODE-02**: Interactive REPL mode
- **CODE-03**: Print mode (one-shot output)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Built-in sub-agents | Anti-feature — users build their own from primitives |
| Automatic retries | Anti-feature — opinionated, users implement their own |
| Built-in memory stores | Anti-feature — one-size-fits-none, user injects history |
| Plan mode | Anti-feature — opinionated, user builds if needed |
| Permission popups | Anti-feature — opinionated |
| WebSocket streaming | v2+ — SSE sufficient for most cases |
| Metrics/telemetry | v2+ — tracing subscriber opt-in |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| CORE-05 | Phase 1 | Pending |
| CORE-06 | Phase 1 | Pending |
| CORE-07 | Phase 1 | Pending |
| CORE-08 | Phase 1 | Pending |
| RUST-01 | Phase 2 | Pending |
| RUST-02 | Phase 2 | Pending |
| RUST-03 | Phase 2 | Pending |
| RUST-04 | Phase 2 | Pending |
| TS-01 | Phase 3 | Pending |
| TS-02 | Phase 3 | Pending |
| TS-03 | Phase 3 | Pending |
| TS-04 | Phase 3 | Pending |
| TS-05 | Phase 3 | Pending |
| TS-06 | Phase 3 | Pending |
| PY-01 | Phase 4 | Pending |
| PY-02 | Phase 4 | Pending |
| PY-03 | Phase 4 | Pending |
| PY-04 | Phase 4 | Pending |
| PY-05 | Phase 4 | Pending |
| PY-06 | Phase 4 | Pending |
| BUILD-01 | Phase 1 | Pending |
| BUILD-02 | Phase 1 | Pending |
| BUILD-03 | Phase 1 | Pending |
| BUILD-04 | Phase 3/4 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-08*
*Last updated: 2026-04-08 after initial definition*
