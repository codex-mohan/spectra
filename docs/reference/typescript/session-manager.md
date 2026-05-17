# SessionManager Reference

Manages session lifecycle — create, load, save, delete, fork, and list sessions.

## Constructor

```typescript
new SessionManager(store: SessionStore)
```

## Methods

| Method | Signature | Description |
|---|---|---|
| `create` | `(config: SessionConfig, userId?: string) => Promise<Session>` | Create a new session |
| `load` | `(id: string) => Promise<Session \| null>` | Load a session by ID |
| `save` | `(session: Session) => Promise<void>` | Persist session changes |
| `delete` | `(id: string) => Promise<void>` | Delete a session |
| `list` | `(filter?: SessionFilter) => Promise<Session[]>` | List sessions with optional filter |
| `fork` | `(sourceId: string, entryId?: string) => Promise<Session>` | Branch a session at a point |

## Session

```typescript
interface Session {
  id: string;
  model: Model;
  entries: SessionEntry[];
  config: SessionConfig;
  metadata: SessionMetadata;
}
```

## SessionMetadata

```typescript
interface SessionMetadata {
  createdAt: Date;
  updatedAt: Date;
  turnCount: number;
  tokenUsage: Usage;
  isStreaming: boolean;
  error?: string;
  parentSessionId?: string;
  userId?: string;
  tenantId?: string;
}
```

## SessionEntry Types

| Type | Description |
|---|---|
| `MessageEntry` | A user or assistant message |
| `ModelChangeEntry` | Model switch during session |
| `AuditEntry` | Event audit log |
| `CustomEntry` | Custom data entry |

## Related

- [Session Management Guide](/guides/session-management) — Store selection
- [SessionEngine Reference](/reference/typescript/session-engine) — Orchestration
