# Deployment

How to deploy Spectra agents to production environments.

## Environment Variables

Always use environment variables for secrets:

```bash
# Required (at least one)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Optional (for production features)
REDIS_URL=redis://localhost:6379
DATABASE_URL=file:./sessions.db
```

## Docker

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "dist/server.js"]
```

```bash
docker build -t spectra-agent .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e REDIS_URL=redis://redis:6379 \
  spectra-agent
```

## Serverless (Vercel)

For serverless functions, use the agent inline:

```typescript
// api/agent.ts
import { Agent } from "@mohanscodex/spectra-agent";

export async function POST(req: Request) {
  const { input } = await req.json();

  const agent = new Agent({
    model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
  });

  const chunks: string[] = [];
  for await (const event of agent.run(input)) {
    if (event.type === "message_update") {
      const text = event.message.content.filter(c => c.type === "text").map(c => c.text).join("");
      chunks.push(text);
    }
  }

  return Response.json({ response: chunks.join("") });
}
```

::: warning
Serverless functions have execution timeouts (usually 10-60 seconds). For long-running agent loops, use a dedicated server or worker queue.
:::

## Production Checklist

- [ ] API keys in environment variables (not hardcoded)
- [ ] Rate limiting enabled (CompositeRateLimiter)
- [ ] Session persistence (Redis or SQLite)
- [ ] Error monitoring (log SpectraError instances)
- [ ] Circuit breaker for provider failures
- [ ] `maxTurns` set to prevent infinite loops
- [ ] Tool results truncated to fit context limits
- [ ] Health check endpoint (`/health`)

## Health Check

```typescript
import { HealthProbe } from "@mohanscodex/spectra-app";

const health = new HealthProbe();
health.registerCheck("redis", async () => {
  try {
    await redis.ping();
    return { status: "ok" };
  } catch {
    return { status: "error", message: "Redis unavailable" };
  }
});

// GET /health
app.get("/health", async (c) => {
  const status = await health.health(engine.lifecycle, engine.activeSessionCount);
  return c.json(status, status.status === "healthy" ? 200 : 503);
});
```

## Next Steps

- [**Orchestration**](/typescript/orchestration) — SessionEngine, rate limiting
- [**Error Handling**](/guides/error-handling) — Production error patterns
