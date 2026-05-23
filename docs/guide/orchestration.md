# Orchestration & Concurrency

The `@mohanscodex/spectra-app` package provides tools for running agents at any scale: the `SessionEngine` for full lifecycle orchestration, worker pools for job processing, rate limiting for API protection, and an agent registry for delegating tasks across specialist agents.

## SessionEngine

The central orchestration unit — wraps session load, rate limiting, agent execution, and persistence into a single `run()` call. Works identically from local dev to distributed clusters:

```typescript
import {
  SessionEngine,
  SessionManager,
  InMemorySessionStore,
  CompositeRateLimiter,
  LocalRateLimiter,
} from "@mohanscodex/spectra-app";

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
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
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

// Graceful drain
await engine.stop(true);
```

At scale, swap in Redis backends:

```typescript
import { RedisSessionStore, RedisRateLimiter } from "@mohanscodex/spectra-app";
import Redis from "ioredis";

const redis = new Redis();

const engine = new SessionEngine({
  sessionManager: new SessionManager(
    new RedisSessionStore(redis, { ttlSeconds: 3600, coldStore: pgStore })
  ),
  rateLimiter: new CompositeRateLimiter([
    { limiter: new RedisRateLimiter(redis, { keyPrefix: "rl:tenant", requestsPerWindow: 1000 }), key: "tenant" },
    { limiter: new RedisRateLimiter(redis, { keyPrefix: "rl:user", requestsPerWindow: 30 }), key: "user" },
    { limiter: new RedisRateLimiter(redis, { keyPrefix: "rl:provider", requestsPerWindow: 500 }), key: "provider" },
  ]),
  maxConcurrentSessions: 5000,
});
```

Session state lives in Redis — any pod in the cluster can pick up any session. No sticky sessions required.

## Worker Pool

Queue and process agent jobs sequentially:

```typescript
import {
  SessionManager,
  InMemorySessionStore,
  SequentialWorkerPool,
  createAgentRunner,
} from "@mohanscodex/spectra-app";

const sessions = new SessionManager(new InMemorySessionStore());
const session = await sessions.create({
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
  systemPrompt: "You are a helpful assistant.",
});

// Create a runner bound to this session
const runner = createAgentRunner(sessions, session);

const pool = new SequentialWorkerPool(sessions);

// Enqueue jobs
await pool.enqueue(session.id, "Research quantum computing");
await pool.enqueue(session.id, "Summarize findings");

// Process all jobs
await pool.process(runner);

// Graceful shutdown
await pool.stop();
```

`createAgentRunner` returns a handler that runs the `Agent`, persists all messages as entries to the session, and returns the full event list.

## Rate Limiting

Sliding-window rate limiter — per-user, configurable:

```typescript
import { LocalRateLimiter } from "@mohanscodex/spectra-app";

const limiter = new LocalRateLimiter(60, 60000); // 60 requests per minute

async function handleRequest(userId: string) {
  const { allowed, remaining, resetAt } = await limiter.checkLimit(userId);

  if (!allowed) {
    return { error: "Rate limit exceeded", retryAt: resetAt };
  }

  return { allowed, remaining };
}
```

Rate limits are tracked independently per user ID. The window slides — old requests expire naturally. For distributed deployments, swap in a Redis-backed `RateLimiter` implementation.

## Agent Registry

Register specialist agents and delegate tasks:

```typescript
import { AgentRegistry } from "@mohanscodex/spectra-app";

const orchestrator = new AgentRegistry();

orchestrator.registerAgent("researcher", {
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
  systemPrompt: "You are a research specialist. Provide detailed, cited answers.",
});

orchestrator.registerAgent("coder", {
  model: { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are a coding specialist. Write clean, well-documented code.",
});
```

### Single Delegation

```typescript
const result = await orchestrator.delegate("researcher", "Explain quantum entanglement");
console.log(result.success ? result.result : result.error);
```

### Parallel Execution

```typescript
const results = await orchestrator.executeParallel([
  { agentType: "researcher", task: "Research quantum computing" },
  { agentType: "coder", task: "Implement a binary tree in Rust" },
]);

for (const r of results) {
  console.log(`[${r.success ? "OK" : "FAIL"}] ${r.agentType}: ${r.result}`);
}
```

Each task runs independently. Results include `success`, `result`, and optional `error` and `usage` fields.