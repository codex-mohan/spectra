---
"@mohanscodex/spectra-ai": minor
"@mohanscodex/spectra-agent": minor
"@mohanscodex/spectra-app": minor
---

**npm scope migration:** `@singularity-ai/*` → `@mohanscodex/*` — all packages now publish under the personal scope to resolve naming conflicts

**Provider & Model Registry:**
- New `generate-models` script: fetches 4039 models across 158 providers from OpenRouter and models.dev
- Custom provider support via `registerProvider()` in the TUI and SDK
- 17 new provider integrations (xAI, DeepSeek, Mistral, Cerebras, Google, Fireworks, Together, Perplexity, Cohere, Novita, Moonshot, Chutes, MiniMax, HuggingFace, NVIDIA, Z.AI)

**Agent System:**
- Mode-switching agent with subagent dispatch — task subagent tool, markdown subagent, and session hierarchy
- Turn-level footer with revert, rollback, and filesystem checkpointing
- Streaming stutter fix, focus bleed fix, thinking toggle in TUI

**TUI (`spectra-code`):**
- Full rewrite with `@opentui/react` (JSX components, yargs CLI)
- Provider connection flow, model lifecycle, no-model state, per-message model tracking
- Redesigned home layout with Spectra Void theme
- Fixed autocomplete positioning, Escape dismissal, session list refresh
- Fixed shell tool output, interrupt handling, and message persistence

**Distributed Infrastructure (`spectra-app`):**
- `SessionEngine` — full lifecycle orchestration with session load, rate limiting, agent execution, and persistence
- `RedisRateLimiter` + `RedisSessionStore` — distributed sliding window rate limiting and session storage
- `CompositeRateLimiter` — multi-dimensional (tenant + user + provider)
- `CircuitBreaker` — three-state machine (Closed/Open/HalfOpen)
- `SseBridge` — SSE-based connection bridge with heartbeat and graceful close
- `HealthProbe` — Kubernetes-ready health checks (liveness + readiness)

**Other:**
- MCP support for file and shell tools
- CLI refactored with proper subcommands and session actions
- Circuit breaker in Rust SDK (`spectra-rs`)
- GitHub Actions: docs deployment workflow, fixed release pipeline
- Full docs sync with current SDK API surface
