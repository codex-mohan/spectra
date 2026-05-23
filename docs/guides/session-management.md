# Session Management Guide

How to choose a session store and configure sessions for production.

## Choosing a Store

| Store | When to Use | Pros | Cons |
|---|---|---|---|
| `InMemorySessionStore` | Development, testing, single-process | Zero setup, fast | Lost on restart, not shareable |
| `FileSystemSessionStore` | Local apps, CLI tools | Persists across restarts | No concurrent access, slow for large sessions |
| `SQLiteSessionStore` | Single-server production | Indexed queries, ACID, portable | Single writer, not distributed |
| `RedisSessionStore` | Multi-server production | Distributed, fast, TTL | Requires Redis infrastructure |

## Development Setup

```typescript
import { SessionManager, InMemorySessionStore } from "@mohanscodex/spectra-app";

const sessions = new SessionManager(new InMemorySessionStore());
const session = await sessions.create({
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
  systemPrompt: "You are helpful.",
});
```

## Production Setup (Redis + SQLite)

```typescript
import { SessionManager, RedisSessionStore, SQLiteSessionStore } from "@mohanscodex/spectra-app";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);
const coldStore = new SQLiteSessionStore("./sessions.db");

const store = new RedisSessionStore(redis, {
  ttlSeconds: 3600,    // Sessions expire after 1 hour in Redis
  coldStore,           // Fall back to SQLite on cache miss
});

const sessions = new SessionManager(store);
```

This gives you:
- **Fast access** — Redis for hot sessions
- **Persistence** — SQLite as cold storage
- **TTL** — Automatic cleanup of stale sessions
- **Distribution** — Any server can access any session

## Session Forking

Create branches for A/B testing or exploration:

```typescript
// Fork at message index 3
const forked = await sessions.fork(originalSession.id, 3);

// The forked session has:
// - Same messages up to index 3
// - Different parentSessionId
// - Independent future messages
```

## Token Usage Tracking

Sessions automatically track token usage:

```typescript
const session = await sessions.load(sessionId);
console.log(session.metadata.tokenUsage);
// { input: 1234, output: 567, total: 1801 }
```

## Next Steps

- [**SessionManager Reference**](/reference/typescript/session-manager) — Full API
- [**Orchestration**](/typescript/orchestration) — SessionEngine for production
