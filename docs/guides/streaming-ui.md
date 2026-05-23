# Streaming UI

How to render streaming agent responses in a user interface.

## Terminal UI

The simplest streaming UI — write tokens directly to stdout:

```typescript
for await (const event of agent.run("Tell me a story")) {
  if (event.type === "message_update") {
    const text = event.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    process.stdout.write(text);
  }
}
console.log(); // newline at the end
```

::: tip
Use `process.stdout.write()` not `console.log()` — it doesn't add newlines between chunks.
:::

## React UI

For a React component with streaming text:

```tsx
import { useState } from "react";
import { Agent } from "@mohanscodex/spectra-agent";

function ChatAgent() {
  const [messages, setMessages] = useState<string[]>([]);
  const [streaming, setStreaming] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  async function runAgent(input: string) {
    setIsRunning(true);
    setStreaming("");
    setMessages(prev => [...prev, `You: ${input}`]);

    const agent = new Agent({
      model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
    });

    let fullText = "";
    for await (const event of agent.run(input)) {
      if (event.type === "message_update") {
        const text = event.message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        fullText = text;
        setStreaming(text);
      }
    }

    setMessages(prev => [...prev, `Agent: ${fullText}`]);
    setStreaming("");
    setIsRunning(false);
  }

  return (
    <div>
      {messages.map((m, i) => <p key={i}>{m}</p>)}
      {streaming && <p className="streaming">{streaming}</p>}
      <button onClick={() => runAgent("Hello")} disabled={isRunning}>
        {isRunning ? "Running..." : "Run Agent"}
      </button>
    </div>
  );
}
```

## SSE to Browser

For server-side agents streaming to browser clients via SSE:

```typescript
// Server (Hono/Express)
app.get("/api/agent/stream", async (c) => {
  const stream = new ReadableStream({
    async start(controller) {
      const agent = new Agent({ model: /* ... */ });
      for await (const event of agent.run(c.req.query("input"))) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
```

```javascript
// Browser
const eventSource = new EventSource("/api/agent/stream?input=Hello");
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "message_update") {
    appendToUI(data.message.content);
  }
};
```

## Handling Tool Calls in UI

Show tool execution status to the user:

```tsx
const [toolStatus, setToolStatus] = useState<{ name: string; status: string }[]>([]);

for await (const event of agent.run(input)) {
  switch (event.type) {
    case "tool_execution_start":
      setToolStatus(prev => [...prev, { name: event.toolName, status: "running" }]);
      break;
    case "tool_execution_end":
      setToolStatus(prev => prev.map(t =>
        t.name === event.toolName ? { ...t, status: event.isError ? "failed" : "done" } : t
      ));
      break;
  }
}
```

## Next Steps

- [**Events Guide**](/typescript/events) — All event types
- [**Recipe: Chatbot with Sessions**](/recipes/chatbot-with-sessions) — Full chatbot example
