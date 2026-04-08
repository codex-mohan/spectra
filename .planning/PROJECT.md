# Spectra

## What This Is

Spectra is a minimal, ultra-fast, multi-language AI agent framework with a Rust core. Inspired by pi-mono's "anti-framework" philosophy: give developers sharp primitives, not a walled garden. All SDKs (Rust, TypeScript, Python) are thin bindings over the same Rust core with identical behavior across languages.

## Core Value

A construction kit, not a pre-built house — ship only primitives that enable developers to build anything beyond the core without fighting the framework.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] spectra-core: Rust agent loop with LLM client, tool engine, streaming, and tool approval
- [ ] spectra-rs: Rust SDK with ergonomic wrappers and builder patterns
- [ ] spectra-ts: TypeScript/JavaScript SDK via napi-rs bindings
- [ ] spectra-py: Python SDK via PyO3 bindings
- [ ] spectra-coder: Terminal coding agent CLI app

### Out of Scope

- Sub-agents — build as extension from primitives
- Plan mode — build as extension
- Permission popups — replaced by tool approval (CORE-09)
- Automatic retry policies — wrap agent.prompt in your own retry loop
- Built-in memory/vector stores — inject history yourself

## Context

Greenfield project. Full specification in USER_PROMPT.md. Monorepo with Turborepo + Rust workspace.

## Constraints

- **Tech Stack**: Rust core (tokio async), TypeScript (napi-rs), Python (PyO3)
- **Monorepo**: Turborepo orchestration, pnpm workspaces
- **Zero unsafe policy**: No unsafe in core logic (FFI boundaries only)
- **Performance**: opt-level 3, thin LTO, panic=abort in release
- **Dependencies**: No OpenSSL (rustls), minimal deps, cargo audit required

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rust core | Performance by default, correct and fast co-equal | — Pending |
| Single agent loop | Keep it simple — one function, no class hierarchy | — Pending |
| Turborepo + Rust | Language-agnostic task orchestration, cached builds | — Pending |
| Minimal API surface | KISS — getModel, Agent, agent.prompt only | — Pending |
| Tool concurrent dispatch | All tool calls in a round run in parallel | — Pending |
| Tool approval | Human-in-the-loop pause before execution | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-08 after adding tool approval feature*
