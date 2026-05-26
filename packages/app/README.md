# @singularity-ai/spectra-app

**Production runtime infrastructure for conversational AI — session management, rate limiting, orchestration, and streaming bridge.**

Builds on `@singularity-ai/spectra-ai` and `@singularity-ai/spectra-agent` to provide the runtime needed for serving agents from local dev (SQLite) to distributed clusters (Redis + K8s).

## Why Spectra?

Every agent framework I tried — **LangChain, LangGraph**, and others — followed the same pattern: endless layers of abstraction for things that are, at their core, just a simple loop. An agent takes input, calls a model, processes the response, dispatches tools, and repeats. That's it. A loop. Everything else — chains, graphs, runnables — is over-engineering dressed up as architecture. I lost months debugging framework bugs instead of building my product.

**Spectra takes the opposite approach.** No graphs. No chains. No runtime that owns your application. Just the primitives — a loop, a model call, a tool dispatch, a stream — that you assemble however you need. `@mohanscodex/spectra-app` provides production utilities you'd build anyway (rate limiting, circuit breakers, session stores) — completely optional, never forced.

## Features

- **SessionEngine** — Full lifecycle orchestration: session load → rate limit → concurrency cap → agent loop → persist → stream. One `run()` call. Graceful drain for K8s.
- **Session management** — CRUD + fork with tree-structured entries, audit trails, and provenance tracking.
- **Pluggable session stores** — `InMemorySessionStore`, `FileSystemSessionStore` (JSON), `SQLiteSessionStore` (SQLite), `RedisSessionStore` (hot cache + TTL + cold store fallback).
- **Rate limiting** — `LocalRateLimiter` (in-memory sliding window), `RedisRateLimiter` (distributed sorted-set), `CompositeRateLimiter` (tenant+user+provider chaining).
- **Circuit breaker** — CLOSED → OPEN → HALF_OPEN state machine. Prevents cascading failures.
- **SSE bridge** — Manage SSE client connections, heartbeat, reconnection. Interface designed for WebSocket adapter.
- **Health probe** — K8s-compatible health/readiness checks with `registerCheck()`.
- **Worker pool** — Enqueue agent jobs, process sequentially. Built-in `createAgentRunner()`.
- **Agent registry** — Register specialist agents and delegate tasks in parallel.

## Installation

```bash
bun add @singularity-ai/spectra-app
```

For Redis backends:

```bash
bun add @singularity-ai/spectra-app ioredis
```

Depends on `@singularity-ai/spectra-ai` and `@singularity-ai/spectra-agent` (automatically resolved as workspace/transitive dependencies).

## Quick Start

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

// Full lifecycle in one call
const result = await engine.run("user-123", "What is Rust?", undefined, {
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
  systemPrompt: "You are a helpful assistant.",
});
console.log(result.finalMessage);

// Streaming variant — yields events as they happen
const stream = await engine.runStreaming("user-456", "Explain React", sessionId);
for await (const event of stream) {
  if (event.type === "message_update") process.stdout.write(event.message.content[0]?.text ?? "");
}

await engine.stop(true); // graceful drain
```

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                  @singularity-ai/spectra-app                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  SessionEngine                                       │    │
│  │  (load → rate-limit → agent loop → persist → stream)│    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐     │    │
│  │  │SessionMgr│  │RateLimit  │  │ CircuitBreaker  │     │    │
│  │  │+ Store   │  │(in-memory │  │ (CLOSED→OPEN→   │     │    │
│  │  │(InMemory,│  │ Redis,    │  │  HALF_OPEN)     │     │    │
│  │  │ FS,SQLite│  │Composite) │  │                 │     │    │
│  │  │ Redis)   │  │           │  │                 │     │    │
│  │  └──────────┘  └──────────┘  └────────────────┘     │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐     │    │
│  │  │SseBridge │  │HealthProb│  │  AgentRegistry  │     │    │
│  │  │(SSE+WS   │  │(/healthz/│  │  (delegate +    │     │    │
│  │  │ interface)│  │readyz)   │  │   parallel)     │     │    │
│  │  └──────────┘  └──────────┘  └────────────────┘     │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
         │                │                  │
         ▼                ▼                  ▼
  ┌────────────┐  ┌──────────────┐  ┌────────────┐
  │@spectra-ai │  │@spectra-agent│  │@spectra-ai │
  │(provider)  │  │  (Agent)     │  │(provider)  │
  └────────────┘  └──────────────┘  └────────────┘
```

## API

### SessionEngine

```typescript
const engine = new SessionEngine({
  sessionManager: new SessionManager(new InMemorySessionStore()),
  rateLimiter?: RateLimiter,
  circuitBreaker?: CircuitBreaker,
  maxConcurrentSessions?: number,
  sessionTimeoutMs?: number,
  engineId?: string,
});

engine.start();
const result = await engine.run(userId, input, sessionId?, options?);
const stream = await engine.runStreaming(userId, input, sessionId?, options?);
await engine.stop(drain?);
const health = await engine.health();
engine.abortSession(sessionId);
```

### SessionManager

```typescript
const manager = new SessionManager(store);

const session = await manager.create(config, userId?);
const loaded = await manager.load(id);
await manager.save(session);
await manager.delete(id);
const all = await manager.list(filter?);
const fork = await manager.fork(sourceId, entryId?);

// Tree-structured entries with provenance
manager.appendMessage(session, message);
manager.appendAudit(session, eventType, details);
manager.appendCustom(session, customType, data);
manager.appendModelChange(session, model);
const branch = manager.getBranch(session, entryId?);
const tree = manager.getTree(session);
const ctx = manager.buildContext(session, entryId?);
```

### SessionStore Implementations

| Class | Storage | Persistence |
|-------|---------|-------------|
| `InMemorySessionStore` | Map | Lost on restart |
| `FileSystemSessionStore(dir)` | JSON files | Survives restart |
| `SQLiteSessionStore(dbPath)` | SQLite | Survives restart, indexed |
| `RedisSessionStore(redis, config)` | Redis + optional cold store | Distributed, TTL |

```typescript
// Redis hot cache with SQLite cold fallback
const store = new RedisSessionStore(redis, {
  ttlSeconds: 3600,
  coldStore: new SQLiteSessionStore("./sessions.db"),
});
```

### Rate Limiters

```typescript
// Local — single process
const local = new LocalRateLimiter(60, 60000); // 60 req/min

// Redis — distributed, multi-pod
const redis = new RedisRateLimiter(redis, {
  requestsPerWindow: 60,
  windowMs: 60000,
  keyPrefix: "rl",
  burstAllowance: 5,
});

// Composite — chains multiple limiters
const composite = new CompositeRateLimiter([
  { limiter: new RedisRateLimiter(redis, { keyPrefix: "tenant" }), key: "tenant-a" },
  { limiter: new LocalRateLimiter(10, 60000), key: "user" },
]);

const { allowed, remaining, resetAt } = await composite.checkLimit("user-123");
```

### CircuitBreaker

```typescript
const breaker = new DefaultCircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxRequests: 3,
});

const result = await breaker.call(async () => {
  return await fetch("https://api.example.com/data");
});
// On 5 consecutive failures, breaker opens — all calls fail fast
// After 30s, enters HALF_OPEN — allows 3 probe requests
// On success, resets to CLOSED
```

### SseBridge

```typescript
const bridge = new SseBridge({
  heartbeatIntervalMs: 15000,
  reconnectTimeoutMs: 5000,
});

const writer = bridge.addClient("client-1");
writer.write("data: hello\n\n");
writer.end();

bridge.send({ type: "agent_event", data: {...}, timestamp: Date.now() });

// For HTTP frameworks (Next.js, Express, Node http)
const response = createSseResponse(bridge, request);
// Returns ReadableStream with correct SSE headers

// Reconnection info for EventSource clients
const { timeout, maxAttempts } = bridge.getReconnectInfo();
```

### HealthProbe

```typescript
const probe = new HealthProbe();
probe.registerCheck("redis", async () => {
  await redis.ping();
  return { status: "ok" };
});
probe.registerCheck("db", async () => {
  // ... check postgres
  return { status: "ok" };
});

const health = await probe.health(engine.lifecycle, engine.activeSessionCount);
// { status: "healthy" | "degraded" | "unhealthy", checks: {...} }
```

### SequentialWorkerPool

```typescript
const pool = new SequentialWorkerPool(sessionManager);
const jobId = await pool.enqueue(sessionId, "input text");
await pool.process(handler);
await pool.stop();
```

### createAgentRunner

```typescript
const runner = createAgentRunner(sessionManager, session);
```

### AgentRegistry

```typescript
const orchestrator = new AgentRegistry();
orchestrator.registerAgent("researcher", agentConfig);

const result = await orchestrator.delegate("researcher", "task", budget?);
const all = await orchestrator.executeParallel([
  { agentType: "researcher", task: "Task 1" },
  { agentType: "coder", task: "Task 2" },
]);
```

## Credits

Spectra was deeply inspired by **[pi-mono](https://github.com/badlogic/pi-mono)** by **Mario Zechner** — a beautifully minimal AI stack that proved an agent framework doesn't need layers of abstraction to be powerful.

## License

MIT
