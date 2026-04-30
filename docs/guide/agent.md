# Agent

The `Agent` class orchestrates multi-turn conversations with automatic tool dispatch and streaming event delivery.

## Creating an Agent

```typescript
import { Agent } from "@spectra/agent";

const agent = new Agent({
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
  systemPrompt: "You are a helpful assistant.",
  maxTurns: 10,
  toolExecution: "parallel",
});
```

## Running

```typescript
for await (const event of agent.run("Tell me a joke")) {
  switch (event.type) {
    case "message_update":
      // streaming content delta
      break;
    case "tool_execution_start":
      // tool about to execute
      break;
    case "tool_execution_end":
      // tool finished, check event.isError
      break;
    case "agent_end":
      // run complete, event.messages has full transcript
      break;
  }
}
```

## Subscribing

```typescript
const unsubscribe = agent.subscribe((event, signal) => {
  if (event.type === "tool_execution_update") {
    console.log("Tool progress:", event.partialResult);
  }
});

await agent.prompt("Search for something");
unsubscribe();
```

## State

```typescript
agent.messages        // current transcript
agent.isStreaming     // whether a run is active
agent.streamingMessage // partial assistant message
agent.pendingToolCalls // tool calls in flight
agent.errorMessage    // last error, if any
```

## Queues

```typescript
agent.steer("Be more concise"); // inject mid-stream
agent.followUp("What about X?"); // queue after current run
agent.abort();         // abort current run
agent.reset();         // clear state
```
