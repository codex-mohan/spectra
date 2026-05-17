# RateLimiter Reference

Sliding-window rate limiting for API protection.

## LocalRateLimiter

```typescript
new LocalRateLimiter(requestsPerMinute?: number, windowMs?: number)
```

Default: 60 requests per minute, 60-second sliding window.

### Methods

| Method | Description |
|---|---|
| `checkLimit(userId)` | Returns `{ allowed, remaining, resetAt }` |

## RedisRateLimiter

```typescript
new RedisRateLimiter(redis, config?)
```

### RedisRateLimiterConfig

| Option | Type | Default | Description |
|---|---|---|---|
| `requestsPerWindow` | `number` | 60 | Max requests per window |
| `windowMs` | `number` | 60000 | Window duration in ms |
| `keyPrefix` | `string` | "rl" | Redis key prefix |
| `burstAllowance` | `number` | 0 | Extra burst capacity |

## CompositeRateLimiter

Chains multiple rate limiters. All must pass.

```typescript
new CompositeRateLimiter(limits: CompositeLimit[])
```

### CompositeLimit

```typescript
interface CompositeLimit {
  limiter: RateLimiter;
  key: string; // e.g., "tenant", "user", "provider"
}
```

## RateLimitResult

```typescript
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}
```

## Related

- [Orchestration Guide](/typescript/orchestration) — Usage examples
- [SessionEngine Reference](/reference/typescript/session-engine) — Integration
