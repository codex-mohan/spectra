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

## SessionEngine

```typescript
class SessionEngine {
  constructor(config: SessionEngineConfig);

  readonly lifecycle: EngineLifecycle;          // "starting" | "running" | "draining" | "stopped"
  readonly activeSessionCount: number;

  start(): void;
  stop(drain?: boolean): Promise<void>;
  attachBridge(bridge: ConnectionBridge): void;
  abortSession(sessionId: string): void;
  health(): Promise<HealthStatus>;

  run(
    userId: string,
    input: string,
    sessionId?: string,
    options?: {
      tenantId?: string;
      streamOptions?: StreamOptions;
      tools?: AgentTool[];
      model?: Model;
    }
  ): Promise<SessionEngineResult>;

  runStreaming(
    userId: string,
    input: string,
    sessionId?: string,
    options?: { ... }
  ): Promise<AsyncGenerator<AgentEvent>>;
}

interface SessionEngineConfig {
  sessionManager: SessionManager;
  rateLimiter?: RateLimiter;
  tenantResolver?: TenantResolver;
  circuitBreaker?: CircuitBreaker;
  engineId?: string;
  defaultStreamOptions?: StreamOptions;
  maxConcurrentSessions?: number;
  sessionTimeoutMs?: number;
}

interface SessionEngineResult {
  sessionId: string;
  events: AgentEvent[];
  finalMessage: string;
  tokenUsage: Usage;
}
```

Orchestrates the full request lifecycle: session load → rate limit check → concurrency cap → agent loop → persist → stream results.

## RedisRateLimiter

```typescript
class RedisRateLimiter implements RateLimiter {
  constructor(redis: RedisClient, config?: Partial<RedisRateLimiterConfig>);

  checkLimit(userId: string): Promise<RateLimitResult>;
}

interface RedisRateLimiterConfig {
  requestsPerWindow: number;  // default: 60
  windowMs: number;           // default: 60000
  keyPrefix: string;          // default: "rl"
  burstAllowance?: number;    // default: 0
}
```

Distributed sliding window rate limiter using Redis sorted sets. Survives process restarts, shared across pods.

## CompositeRateLimiter

```typescript
class CompositeRateLimiter implements RateLimiter {
  constructor(limits: CompositeLimit[]);

  addLimit(limiter: RateLimiter, key: string): void;
  checkLimit(userId: string): Promise<RateLimitResult>;
}

interface CompositeLimit {
  limiter: RateLimiter;
  key: string;
}
```

Chains multiple rate limiters with composite keys (e.g., `tenant:userId`, `provider:userId`). Blocks if any sub-limiter denies. All must pass.

## RedisSessionStore

```typescript
class RedisSessionStore implements SessionStore {
  constructor(redis: RedisClient, config?: Partial<RedisSessionStoreConfig>);

  create(session: Session): Promise<Session>;
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: SessionFilter): Promise<Session[]>;
}

interface RedisSessionStoreConfig {
  ttlSeconds: number;     // default: 3600
  keyPrefix: string;      // default: "session"
  coldStore?: SessionStore;  // optional fallback (Postgres, SQLite)
}
```

Redis as hot cache with TTL expiry. Falls back to cold store on cache miss. Enables session portability across pods.

## CircuitBreaker

```typescript
class DefaultCircuitBreaker implements CircuitBreaker {
  constructor(config?: Partial<CircuitBreakerConfig>);

  readonly state: CircuitBreakerState;     // "CLOSED" | "OPEN" | "HALF_OPEN"
  readonly failureCount: number;

  call<T>(fn: () => Promise<T>): Promise<T>;
  recordSuccess(): void;
  recordFailure(): void;
}

interface CircuitBreakerConfig {
  failureThreshold: number;      // default: 5
  resetTimeoutMs: number;        // default: 30000
  halfOpenMaxRequests: number;   // default: 3
}
```

State machine: CLOSED (passes through) → OPEN (fails fast) after N consecutive failures → HALF_OPEN (probes) after timeout → CLOSED on success.

## SseBridge

```typescript
class SseBridge implements ConnectionBridge {
  constructor(config?: ConnectionConfig);

  readonly transport: ConnectionTransport;   // "sse"

  addClient(clientId: string): SseWriter;
  removeClient(clientId: string): void;
  attach(handler: (event: EngineEvent) => void): void;
  detach(handler: (event: EngineEvent) => void): void;
  send(event: EngineEvent): void;
  close(): Promise<void>;

  serializeEvent(event: EngineEvent): string;
  getReconnectInfo(): { timeout: number; maxAttempts: number };
}

function createSseResponse(
  bridge: SseBridge,
  request: { headers: { get(name: string): string | null } }
): { body: ReadableStream<Uint8Array>; headers: Record<string, string>; status: number } | null;
```

SSE connection management with heartbeat, per-client routing, and reconnection info. `createSseResponse()` returns a spec-compliant SSE response for server frameworks. Interface designed for future WebSocket adapter.

## HealthProbe

```typescript
class HealthProbe {
  registerCheck(name: string, check: () => Promise<{ status: "ok" | "error"; message?: string }>): void;

  health(lifecycle: EngineLifecycle, activeSessions: number): Promise<HealthStatus>;
}

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  activeSessions: number;
  engineState: EngineLifecycle;
  checks: Record<string, { status: "ok" | "error"; message?: string }>;
}
```

K8s-compatible health checks. Returns aggregate status across registered checks. `degraded` when any check fails, `unhealthy` when engine not running.
```