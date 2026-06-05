# @mohanscodex/spectra-agent

## 0.4.5

### Patch Changes

- Updated dependencies []:
  - @mohanscodex/spectra-ai@0.4.5

## 0.4.4

### Patch Changes

- Updated dependencies [[`bacb73d`](https://github.com/codex-mohan/spectra/commit/bacb73ddad81495d3ec5cc0c150bd1b67ab0d5ad)]:
  - @mohanscodex/spectra-ai@0.4.4

## 0.4.3

### Patch Changes

- Updated dependencies [[`e29e755`](https://github.com/codex-mohan/spectra/commit/e29e7556a9a11909fbf169498a3fb69f6606d1f0)]:
  - @mohanscodex/spectra-ai@0.4.3

## 0.4.2

### Patch Changes

- Updated dependencies [[`0929072`](https://github.com/codex-mohan/spectra/commit/0929072f56da4e92aada06d8e681b0113792a13b)]:
  - @mohanscodex/spectra-ai@0.4.2

## 0.4.1

### Patch Changes

- [`a714a31`](https://github.com/codex-mohan/spectra/commit/a714a318ba36806d561b788af083b04936a9139e) Thanks [@codex-mohan](https://github.com/codex-mohan)! - feat: add thinking effort API parameter for reasoning model variants

  - Add `thinkingEffort` field to `StreamOptions` for per-request reasoning control
  - Anthropic: maps effort to extended thinking with budget tokens (low=2048, medium=8192, high=16000, max=31999)
  - OpenAI Completions: maps effort to `reasoning_effort` param
  - OpenAI Responses: maps effort to `reasoning.effort` param
  - Provider-specific defaults: thinking enabled for zai/zhipuai, `enable_thinking` for alibaba-cn
  - TUI: variant cycle (ctrl+t) cycles through thinking effort levels per provider

- Updated dependencies [[`a714a31`](https://github.com/codex-mohan/spectra/commit/a714a318ba36806d561b788af083b04936a9139e)]:
  - @mohanscodex/spectra-ai@0.4.1

## 0.4.0

### Minor Changes

- [`c39eedd`](https://github.com/codex-mohan/spectra/commit/c39eedd31f87c184c0036517a368d46a151d8ef4) Thanks [@codex-mohan](https://github.com/codex-mohan)! - **npm scope migration:** `@singularity-ai/*` → `@mohanscodex/*` — all packages now publish under the personal scope to resolve naming conflicts

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

### Patch Changes

- Updated dependencies [[`c39eedd`](https://github.com/codex-mohan/spectra/commit/c39eedd31f87c184c0036517a368d46a151d8ef4)]:
  - @mohanscodex/spectra-ai@0.4.0

## 0.3.0

### Patch Changes

- [`4b42e25`](https://github.com/codex-mohan/spectra/commit/4b42e257e9b601650149f2d726a650322fe0f46a) Thanks [@codex-mohan](https://github.com/codex-mohan)! - SessionEngine — full lifecycle orchestration engine for session load → rate limit → agent loop → persist → stream. Works local (SQLite) and distributed (Redis). RedisRateLimiter with sorted-set sliding window for multi-pod deployments. CompositeRateLimiter for tenant+user+provider chaining. RedisSessionStore with TTL hot cache and cold store fallback. CircuitBreaker with CLOSED→OPEN→HALF_OPEN state machine. SseBridge for SSE streaming with WS-compatible interface. HealthProbe for K8s readiness. Naming: SimpleOrchestrator→AgentRegistry, SimpleRateLimiter→LocalRateLimiter, SimpleWorkerPool→SequentialWorkerPool. Updated README with deployment architecture. CI pre-commit verification in AGENTS.md.

- Updated dependencies [[`4b42e25`](https://github.com/codex-mohan/spectra/commit/4b42e257e9b601650149f2d726a650322fe0f46a)]:
  - @mohanscodex/spectra-ai@0.3.0

## 0.2.4

### Patch Changes

- [`973851c`](https://github.com/codex-mohan/spectra/commit/973851c4f9f2a9407a3dc2868030af5a62e1a3b6) Thanks [@codex-mohan](https://github.com/codex-mohan)! - feat: entry-based sessions with tree-structured provenance and audit trail

  - Add optional `provenance` field to `ToolResultMessage` for hook intervention tracking (blockedBy, blockReason, transformedBy, retryCount)
  - Refactor `Session` from flat `Message[]` to tree-structured `SessionEntry[]` with `id`/`parentId` linking
  - New entry types: `MessageEntry`, `ModelChangeEntry`, `AuditEntry`, `CustomEntry`
  - `SessionManager` additions: `appendEntry`, `appendMessage`, `appendAudit`, `appendCustom`, `appendModelChange`, `getBranch`, `getTree`, `getLeafId`, `buildContext`
  - `fork()` now branches from any entry point in the DAG, not just message indices
  - New stores: `FileSystemSessionStore` (JSON) and `SQLiteSessionStore` (better-sqlite3, optionalDependency)
  - Full structured persistence: thinking blocks, tool calls, stop reasons, usage, and audit events round-trip correctly
  - Comprehensive DAG/branching tests covering deep trees, multiple branches, context building, and provenance persistence

- Updated dependencies [[`973851c`](https://github.com/codex-mohan/spectra/commit/973851c4f9f2a9407a3dc2868030af5a62e1a3b6)]:
  - @mohanscodex/spectra-ai@0.2.4

## 0.2.3

### Patch Changes

- [`1ec3278`](https://github.com/codex-mohan/spectra/commit/1ec3278a8611daa3707ae49b1e7fcacb4e227c92) Thanks [@codex-mohan](https://github.com/codex-mohan)! - fix: resolve workspace:_ protocol before publishing to npm - prevents workspace:_ from leaking into tarballs and breaking consumers

- Updated dependencies [[`1ec3278`](https://github.com/codex-mohan/spectra/commit/1ec3278a8611daa3707ae49b1e7fcacb4e227c92)]:
  - @mohanscodex/spectra-ai@0.2.3

## 0.2.2

### Patch Changes

- [`dc0b8fd`](https://github.com/codex-mohan/spectra/commit/dc0b8fd5caa0f8c98cbd52a500723836c98ccfe6) Thanks [@codex-mohan](https://github.com/codex-mohan)! - fix: add build step to release workflow so compiled JS and type declarations are included in npm packages

- Updated dependencies [[`dc0b8fd`](https://github.com/codex-mohan/spectra/commit/dc0b8fd5caa0f8c98cbd52a500723836c98ccfe6)]:
  - @mohanscodex/spectra-ai@0.2.2

## 0.2.1

### Patch Changes

- [`9a28b2a`](https://github.com/codex-mohan/spectra/commit/9a28b2a166c1efec3033df5c79ef00b926aad83b) Thanks [@codex-mohan](https://github.com/codex-mohan)! - docs: add per-package READMEs with full API documentation and enhance VitePress docs site with app package coverage (session management, orchestration, worker pools, rate limiting)

- Updated dependencies [[`9a28b2a`](https://github.com/codex-mohan/spectra/commit/9a28b2a166c1efec3033df5c79ef00b926aad83b)]:
  - @mohanscodex/spectra-ai@0.2.1
