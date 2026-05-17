# Contributing — Setup

How to set up your development environment for Spectra.

## Prerequisites

- **Bun** 1.0+ — [Installation](https://bun.sh/docs/installation)
- **Node.js** 18+ — (included with Bun)
- **Rust** 1.75+ — [rustup](https://rustup.rs/)
- **Git** — for version control

## Clone and Install

```bash
git clone https://github.com/codex-mohan/spectra.git
cd spectra

# Install TypeScript dependencies
bun install

# Verify Rust toolchain
cargo --version
```

## Running Tests

```bash
# TypeScript
bun run lint    # tsc --noEmit
bun run test    # vitest --run
bun run build   # tsc build

# Rust
cargo test --workspace
cargo clippy --workspace
```

## Running Examples

```bash
cd apps/examples
cp .env.example .env
# Edit .env with your API keys
bun run src/index.ts
```

## Running Docs Locally

```bash
cd docs
bun run docs:dev
```

Open `http://localhost:5173/spectra/` in your browser.

## Project Structure

```
spectra/
├── packages/          # TypeScript SDKs
│   ├── ai/            # @singularity-ai/spectra-ai
│   ├── agent/         # @singularity-ai/spectra-agent
│   └── app/           # @singularity-ai/spectra-app
├── crates/            # Rust SDKs
│   ├── spectra-rs/    # Core types, agent, traits
│   └── spectra-http/  # HTTP clients
├── docs/              # VitePress documentation
└── apps/examples/     # Example applications
```

## Next Steps

- [**Coding Standards**](/contribute/coding-standards) — Conventions and style
- [**Adding Providers**](/contribute/adding-providers) — How to add a new LLM provider
