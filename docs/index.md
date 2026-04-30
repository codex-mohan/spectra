---
layout: home

hero:
  name: Spectra
  text: Minimal, ultra-fast AI agent framework
  tagline: A construction kit, not a pre-built house. Ship only primitives.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/codex-mohan/spectra

features:
  - title: Streaming-First
    details: All LLM providers stream SSE by default. Event-driven architecture with real-time updates.
  - title: Multi-Language
    details: Rust and TypeScript SDKs with the same API surface and behavior.
  - title: Provider Abstraction
    details: Built-in Anthropic and OpenAI support with a simple provider registry.
  - title: Tool System
    details: Define tools with Zod schemas (TypeScript) or trait implementations (Rust).
  - title: Agent Loop
    details: Multi-turn conversations with automatic tool dispatch, delta accumulation, and event streaming.
  - title: Extension Hooks
    details: Before/after tool call hooks, context transformation, and composable middleware.
---
