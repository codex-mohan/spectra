# @mohanscodex/spectra-ai

## 0.5.1

### Patch Changes

- [`8f79d92`](https://github.com/codex-mohan/spectra/commit/8f79d92fb2049cfc55c836e9e6f8a28230eb5f74) Thanks [@codex-mohan](https://github.com/codex-mohan)! - ## Spectra v0.5.1

  ### Parallel Sessions

  - Multi-session agent history with persistence and compaction
  - Per-session state isolation — messages, loading states, and streaming don't leak across sessions
  - Per-session streaming guard so new sessions aren't blocked by running ones
  - Session status bar showing background session activity
  - SwitchSession wired into handleSubmit for immediate message rendering

  ### Provider Integrations

  - Coding plan provider integrations with live model fetching
  - Configurable cache retention for Anthropic client
  - Prompt caching hints for Anthropic and OpenRouter

  ### Reliability & Edge Cases

  - Propagate abort signal to subagents and fix interrupted indicator ordering
  - Handle interrupt edge cases for DeepSeek and other strict providers
  - Preserve thinking-only messages on interrupt, only pop truly empty ones
  - Doom loop detector only triggers on 5+ continuous identical calls
  - Increase shell tool timeout to 30 min default, 60 min max

  ### TUI & UX

  - Tool display overlap fix, shell title dimness, and agent maxTurns optional
  - Clearer tool display labels
  - Toast feedback for auto-copy on selection and manual copy actions
  - Correct bundled skills count from 185+ to 60+

  ### Testing & CI

  - Fix ACP test to include 'general' agent definition
  - Use bun:sqlite with better-sqlite3 fallback for tests
  - Move better-sqlite3 to runtime dependencies
  - Fix flaky session store test with timing delay
  - CI: matrix build with native runners, build-binaries workflow with smoke test
  - Platform-native release binaries: Windows .msi, macOS .dmg, Linux .tar.gz

## 0.5.0

### Minor Changes

- [`88c3c56`](https://github.com/codex-mohan/spectra/commit/88c3c56) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Add prompt caching hints for Anthropic and OpenRouter to reduce token costs on repeated context

- [`d0fcd10`](https://github.com/codex-mohan/spectra/commit/d0fcd10) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Add models.dev pricing data with cost/tokens formatting for all providers

### Patch Changes

- CI pipeline fixes: matrix build with native runners, build-binaries workflow, smoke test, and lockfile resolution

## 0.4.9

### Patch Changes

- [`2e73e41`](https://github.com/codex-mohan/spectra/commit/2e73e41d4bebe734c387792d0225878bcbc54e9f) Thanks [@codex-mohan](https://github.com/codex-mohan)! - TUI improvements and bug fixes

  - Fix git branch path flash on Windows — use execFileSync with stdio ignore instead of bash redirect
  - Add update check dialog on startup — checks npm registry, 24h cache, shows version and install command
  - Add prompt badge mode — pastes >500 chars collapse into compact badge, enter to send, esc to edit
  - Fix shell tool console bleed on Windows — always route through PowerShell to avoid cmd.exe output leaks
  - Fix shell tool display — always show block view with "No output" indicator when empty
  - Fix edit tool block — add blank line after heading for visual separation
  - Move toast notifications to top-right corner
  - Update Rust feature matrix — Provenance feature added
  - Clean release workflow — remove automated body generation, delete per-package tags
  - Remove graphify extension

## 0.4.7

### Patch Changes

- [`3665fe5`](https://github.com/codex-mohan/spectra/commit/3665fe5cb9940d5f852f6ee7c674947cf274548b) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Fix security and reliability issues in TypeScript SDK

  - Implement `sanitizeSurrogates` to properly remove unpaired Unicode surrogates
  - Fix retry logic: remove orphaned partial messages from history before retry
  - Replace brittle string-based error detection with status code checks and regex
  - Add abort-aware sleep with jitter for retry backoff
  - Add `onRetry` hook for consumer visibility and control over retry decisions
  - Remove redundant Groq provider (now uses OpenAI-compatible wrapper)
  - Fix `EventStream.result()` hanging forever if stream ends without completion event
  - Add `res.ok` check to OpenRouter `fetchLiveModels`

## 0.4.6

## 0.4.5

## 0.4.4

### Patch Changes

- [`bacb73d`](https://github.com/codex-mohan/spectra/commit/bacb73ddad81495d3ec5cc0c150bd1b67ab0d5ad) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Inject synthetic error tool results in convertMessages when tool calls lack matching toolResult messages, preventing strict providers (DeepSeek, Anthropic) from rejecting requests with unmatched tool_call_ids.

## 0.4.3

### Patch Changes

- [`e29e755`](https://github.com/codex-mohan/spectra/commit/e29e7556a9a11909fbf169498a3fb69f6606d1f0) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Fix OpenRouter models being incorrectly categorized into native provider buckets (e.g. deepseek/deepseek-v3.2 showing under deepseek instead of openrouter)

## 0.4.2

### Patch Changes

- [`0929072`](https://github.com/codex-mohan/spectra/commit/0929072f56da4e92aada06d8e681b0113792a13b) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Fix thinking/reasoning blocks being stripped when sending follow-up API requests to providers that require reasoning_content echo-back (DeepSeek, Qwen, etc.)

## 0.4.1

### Patch Changes

- [`a714a31`](https://github.com/codex-mohan/spectra/commit/a714a318ba36806d561b788af083b04936a9139e) Thanks [@codex-mohan](https://github.com/codex-mohan)! - feat: add thinking effort API parameter for reasoning model variants

  - Add `thinkingEffort` field to `StreamOptions` for per-request reasoning control
  - Anthropic: maps effort to extended thinking with budget tokens (low=2048, medium=8192, high=16000, max=31999)
  - OpenAI Completions: maps effort to `reasoning_effort` param
  - OpenAI Responses: maps effort to `reasoning.effort` param
  - Provider-specific defaults: thinking enabled for zai/zhipuai, `enable_thinking` for alibaba-cn
  - TUI: variant cycle (ctrl+t) cycles through thinking effort levels per provider

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

## 0.3.0

### Patch Changes

- [`4b42e25`](https://github.com/codex-mohan/spectra/commit/4b42e257e9b601650149f2d726a650322fe0f46a) Thanks [@codex-mohan](https://github.com/codex-mohan)! - SessionEngine — full lifecycle orchestration engine for session load → rate limit → agent loop → persist → stream. Works local (SQLite) and distributed (Redis). RedisRateLimiter with sorted-set sliding window for multi-pod deployments. CompositeRateLimiter for tenant+user+provider chaining. RedisSessionStore with TTL hot cache and cold store fallback. CircuitBreaker with CLOSED→OPEN→HALF_OPEN state machine. SseBridge for SSE streaming with WS-compatible interface. HealthProbe for K8s readiness. Naming: SimpleOrchestrator→AgentRegistry, SimpleRateLimiter→LocalRateLimiter, SimpleWorkerPool→SequentialWorkerPool. Updated README with deployment architecture. CI pre-commit verification in AGENTS.md.

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

## 0.2.3

### Patch Changes

- [`1ec3278`](https://github.com/codex-mohan/spectra/commit/1ec3278a8611daa3707ae49b1e7fcacb4e227c92) Thanks [@codex-mohan](https://github.com/codex-mohan)! - fix: resolve workspace:_ protocol before publishing to npm - prevents workspace:_ from leaking into tarballs and breaking consumers

## 0.2.2

### Patch Changes

- [`dc0b8fd`](https://github.com/codex-mohan/spectra/commit/dc0b8fd5caa0f8c98cbd52a500723836c98ccfe6) Thanks [@codex-mohan](https://github.com/codex-mohan)! - fix: add build step to release workflow so compiled JS and type declarations are included in npm packages

## 0.2.1

### Patch Changes

- [`9a28b2a`](https://github.com/codex-mohan/spectra/commit/9a28b2a166c1efec3033df5c79ef00b926aad83b) Thanks [@codex-mohan](https://github.com/codex-mohan)! - docs: add per-package READMEs with full API documentation and enhance VitePress docs site with app package coverage (session management, orchestration, worker pools, rate limiting)
