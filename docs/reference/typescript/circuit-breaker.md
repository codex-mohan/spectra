# CircuitBreaker Reference

State machine for protecting against cascading failures.

## Constructor

```typescript
new DefaultCircuitBreaker(config?)
```

### CircuitBreakerConfig

| Option | Type | Default | Description |
|---|---|---|---|
| `failureThreshold` | `number` | 5 | Consecutive failures before opening |
| `resetTimeoutMs` | `number` | 30000 | Time before half-open probe |
| `halfOpenMaxRequests` | `number` | 3 | Max probe requests in half-open |

## States

| State | Behavior |
|---|---|
| `CLOSED` | Requests pass through normally |
| `OPEN` | Requests fail immediately (fast fail) |
| `HALF_OPEN` | Allows limited probe requests to test recovery |

## State Transitions

```
CLOSED → OPEN: After N consecutive failures
OPEN → HALF_OPEN: After resetTimeoutMs elapsed
HALF_OPEN → CLOSED: On successful probe
HALF_OPEN → OPEN: On failed probe
```

## Methods

| Method | Description |
|---|---|
| `call(fn)` | Execute function through the breaker |
| `recordSuccess()` | Manually record a success |
| `recordFailure()` | Manually record a failure |

## Properties

| Property | Type | Description |
|---|---|---|
| `state` | `CircuitBreakerState` | Current state |
| `failureCount` | `number` | Current consecutive failures |

## Related

- [Error Handling Guide](/guides/error-handling) — Retry patterns
- [SessionEngine Reference](/reference/typescript/session-engine) — Integration
