# Error Handling

How to handle errors in Spectra agents — retry patterns, fallbacks, and error types.

## Error Types

### TypeScript

```typescript
// Provider errors (API failures, rate limits, auth errors)
// Tool errors (execution failures, validation errors)
// Agent errors (max turns exceeded, configuration errors)
```

### Rust

```rust
pub enum SpectraError {
    #[error("API error: {0}")]
    ApiError(String),

    #[error("Tool execution failed: {0}")]
    ToolError(String),

    #[error("Stream error: {0}")]
    StreamError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),
}
```

## Retry Pattern

Wrap provider calls with retry logic:

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000; // exponential backoff
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}
```

## Tool Error Handling

Tools should catch errors and return them to the LLM:

```typescript
defineTool({
  name: "fetch_data",
  description: "Fetch data from an API",
  parameters: z.object({ url: z.string().url() }),
  execute: async ({ url }) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return {
          content: [{ type: "text", text: `HTTP ${response.status}: ${response.statusText}` }],
          isError: true,
        };
      }
      const data = await response.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to fetch: ${error.message}` }],
        isError: true,
      };
    }
  },
});
```

The LLM receives the error and can:
- Retry with different parameters
- Try a different tool
- Explain the error to the user

## Circuit Breaker (Production)

For production systems, use a circuit breaker to prevent cascading failures:

```typescript
import { DefaultCircuitBreaker } from "@mohanscodex/spectra-app";

const breaker = new DefaultCircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxRequests: 3,
});

async function callLLM(input: string) {
  return await breaker.call(() => agent.run(input));
}
```

States:
- **CLOSED**: Requests pass through normally
- **OPEN**: Requests fail immediately (after N consecutive failures)
- **HALF_OPEN**: Allows a few probe requests to test recovery

## Rate Limit Errors

Handle 429 responses gracefully:

```typescript
execute: async ({ url }) => {
  try {
    const response = await fetch(url);
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5000;
      await new Promise(r => setTimeout(r, waitMs));
      // Retry once
      return await execute({ url });
    }
    // ...
  }
}
```

## Next Steps

- [**Deployment Guide**](/guides/deployment) — Production error monitoring
- [**Circuit Breaker Reference**](/reference/typescript/circuit-breaker) — Configuration options
