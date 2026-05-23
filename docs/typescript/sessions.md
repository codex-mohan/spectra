# Session Management

The `@mohanscodex/spectra-app` package provides session management for persisting and restoring agent conversations across requests.

## Installation

```bash
bun add @mohanscodex/spectra-app
```

## Creating a Session

```typescript
import { SessionManager, InMemorySessionStore } from "@mohanscodex/spectra-app";

const store = new InMemorySessionStore();
const sessions = new SessionManager(store);

const session = await sessions.create(
  {
    model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
    systemPrompt: "You are a helpful assistant.",
  },
  "user-abc123", // optional user ID
);

console.log(session.id);              // uuid
console.log(session.metadata.turnCount);  // 0
console.log(session.metadata.tokenUsage); // { input: 0, output: 0, ... }
```

Each session tracks `turnCount`, `tokenUsage`, timestamps, and user identity.

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

Branch a session at any point — useful for A/B testing, rollback, or exploration:

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
```

## Pluggable Stores

`SessionStore` is an interface — swap in any backend:

| Store | Use Case |
|---|---|
| `InMemorySessionStore` | Development, testing, single-process |
| `FileSystemSessionStore` | Local persistence via JSON files |
| `SQLiteSessionStore` | Embedded database, survives restarts |
| `RedisSessionStore` | Production — distributed hot cache with TTL |

### Redis + Cold Store (Production)

```typescript
import { RedisSessionStore, SQLiteSessionStore } from "@mohanscodex/spectra-app";
import Redis from "ioredis";

const store = new RedisSessionStore(new Redis(), {
  ttlSeconds: 3600,
  coldStore: new SQLiteSessionStore("./sessions.db"),
});
const sessions = new SessionManager(store);
```

Session state lives in Redis — any pod in the cluster can pick up any session. No sticky sessions required.

### Custom Store

```typescript
import type { SessionStore, Session, SessionFilter } from "@mohanscodex/spectra-app";

class PostgresSessionStore implements SessionStore {
  async create(session: Session): Promise<Session> { /* INSERT */ return session; }
  async load(id: string): Promise<Session | null> { /* SELECT */ return null; }
  async save(session: Session): Promise<void> { /* UPSERT */ }
  async delete(id: string): Promise<void> { /* DELETE */ }
  async list(filter?: SessionFilter): Promise<Session[]> { /* SELECT WHERE */ return []; }
}
```

## Next Steps

- [**Orchestration**](/typescript/orchestration) — SessionEngine, rate limiting, worker pools
- [**Session Management Guide**](/guides/session-management) — Choosing a store, production setup
