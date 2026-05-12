# Session Management

The `@singularity-ai/spectra-app` package provides session management for persisting and restoring agent conversations across requests — essential for production deployments.

## Installation

```bash
bun add @singularity-ai/spectra-app
```

## Creating a Session

```typescript
import { SessionManager, InMemorySessionStore } from "@singularity-ai/spectra-app";

const store = new InMemorySessionStore();
const sessions = new SessionManager(store);

const session = await sessions.create(
  {
    model: { id: "gpt-4o", name: "GPT-4o", provider: "openai-completions", api: "openai" },
    systemPrompt: "You are a helpful assistant.",
  },
  "user-abc123",  // optional user ID
);

console.log(session.id); // uuid
console.log(session.metadata.turnCount); // 0
console.log(session.metadata.tokenUsage); // { input: 0, output: 0, ... }
```

Each session tracks `turnCount`, `tokenUsage`, timestamps, and user identity in its metadata.

## Saving and Loading

```typescript
// Add messages and save progress
session.messages.push({ role: "user", content: "Hello!", timestamp: Date.now() });
session.metadata.turnCount += 1;
await sessions.save(session);

// Load later
const loaded = await sessions.load(session.id);
console.log(loaded?.messages.length); // 1
```

## Forking Sessions

Branch a session at any message index — useful for A/B testing, rollback, or exploration:

```typescript
const forked = await sessions.fork(session.id, 2);
// forked.messages is a copy of session.messages up to index 2
// forked.metadata.parentSessionId === session.id
```

## Listing Sessions

```typescript
const all = await sessions.list();
const userSessions = await sessions.list({ userId: "user-abc123" });

const activeSessions = await sessions.list({ status: "active" });
const completedSessions = await sessions.list({ status: "completed" });
```

## Pluggable Store

`SessionStore` is an interface — swap in any backend. Built-in implementations:

| Store | Use case |
|-------|----------|
| `InMemorySessionStore` | Development, testing, single-process |
| `FileSystemSessionStore` | Local persistence via JSON files |
| `SQLiteSessionStore` | Embedded database, survives restarts |
| `RedisSessionStore` | Production — distributed hot cache with TTL, optional cold store fallback |

```typescript
import { RedisSessionStore } from "@singularity-ai/spectra-app";
import Redis from "ioredis";

// Redis as hot cache, SQLite as cold storage
const store = new RedisSessionStore(new Redis(), {
  ttlSeconds: 3600,
  coldStore: new SQLiteSessionStore("./sessions.db"),
});
const sessions = new SessionManager(store);
```

For custom backends, implement the `SessionStore` interface:

```typescript
import type { SessionStore } from "@singularity-ai/spectra-app";

class PostgresSessionStore implements SessionStore {
  async create(session) { /* INSERT ... */ }
  async load(id) { /* SELECT ... */ }
  async save(session) { /* UPSERT ... */ }
  async delete(id) { /* DELETE ... */ }
  async list(filter?) { /* SELECT ... WHERE ... */ }
}
```

The `InMemorySessionStore` works for development and single-process deployments.
