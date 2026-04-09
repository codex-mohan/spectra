# Phase 4: spectra-py - Context

**Gathered:** 2026-04-08
**Status:** Infrastructure phase (discuss skipped)
**Mode:** Auto-generated context

## Implementation Decisions

### Agent's Discretion
All implementation choices are at the agent's discretion — infrastructure phase.

## Phase Boundary

Python SDK via PyO3/maturin bindings.

## Specifics

- Python types for Agent, Model, Tool
- Native addon (spectra-pyo3) compiles successfully with cargo
- Native addon loading via maturin develop

## Deferred

- Native addon build via maturin (requires Rust in PATH for maturin)

</code_context>

## Native Binding Status

The PyO3 addon compiles successfully with `cargo check` but maturin can't find Rust in PATH. Manual .pyd file can be created by:
1. Building the pyo3 crate as a .pyd file
2. Copying to the spectra package directory
