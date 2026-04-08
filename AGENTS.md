<!-- GSD:project-start source:PROJECT.md -->
## Project

**Spectra**

Spectra is a minimal, ultra-fast, multi-language AI agent framework with a Rust core. Inspired by pi-mono's "anti-framework" philosophy: give developers sharp primitives, not a walled garden. All SDKs (Rust, TypeScript, Python) are thin bindings over the same Rust core with identical behavior across languages.

**Core Value:** A construction kit, not a pre-built house — ship only primitives that enable developers to build anything beyond the core without fighting the framework.

### Constraints

- **Tech Stack**: Rust core (tokio async), TypeScript (napi-rs), Python (PyO3)
- **Monorepo**: Turborepo orchestration, pnpm workspaces
- **Zero unsafe policy**: No unsafe in core logic (FFI boundaries only)
- **Performance**: opt-level 3, thin LTO, panic=abort in release
- **Dependencies**: No OpenSSL (rustls), minimal deps, cargo audit required
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
| pnpm | Package manager | Fast, efficient workspace support |
| cargo-nextest | Test runner | Faster test execution, better output |
| cargo-audit | Security audit | Catches vulnerable dependencies |
## Installation
# Rust toolchain
# Build dependencies
# Python extension (from spectra-py/)
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
