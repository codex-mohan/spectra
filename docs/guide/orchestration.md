# Orchestration & Concurrency

The `@singularity-ai/spectra-app` package provides tools for running agents at scale: worker pools for job processing, rate limiting for API protection, and an agent registry for delegating tasks across specialist agents.

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

Rate limits are tracked independently per user ID. The window slides — old requests expire naturally. For distributed deployments, swap in a Redis-backed `RateLimiter` implementation.

## Agent Registry

Register specialist agents and delegate tasks:

```typescript
import { AgentRegistry } from "@singularity-ai/spectra-app";

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