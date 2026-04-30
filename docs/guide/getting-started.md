# Getting Started

## Installation

```bash
bun add @spectra/ai @spectra/agent
```

## Quick Start

```typescript
import { Agent } from "@spectra/agent";
import { anthropic } from "@spectra/ai";

const agent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: "You are a helpful assistant.",
});

for await (const event of agent.run("What's 2+2?")) {
  if (event.type === "message_update") {
    const text = event.message.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("");
    process.stdout.write(text);
  }
}
```
