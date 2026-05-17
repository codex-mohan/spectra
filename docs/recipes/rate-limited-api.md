# Rate-Limited API

A production-ready API endpoint with rate limiting, session management, and SSE streaming.

## What It Does

Exposes a Spectra agent as an HTTP API with rate limiting per user, session persistence, and SSE streaming to the browser.

## Prerequisites

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent @singularity-ai/spectra-app
bun add hono  # or express/fastify
export ANTHROPIC_API_KEY=sk-ant-...
export REDIS_URL=redis://localhost:6379
```

## Full Code

```typescript
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Agent } from "@singularity-ai/spectra-agent";
import {
  SessionEngine,
  SessionManager,
  RedisSessionStore,
  CompositeRateLimiter,
  RedisRateLimiter,
} from "@singularity-ai/spectra-app";
import Redis from "ioredis";

const app = new Hono();

// Set up production infrastructure
const redis = new Redis(process.env.REDIS_URL!);
const sessions = new SessionManager(
  new RedisSessionStore(redis, { ttlSeconds: 3600 })
);

const engine = new SessionEngine({
  sessionManager: sessions,
  rateLimiter: new CompositeRateLimiter([
    {
      limiter: new RedisRateLimiter(redis, { keyPrefix: "rl:tenant", requestsPerWindow: 1000 }),
      key: "tenant",
    },
    {
      limiter: new RedisRateLimiter(redis, { keyPrefix: "rl:user", requestsPerWindow: 30 }),
      key: "user",
    },
  ]),
  maxConcurrentSessions: 5000,
});

engine.start();

// SSE streaming endpoint
app.get("/api/chat", (c) => {
  const userId = c.req.query("userId") || "anonymous";
  const input = c.req.query("input");
  const sessionId = c.req.query("sessionId");

  if (!input) return c.json({ error: "Missing input" }, 400);

  return streamSSE(c, async (stream) => {
    try {
      const eventStream = await engine.runStreaming(userId, input, sessionId || undefined, {
        model: {
          id: "claude-sonnet-4-20250514",
          name: "Claude",
          provider: "anthropic",
          api: "anthropic-messages",
        },
      });

      for await (const event of eventStream) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error: any) {
      if (error.message?.includes("Rate limit")) {
        await stream.writeSSE({ data: JSON.stringify({ type: "error", message: "Rate limit exceeded" }) });
      } else {
        await stream.writeSSE({ data: JSON.stringify({ type: "error", message: error.message }) });
      }
    }
  });
});

// Health check
app.get("/health", async (c) => {
  const status = await engine.health();
  return c.json(status, status.status === "healthy" ? 200 : 503);
});

export default app;
```

## Client-Side Usage

```javascript
const params = new URLSearchParams({
  userId: "user-123",
  input: "Hello, what can you do?",
});

const eventSource = new EventSource(`/api/chat?${params}`);
let responseText = "";

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "message_update") {
    const text = data.message.content?.filter(c => c.type === "text").map(c => c.text).join("");
    if (text) {
      responseText = text;
      updateUI(responseText);
    }
  }
  if (data.type === "agent_end") {
    eventSource.close();
  }
  if (data.type === "error") {
    console.error(data.message);
    eventSource.close();
  }
};
```

## How It Works

1. Client sends GET request with `userId` and `input`
2. `SessionEngine` checks rate limits for the user
3. If allowed, loads or creates a session
4. Runs the agent and streams events via SSE
5. Session is automatically saved with the conversation

## Next Steps

- [**Deployment Guide**](/guides/deployment) — Docker, serverless
- [**Orchestration**](/typescript/orchestration) — SessionEngine configuration
