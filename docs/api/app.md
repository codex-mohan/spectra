# App API

## SessionManager

```typescript
class SessionManager {
  constructor(store: SessionStore);

  create(config: SessionConfig, userId?: string): Promise<Session>;
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: SessionFilter): Promise<Session[]>;
  fork(sourceId: string, entryId?: string): Promise<Session>;

  appendEntry(session: Session, entry: NewSessionEntry): SessionEntry;
  appendMessage(session: Session, message: Message): MessageEntry;
  appendAudit(session: Session, eventType: string, details: Record<string, unknown>): AuditEntry;
  appendCustom(session: Session, customType: string, data: unknown): CustomEntry;
  appendModelChange(session: Session, model: Model): ModelChangeEntry;

  getBranch(session: Session, entryId?: string): SessionEntry[];
  getTree(session: Session): SessionTreeNode[];
  getLeafId(session: Session): string | null;
  buildContext(session: Session, entryId?: string): SessionContext;
}
```

### Session

```typescript
interface Session {
  id: string;
  model: Model;
  entries: SessionEntry[];
  config: SessionConfig;
  metadata: SessionMetadata;
}

type SessionEntry = MessageEntry | ModelChangeEntry | AuditEntry | CustomEntry;

interface SessionConfig extends AgentConfig {
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
}

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

interface SessionFilter {
  userId?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
  status?: "active" | "completed" | "error";
}
```

## SessionStore

```typescript
interface SessionStore {
  create(session: Session): Promise<Session>;
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: SessionFilter): Promise<Session[]>;
}
```

### InMemorySessionStore

```typescript
class InMemorySessionStore implements SessionStore {
  // In-memory Map-based implementation
}
```

### FileSystemSessionStore

```typescript
class FileSystemSessionStore implements SessionStore {
  constructor(sessionsDir: string);
  // JSON file per session. Survives restarts.
}
```

### SQLiteSessionStore

```typescript
class SQLiteSessionStore implements SessionStore {
  constructor(dbPath: string);
  close(): void;
  // SQLite via better-sqlite3 (optionalDependency). Indexed queries.
}
```

## SequentialWorkerPool

```typescript
class SequentialWorkerPool {
  constructor(sessionManager: SessionManager);

  enqueue(sessionId: string, input: string): Promise<string>;
  process(handler: (job: WorkerJob) => Promise<WorkerResult>): Promise<void>;
  stop(): Promise<void>;
}

interface WorkerJob {
  id: string;
  sessionId: string;
  input: string;
  createdAt: Date;
  priority: number;
}

interface WorkerResult {
  jobId: string;
  success: boolean;
  events?: any[];
  error?: string;
}
```

## createAgentRunner

```typescript
function createAgentRunner(
  sessionManager: SessionManager,
  session: Session
): (job: WorkerJob) => Promise<WorkerResult>;
```

Creates an `Agent` from session config, runs the input, persists messages as entries to the session, and returns the event list.

## LocalRateLimiter

```typescript
class LocalRateLimiter implements RateLimiter {
  constructor(requestsPerMinute?: number, windowMs?: number);

  checkLimit(userId: string): Promise<RateLimitResult>;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}
```

Default: 60 requests per minute, 60-second sliding window.

## AgentRegistry

```typescript
class AgentRegistry {
  registerAgent(agentType: string, config: AgentConfig): void;
  delegate(agentType: string, task: string, budget?: Budget): Promise<DelegationResult>;
  executeParallel(tasks: TaskConfig[]): Promise<DelegationResult[]>;
}

interface Budget {
  maxTurns?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface TaskConfig {
  agentType: string;
  task: string;
  budget?: Budget;
}

interface DelegationResult {
  agentType: string;
  success: boolean;
  result: string;
  usage?: Usage;
  error?: string;
}
```