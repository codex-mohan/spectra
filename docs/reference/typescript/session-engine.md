# SessionEngine Reference

Orchestrates the full request lifecycle: session load → rate limit check → agent execution → persist → stream results.

## Constructor

```typescript
new SessionEngine(config: SessionEngineConfig)
```

### SessionEngineConfig

| Option | Type | Default | Description |
|---|---|---|---|
| `sessionManager` | `SessionManager` | required | Session lifecycle manager |
| `rateLimiter` | `RateLimiter` | — | Rate limiting middleware |
| `tenantResolver` | `TenantResolver` | — | Multi-tenant support |
| `circuitBreaker` | `CircuitBreaker` | — | Failure protection |
| `engineId` | `string` | auto-generated | Unique engine identifier |
| `defaultStreamOptions` | `StreamOptions` | — | Default streaming config |
| `maxConcurrentSessions` | `number` | 100 | Max concurrent sessions |
| `sessionTimeoutMs` | `number` | 300000 | Session idle timeout (5 min) |

## Methods

| Method | Description |
|---|---|
| `start()` | Start the engine |
| `stop(drain?: boolean)` | Graceful shutdown |
| `run(userId, input, sessionId?, options?)` | Blocking run — returns when complete |
| `runStreaming(userId, input, sessionId?, options?)` | Streaming run — returns AsyncGenerator |
| `attachBridge(bridge)` | Attach SSE/WebSocket bridge |
| `abortSession(sessionId)` | Abort a running session |
| `health()` | K8s-compatible health status |

## Properties

| Property | Type | Description |
|---|---|---|
| `lifecycle` | `EngineLifecycle` | "starting" \| "running" \| "draining" \| "stopped" |
| `activeSessionCount` | `number` | Current active sessions |

## Related

- [Orchestration Guide](/typescript/orchestration) — Usage examples
- [SessionManager Reference](/reference/typescript/session-manager) — Session lifecycle
