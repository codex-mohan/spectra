# Project Research Summary

**Project:** Spectra
**Domain:** AI Agent Framework
**Researched:** 2026-04-08
**Confidence:** HIGH

## Executive Summary

Spectra is a minimal, ultra-fast AI agent framework with a Rust core. The architecture follows an "anti-framework" philosophy: ship only primitives that enable developers to build agentic applications without fighting the framework. All SDKs (Rust, TypeScript, Python) are thin bindings over the same Rust core.

Research confirms this approach is viable and differentiated. Competitors like LangChain and LlamaIndex are Python-first with heavy abstractions. Spectra differentiates by:
1. Rust core for performance
2. Minimal API surface (KISS principle)
3. Identical behavior across all language SDKs
4. No built-in opinions on memory, retries, or sub-agents

Key technical decisions from research:
- Tokio async runtime (industry standard)
- Trait-based LLM abstraction (easy to add providers)
- Concurrent tool dispatch (performance)
- AsyncIterable/AsyncIterator streaming (language-native)
- napi-rs + PyO3 for FFI (fastest bindings)

## Key Findings

### Recommended Stack

**Core technologies:**
- Rust 1.75+ with tokio 1.x for async runtime
- reqwest 0.12 with rustls for HTTP (no OpenSSL)
- thiserror 2.x + miette 7.x for typed errors with diagnostics
- dashmap 6.x for concurrent tool registry (lock-free reads)
- tracing 0.1 for structured logging

**SDK bindings:**
- napi-rs 3.x for TypeScript (.node native addon)
- PyO3 0.22+ with maturin for Python (.pyd/.so)
- Zod for TypeScript schema validation
- Pydantic v2 for Python schema validation

### Expected Features

**Must have (table stakes):**
- Agent loop with message history
- LLM client abstraction (Anthropic, OpenAI)
- Tool registry and concurrent execution
- Streaming responses via AsyncIterable
- Typed, structured errors with diagnostics

**Should have (competitive):**
- spectra-rs: Rust SDK with builder patterns
- spectra-ts: TypeScript SDK via napi-rs
- spectra-py: Python SDK via PyO3
- Extension API for user-defined hooks

**Defer (v2+):**
- WebSocket streaming
- Metrics/telemetry
- Distributed agent support
- More LLM providers beyond Anthropic/OpenAI

### Architecture Approach

Core is a single `run_loop` function that orchestrates:
1. Send messages to LLM via LLMClient trait
2. Yield streaming events to caller
3. Queue tool calls, execute concurrently
4. Append tool results to history, repeat

SDKs are thin wrappers around FFI calls to native extensions. The .node (TS) and .pyd/.so (Python) binaries are compiled from Rust crates (spectra-napi, spectra-pyo3).

**Major components:**
1. spectra-core — Agent loop, LLM client, tool engine, errors
2. spectra-napi/spectra-pyo3 — FFI bindings
3. spectra-rs/spectra-ts/spectra-py — Language SDKs
4. spectra-coder — CLI application on top of SDK

### Critical Pitfalls

1. **Blocking the async runtime** — Use tokio::spawn, tokio::fs, never std::thread
2. **Memory leaks in history** — Implement sliding window, document limits
3. **Tool schema mismatch** — Validate at dispatch boundary, test round-trips
4. **Streaming event loss** — Check send() results, handle cancellations
5. **FFI boundary performance** — Minimize serialization, zero-copy where possible
6. **Panic propagation** — Catch panics at tool boundary, never unwind across FFI

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: spectra-core
**Rationale:** Foundation must be solid. All SDKs depend on core.
**Delivers:** Agent loop, LLM client trait, tool registry, error types, streaming
**Addresses:** All critical pitfalls — this is where patterns are established
**Avoids:** Streaming loss, async blocking, panic propagation

### Phase 2: spectra-rs (Rust SDK)
**Rationale:** Rust SDK is simplest — direct crate dependency, no FFI
**Delivers:** Public API with builder patterns, extension trait
**Implements:** spectra-core re-export with ergonomic wrappers

### Phase 3: spectra-ts (TypeScript SDK)
**Rationale:** TypeScript ecosystem is large, napi-rs is well-documented
**Delivers:** @spectra/sdk npm package, AsyncIterable interface
**Uses:** napi-rs for .node compilation
**Phase to address:** FFI performance validation

### Phase 4: spectra-py (Python SDK)
**Rationale:** Python is critical for data/ML use cases
**Delivers:** spectra-sdk PyPI package, AsyncIterator interface
**Uses:** PyO3 + maturin for .pyd compilation
**Phase to address:** FFI performance validation

### Phase Ordering Rationale

- **Phase 1 first:** Everything depends on spectra-core
- **Phase 2 before 3/4:** Rust SDK is direct, helps validate core API
- **Phase 3 and 4 order:** Either works; TS ecosystem larger so done first
- **Parallel work possible:** After Phase 1, SDKs can be started independently

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3/4:** FFI performance tuning — benchmark against Rust baseline
- **Extension API:** How to design hooks that work across all languages

Phases with standard patterns (skip research-phase):
- **Phase 1:** Well-understood Rust async patterns
- **Phase 2:** Simple re-export + builder pattern

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Standard Rust ecosystem, verified libraries |
| Features | HIGH | Well-specified in idea doc, competitor analysis |
| Architecture | HIGH | Pattern-based, well-understood async Rust |
| Pitfalls | HIGH | Common async mistakes, well-documented |

**Overall confidence:** HIGH

### Gaps to Address

- **Extension API design:** Need to define hooks that work across TS/Python. Will need per-language design during Phase 2+.
- **Memory limits:** Need to set concrete defaults (history window size). Can be tuned based on user feedback.

## Sources

### Primary (HIGH confidence)
- tokio.rs — async runtime patterns
- napi-rs GitHub — TypeScript binding patterns
- PyO3 user guide — Python binding patterns
- thiserror/miette docs — error handling patterns

### Secondary (MEDIUM confidence)
- LangChain architecture — feature comparison
- LlamaIndex architecture — feature comparison

---
*Research completed: 2026-04-08*
*Ready for roadmap: yes*
