# @singularity-ai/spectra-app

**Production infrastructure for conversational AI: session management, concurrency, rate limiting, and multi-agent orchestration.**

Builds on `@singularity-ai/spectra-ai` and `@singularity-ai/spectra-agent` to provide the runtime infrastructure needed for serving agents in production — session persistence, job queues, rate limits, and delegation across agent types.

## Features

- **Session management** — Create, load, save, delete, fork, and list sessions. Tracks turn count, token usage, timestamps, and user identity per session.
- **Pluggable session store** — `InMemorySessionStore` included. Swap in Redis, SQL, or any database via the `SessionStore` interface.
- **Worker pool** — Enqueue agent jobs, process with a handler, stop gracefully. Built-in `createAgentRunner()` ties agent execution to session persistence.
- **Rate limiting** — Sliding-window rate limiter per user. Configurable requests-per-minute and window duration.
- **Orchestration** — Register specialist agents and delegate tasks. Execute tasks in parallel across agent types.
- **Session forking** — Branch a session at any message index for A/B testing, rollback, or experimentation.

## Installation

```bash
bun add @singularity-ai/spectra-app
```

Depends on `@singularity-ai/spectra-ai` and `@singularity-ai/spectra-agent` (automatically resolved as workspace dependencies).

## Quick Start

```typescript
import {
  SessionManager,
  InMemorySessionStore,
  SimpleRateLimiter,
  SimpleWorkerPool,
  createAgentRunner,
  SimpleOrchestrator,
} from "@singularity-ai/spectra-app";

// Session management
const store = new InMemorySessionStore();
const sessions = new SessionManager(store);

const session = await sessions.create({
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
  systemPrompt: "You are a helpful assistant.",
}, "user-123");

session.messages.push({ role: "user", content: "Hello!", timestamp: Date.now() });
await sessions.save(session);

const loaded = await sessions.load(session.id);

// Fork a session for experimentation
const fork = await sessions.fork(session.id, 0);

// Rate limiting
const limiter = new SimpleRateLimiter(60, 60000); // 60 req/min
const { allowed, remaining } = await limiter.checkLimit("user-123");

// Worker pool with agent runner
const pool = new SimpleWorkerPool(sessions);
const runner = createAgentRunner(sessions, session);
pool.process(runner);

// Orchestration
const orchestrator = new SimpleOrchestrator();
orchestrator.registerAgent("researcher", {
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
  systemPrompt: "You are a research specialist.",
});

const results = await orchestrator.executeParallel([
  { agentType: "researcher", task: "Research quantum computing" },
  { agentType: "researcher", task: "Research machine learning" },
]);
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│              @singularity-ai/spectra-app          │
│                                                   │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │SessionManager│  │ WorkerPool  │  │Orchestrator│ │
│  │  (CRUD +     │  │ (enqueue +  │  │(delegate + │ │
│  │   fork)      │  │  process)   │  │ parallel) │ │
│  └──────┬───────┘  └──────┬──────┘  └─────┬────┘ │
│         │                 │               │       │
│  ┌──────┴───────┐  ┌──────┴──────┐        │       │
│  │ SessionStore │  │Agent Runner │        │       │
│  │ (InMemory,   │  │(wraps Agent │        │       │
│  │  pluggable)  │  │ + persists) │        │       │
│  └──────────────┘  └─────────────┘        │       │
│                                                   │
│  ┌──────────────────┐                            │
│  │  RateLimiter     │                            │
│  │  (sliding window)│                            │
│  └──────────────────┘                            │
└─────────────────────────────────────────────────┘
         │                    │              │
         ▼                    ▼              ▼
  ┌────────────┐   ┌──────────────┐  ┌────────────┐
  │@spectra-ai │   │@spectra-agent│  │@spectra-ai │
  │ (provider) │   │   (Agent)    │  │ (provider) │
  └────────────┘   └──────────────┘  └────────────┘
```

## API

### SessionManager

```typescript
const manager = new SessionManager(store);

// CRUD
const session = await manager.create(config, userId?);
const loaded = await manager.load(id);
await manager.save(session);
await manager.delete(id);
const all = await manager.list(filter?);

// Fork
const fork = await manager.fork(sourceId, branchFromIndex?);
```

`Session` carries `id`, `model`, `messages`, `config`, and `metadata` (timestamps, turnCount, tokenUsage, isStreaming, userId, parentSessionId).

### SessionStore Interface

Implement this to plug in any backend:

```typescript
interface SessionStore {
  create(session: Session): Promise<Session>;
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: SessionFilter): Promise<Session[]>;
}
```

### SimpleWorkerPool

```typescript
const pool = new SimpleWorkerPool(sessionManager);

const jobId = await pool.enqueue(sessionId, "input text");
await pool.process(handler);       // processes queue sequentially
await pool.stop();                 // waits for current job, then stops
```

### createAgentRunner

Factory that returns a job handler bound to a session:

```typescript
const runner = createAgentRunner(sessionManager, session);
// runner: (job: WorkerJob) => Promise<WorkerResult>
// Runs the Agent, persists messages back to session, returns events
```

### SimpleRateLimiter

```typescript
const limiter = new SimpleRateLimiter(requestsPerMinute = 60, windowMs = 60000);
const result = await limiter.checkLimit(userId);
// result: { allowed: boolean, remaining: number, resetAt: Date }
```

Uses a sliding window counter per user. Independent across users.

### SimpleOrchestrator

```typescript
const orchestrator = new SimpleOrchestrator();
orchestrator.registerAgent("researcher", agentConfig);

const result = await orchestrator.delegate("researcher", "task", budget?);
// result: { agentType, success, result, error? }

const all = await orchestrator.executeParallel([
  { agentType: "researcher", task: "Task 1" },
  { agentType: "coder", task: "Task 2" },
]);
```

## Key Types

```typescript
interface SessionConfig extends AgentConfig {
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
}

interface Budget {
  maxTurns?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface DelegationResult {
  agentType: string;
  success: boolean;
  result: string;
  error?: string;
}
```

## License

MIT
