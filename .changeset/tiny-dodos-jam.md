---
"@singularity-ai/spectra-app": minor
"@singularity-ai/spectra-ai": patch
"@singularity-ai/spectra-agent": patch
---

SessionEngine — full lifecycle orchestration engine for session load → rate limit → agent loop → persist → stream. Works local (SQLite) and distributed (Redis). RedisRateLimiter with sorted-set sliding window for multi-pod deployments. CompositeRateLimiter for tenant+user+provider chaining. RedisSessionStore with TTL hot cache and cold store fallback. CircuitBreaker with CLOSED→OPEN→HALF_OPEN state machine. SseBridge for SSE streaming with WS-compatible interface. HealthProbe for K8s readiness. Naming: SimpleOrchestrator→AgentRegistry, SimpleRateLimiter→LocalRateLimiter, SimpleWorkerPool→SequentialWorkerPool. Updated README with deployment architecture. CI pre-commit verification in AGENTS.md.
