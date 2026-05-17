# Chatbot with Sessions

A persistent chatbot that remembers conversation history across requests.

## What It Does

Creates a chatbot that maintains conversation state using `SessionManager`, allowing users to have multi-turn conversations that persist across server restarts.

## Prerequisites

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent @singularity-ai/spectra-app
export ANTHROPIC_API_KEY=sk-ant-...
```

## Full Code

```typescript
import { Agent } from "@singularity-ai/spectra-agent";
import { SessionManager, InMemorySessionStore } from "@singularity-ai/spectra-app";

const sessions = new SessionManager(new InMemorySessionStore());

async function chat(userId: string, input: string, sessionId?: string) {
  let session;

  if (sessionId) {
    session = await sessions.load(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
  } else {
    session = await sessions.create(
      {
        model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
        systemPrompt: "You are a helpful assistant. Remember the conversation history.",
      },
      userId
    );
  }

  // Restore conversation history
  const agent = new Agent({
    model: session.model,
    systemPrompt: session.config.systemPrompt,
  });

  // Load previous messages
  for (const entry of session.entries) {
    if (entry.type === "message") {
      agent.messages.push(entry.message);
    }
  }

  // Run the agent
  let fullResponse = "";
  for await (const event of agent.run(input)) {
    if (event.type === "message_update") {
      const text = event.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      fullResponse = text;
      process.stdout.write(text);
    }
  }
  console.log();

  // Save the conversation
  session.entries.push({
    type: "message",
    message: { role: "user", content: input, timestamp: Date.now() },
    timestamp: Date.now(),
  });
  session.entries.push({
    type: "message",
    message: { role: "assistant", content: fullResponse, timestamp: Date.now() },
    timestamp: Date.now(),
  });
  session.metadata.turnCount += 1;
  await sessions.save(session);

  return { sessionId: session.id, response: fullResponse };
}

// Example usage
const { sessionId } = await chat("user-123", "My name is Alice");
console.log(`Session: ${sessionId}\n`);

await chat("user-123", "What's my name?", sessionId);
// Agent responds: "Your name is Alice"
```

## How It Works

1. First message creates a new session with a unique ID
2. Subsequent messages load the session and restore conversation history
3. Each exchange is saved back to the session store
4. Sessions persist across server restarts (with a persistent store)

## Production Setup

Replace `InMemorySessionStore` with `RedisSessionStore` for distributed deployments:

```typescript
import { RedisSessionStore, SQLiteSessionStore } from "@singularity-ai/spectra-app";

const store = new RedisSessionStore(new Redis(), {
  ttlSeconds: 86400, // 24 hours
  coldStore: new SQLiteSessionStore("./sessions.db"),
});
```

## Next Steps

- [**Session Management Guide**](/guides/session-management) — Store selection, forking
- [**Streaming UI**](/guides/streaming-ui) — Rendering in a web interface
