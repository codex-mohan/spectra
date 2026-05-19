# Improvement Roadmap

Planned enhancements for `packages/app` infrastructure components.

## AgentRegistry

Current: stores agent configs in a `Map`, creates new `Agent` instances per delegation call.

### Planned
- [ ] **Budget enforcement** — honor `Budget` fields (`maxTurns`, `maxTokens`, `timeoutMs`). Currently accepted but ignored.
- [ ] **Retry logic** — configurable retry with exponential backoff on delegation failures.
- [ ] **Circuit breaker** — stop delegating to an agent type after N consecutive failures.
- [ ] **Agent reuse** — pool/cache agent instances instead of creating new ones per call.
- [ ] **Error classification** — distinguish provider errors (retryable) from tool errors (user-facing) from config errors (immediate fail).
- [ ] **Timeout enforcement** — abort delegation after `budget.timeoutMs`.

## LocalRateLimiter

Current: in-memory sliding window counter per user ID. Lost on process restart.

### Planned
- [ ] **Persistence adapter** — pluggable backend interface so state survives restarts.
- [ ] **Redis implementation** — distributed rate limiting for multi-process deployments.
- [ ] **Burst allowance** — configurable burst threshold above steady rate.
- [ ] **Rate limit headers** — expose `X-RateLimit-*` header values for API responses.
- [ ] **Cost-based limiting** — rate limit by token usage instead of request count.

## SequentialWorkerPool

Current: processes jobs one at a time in FIFO order. No persistence.

### Planned
- [ ] **Concurrency support** — configurable concurrency level (N parallel workers).
- [ ] **Priority queue** — respect `WorkerJob.priority` ordering.
- [ ] **Retry + dead-letter** — configurable max retries, dead-letter queue for permanently failed jobs.
- [ ] **Job persistence** — survive process restarts via session store or separate job store.
- [ ] **Job status API** — query job state (queued, processing, completed, failed).
- [ ] **Rate-limited execution** — optional rate limiter integration per worker.

## Session Persistence

Current: `InMemorySessionStore`, `FileSystemSessionStore`, `SQLiteSessionStore`.

### Planned
- [ ] **PostgreSQL / MySQL stores** — for multi-server deployments.
- [ ] **Session TTL / expiry** — auto-cleanup of stale sessions.
- [ ] **Migration support** — versioned session format with automatic migration.
- [ ] **Partial updates** — update only changed fields instead of full session write.
- [ ] **Event sourcing** — append-only event log per session for full replay.

## Rust SDK Parity

Current: Rust SDK covers core agent primitives. No session management, orchestration, or worker pools.

### Planned
- [ ] **Session management** — session types, store trait, file-system and SQLite implementations.
- [ ] **Worker pool** — async job queue with configurable concurrency.
- [ ] **Rate limiter** — in-memory and Redis-backed.
- [ ] **Agent registry** — same API surface as TypeScript `AgentRegistry`.
- [ ] **Audit trail** — `provenance` field on tool result messages, audit entries in sessions.