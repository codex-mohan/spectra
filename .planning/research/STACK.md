# Stack Research

**Domain:** AI Agent Framework (Rust core with multi-language SDKs)
**Researched:** 2026-04-08
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Rust | 1.75+ | Core runtime | Zero-cost abstractions, memory safety, native performance |
| tokio | 1.x | Async runtime | Industry standard, best ecosystem for async Rust |
| reqwest | 0.12 | HTTP client | rustls support, streaming, async-first |
| serde | 1.x | Serialization | Zero-cost derive, universal ecosystem support |
| thiserror | 2.x | Error derive | Zero overhead, idiomatic Rust errors |
| miette | 7.x | Error display | Best-in-class human-readable terminal errors |
| tracing | 0.1 | Structured logging | Zero-cost when disabled, structured fields |
| dashmap | 6.x | Concurrent map | Lock-free reads, no mutex contention |

### Binding Technologies

| Technology | Purpose | Why Recommended |
|------------|---------|-----------------|
| napi-rs | TypeScript bindings | Fastest N-API Rust binding, first-class TypeScript support |
| PyO3 | Python bindings | Rust-native Python extensions, maturin build tool |
| maturin | Python build | Simplest PyO3 workflow, cross-platform builds |

### Schema Validation

| Library | Language | Why Recommended |
|---------|----------|-----------------|
| Zod | TypeScript | Standard, composable, tree-shakeable |
| Pydantic v2 | Python | Rust-backed (rusdata), fastest Python validation |

### Tooling

| Tool | Purpose | Notes |
|------|---------|-------|
| Turborepo | Task orchestration | Language-agnostic, cached builds |
| bun | Package manager | Fast, efficient workspace support |
| cargo-nextest | Test runner | Faster test execution, better output |
| cargo-audit | Security audit | Catches vulnerable dependencies |

## Installation

```bash
# Rust toolchain
rustup update
cargo install cargo-audit cargo-nextest

# Build dependencies
cargo build --release

# Python extension (from spectra-py/)
maturin develop
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| tokio | async-std | tokio has better ecosystem for network-heavy workloads |
| reqwest | surf | reqwest has better streaming support |
| PyO3 | cpython | PyO3 is Rust-native, safer memory model |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| OpenSSL | Security vulnerabilities, C dependency | rustls (pure Rust TLS) |
| std::thread in async | Blocks async runtime | tokio::spawn |
| thread::sleep | Blocks thread | tokio::time::sleep |
| unwrap/expect in library | Panics on invalid input | ? operator, proper error handling |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| tokio 1.x | tokio-util 0.7.x | Compatible, uses semver |
| napi-rs 3.x | Node 18+ | Native addon compatibility |
| PyO3 0.22+ | Python 3.11+ | Required for stabilized features |
| maturin 1.7+ | PyO3 0.22+ | Required for Python 3.11+ support |

## Sources

- tokio.rs official documentation
- napi-rs GitHub repository
- PyO3 user guide
- thiserror/miette crates documentation

---
*Stack research for: AI Agent Framework*
*Researched: 2026-04-08*
