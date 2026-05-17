# Orchestration

The `@singularity-ai/spectra-app` package provides tools for running agents at any scale.

## SessionEngine

The central orchestration unit — wraps session load, rate limiting, agent execution, and persistence into a single `run()` call:

```typescript
import {
  SessionEngine,
  SessionManager,
  InMemorySessionStore,
  CompositeRateLimiter,
  LocalRateLimiter,
} from "@singularity-ai/spectra-app";

const engine = new SessionEngine({
  sessionManager: new SessionManager(new InMemorySessionStore()),
  rateLimiter: new CompositeRateLimiter([
    { limiter: new LocalRateLimiter(60, 60000), key: "tenant" },
    { limiter: new LocalRateLimiter(15, 60000), key: "user" },
  ]),
  maxConcurrentSessions: 100,
});

engine.start();

// Blocking — returns when agent loop completes
const result = await engine.run("user-123", "What is Rust?", undefined, {
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
});
console.log(result.finalMessage);
console.log(result.tokenUsage);

// Streaming — yields events as they happen
const stream = await engine.runStreaming("user-456", "Explain Kubernetes", existingSessionId, {
  model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
});
for await (const event of stream) {
  console.log(event.type, event);
}

await engine.stop(true); // graceful drain
```

### Production Scale (Redis)

```typescript
import { RedisSessionStore, RedisRateLimiter } from "@singularity-ai/spectra-app";
import Redis from "ioredis";

const redis = new Redis();

const engine = new SessionEngine({
  sessionManager: new SessionManager(
    new RedisSessionStore(redis, { ttlSeconds: 3600 })
  ),
  rateLimiter: new CompositeRateLimiter([
    { limiter: new RedisRateLimiter(redis, { keyPrefix: "rl:tenant", requestsPerWindow: 1000 }), key: "tenant" },
    { limiter: new RedisRateLimiter(redis, { keyPrefix: "rl:user", requestsPerWindow: 30 }), key: "user" },
  ]),
  maxConcurrentSessions: 5000,
});
```

## Worker Pool

Queue and process agent jobs sequentially:

```typescript
import {
  SessionManager,
  InMemorySessionStore,
  SequentialWorkerPool,
  createAgentRunner,
} from "@singularity-ai/spectra-app";

const sessions = new SessionManager(new InMemorySessionStore());
const session = await sessions.create({
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
  systemPrompt: "You are a helpful assistant.",
});

const runner = createAgentRunner(sessions, session);
const pool = new SequentialWorkerPool(sessions);

await pool.enqueue(session.id, "Research quantum computing");
await pool.enqueue(session.id, "Summarize findings");
await pool.process(runner);
await pool.stop();
```

## Rate Limiting

Sliding-window rate limiter — per-user, configurable:

```typescript
import { LocalRateLimiter } from "@singularity-ai/spectra-app";

const limiter = new LocalRateLimiter(60, 60000); // 60 requests per minute

async function handleRequest(userId: string) {
  const { allowed, remaining, resetAt } = await limiter.checkLimit(userId);

  if (!allowed) {
    return { error: "Rate limit exceeded", retryAt: resetAt };
  }

  return { allowed, remaining };
}
```

Rate limits are tracked independently per user ID. For distributed deployments, use `RedisRateLimiter`.

## Agent Registry

Register specialist agents and delegate tasks:

```typescript
import { AgentRegistry } from "@singularity-ai/spectra-app";

const orchestrator = new AgentRegistry();

orchestrator.registerAgent("researcher", {
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
  systemPrompt: "You are a research specialist.",
});

orchestrator.registerAgent("coder", {
  model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are a coding specialist.",
});

// Single delegation
const result = await orchestrator.delegate("researcher", "Explain quantum entanglement");

// Parallel execution
const results = await orchestrator.executeParallel([
  { agentType: "researcher", task: "Research quantum computing" },
  { agentType: "coder", task: "Implement a binary tree in Rust" },
]);
```

## Circuit Breaker

Protect against cascading failures:

```typescript
import { DefaultCircuitBreaker } from "@singularity-ai/spectra-app";

const breaker = new DefaultCircuitBreaker({
  failureThreshold: 5,     // Open after 5 consecutive failures
  resetTimeoutMs: 30000,   // Try half-open after 30s
  halfOpenMaxRequests: 3,  // Allow 3 probe requests
});

// States: CLOSED (passes through) → OPEN (fails fast) → HALF_OPEN (probes) → CLOSED (on success)
```

## Next Steps

- [**Multi-Agent Patterns Guide**](/guides/multi-agent-patterns) — Delegation strategies
- [**Deployment Guide**](/guides/deployment) — Production configuration
- [**Session Management**](/typescript/sessions) — Session stores and forking
