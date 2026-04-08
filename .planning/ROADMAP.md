# Roadmap: Spectra

**Created:** 2026-04-08
**Granularity:** Coarse
**Phases:** 4

## Phase Summary

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | spectra-core | Rust core with agent loop, LLM client, tool engine, error types | CORE-01 to CORE-08, BUILD-01 to BUILD-03 | 8 criteria |
| 2 | spectra-rs | Rust SDK with ergonomic wrappers | RUST-01 to RUST-04 | 4 criteria |
| 3 | spectra-ts | TypeScript SDK via napi-rs | TS-01 to TS-06, BUILD-04 | 7 criteria |
| 4 | spectra-py | Python SDK via PyO3 | PY-01 to PY-06 | 6 criteria |

---

## Phase 1: spectra-core

**Goal:** Rust core with agent loop, LLM client, tool engine, and error types

### Requirements
- CORE-01: Agent loop with message history management
- CORE-02: LLM client abstraction trait with streaming support
- CORE-03: Tool registry with concurrent tool dispatch
- CORE-04: Typed error system with miette diagnostics
- CORE-05: Event stream for real-time updates
- CORE-06: Message types (User, Assistant, ToolResult)
- CORE-07: System prompt handling
- CORE-08: Abort signal support for cancellation

### Build Requirements
- BUILD-01: Cargo workspace configuration
- BUILD-02: pnpm workspace with Turborepo
- BUILD-03: Turborepo pipeline (build, test, lint tasks)

### Success Criteria

1. User can create an Agent with a model and tools
2. Agent loop processes user messages and yields streaming events
3. LLM client trait supports multiple providers (Anthropic, OpenAI)
4. Tool calls execute concurrently when multiple are requested
5. All errors are typed with miette diagnostics (no unwrap in library)
6. Event stream emits: agent_start, turn_start, message_start, message_end, turn_end, agent_end, tool_execution_start, tool_execution_end
7. History is maintained across turns
8. AbortSignal cancels in-progress LLM calls and tool executions

### Phase 2 Dependency
All subsequent phases depend on spectra-core.

---

## Phase 2: spectra-rs

**Goal:** Ergonomic Rust SDK with builder patterns and extension support

### Requirements
- RUST-01: Re-export all spectra-core types
- RUST-02: Agent builder pattern
- RUST-03: Extension trait for hooks (before/after tool call)
- RUST-04: getModel() factory function

### Success Criteria

1. `spectra_rs::prelude::*` provides all commonly used types
2. AgentBuilder allows fluent configuration of agent
3. Extension trait supports beforeToolCall and afterToolCall hooks
4. getModel() creates Model instances for supported providers

---

## Phase 3: spectra-ts

**Goal:** TypeScript/JavaScript SDK via napi-rs bindings

### Requirements
- TS-01: TypeScript package with full type definitions
- TS-02: NAPI bindings via napi-rs (.node addon)
- TS-03: AsyncIterable stream interface
- TS-04: Zod schema validation for tools
- TS-05: SpectraError class hierarchy
- TS-06: Agent class with prompt() method
- BUILD-04: Native addon build scripts

### Success Criteria

1. `@spectra/sdk` npm package with TypeScript types
2. Native .node addon compiled from spectra-napi
3. `for await (const event of agent.prompt())` works
4. Tool schemas validated with Zod before dispatch
5. All error variants extend SpectraError
6. Agent.prompt() returns AsyncIterable<StreamEvent>
7. Turborepo builds .node addon in correct order

---

## Phase 4: spectra-py

**Goal:** Python SDK via PyO3/maturin bindings

### Requirements
- PY-01: Python package with type stubs
- PY-02: PyO3 bindings via maturin (.pyd/.so)
- PY-03: AsyncIterator stream interface
- PY-04: Pydantic v2 schema validation for tools
- PY-05: SpectraError class hierarchy
- PY-06: Agent class with prompt() method

### Success Criteria

1. `spectra-sdk` PyPI package
2. Native .pyd/.so compiled from spectra-pyo3
3. `async for event in agent.prompt()` works
4. Tool schemas validated with Pydantic v2 before dispatch
5. All error variants extend SpectraError
6. Agent.prompt() returns AsyncIterator

---

## Traceability

| Requirement | Phase |
|-------------|-------|
| CORE-01 | Phase 1 |
| CORE-02 | Phase 1 |
| CORE-03 | Phase 1 |
| CORE-04 | Phase 1 |
| CORE-05 | Phase 1 |
| CORE-06 | Phase 1 |
| CORE-07 | Phase 1 |
| CORE-08 | Phase 1 |
| BUILD-01 | Phase 1 |
| BUILD-02 | Phase 1 |
| BUILD-03 | Phase 1 |
| RUST-01 | Phase 2 |
| RUST-02 | Phase 2 |
| RUST-03 | Phase 2 |
| RUST-04 | Phase 2 |
| BUILD-04 | Phase 3 |
| TS-01 | Phase 3 |
| TS-02 | Phase 3 |
| TS-03 | Phase 3 |
| TS-04 | Phase 3 |
| TS-05 | Phase 3 |
| TS-06 | Phase 3 |
| PY-01 | Phase 4 |
| PY-02 | Phase 4 |
| PY-03 | Phase 4 |
| PY-04 | Phase 4 |
| PY-05 | Phase 4 |
| PY-06 | Phase 4 |

---

## Key Milestones

- **v0.1.0:** spectra-core (Phase 1 complete)
- **v0.2.0:** spectra-rs (Phase 2 complete)
- **v0.3.0:** spectra-ts (Phase 3 complete)
- **v0.4.0:** spectra-py (Phase 4 complete)

---
*Roadmap created: 2026-04-08*
