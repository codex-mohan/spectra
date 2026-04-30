# Providers

Spectra provides built-in LLM providers. Register custom ones via the provider registry.

## Built-in Providers

```typescript
import { initProviders } from "@singularity-ai/spectra-ai";

initProviders(); // registers anthropic, openai-completions, openai-responses
```

Use model objects with the provider field:

```typescript
const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
  },
});
```

## Custom Providers

```typescript
import { registerProvider } from "@singularity-ai/spectra-ai";

registerProvider({
  name: "my-provider",
  stream: (model, context, options) => {
    // Return an AssistantMessageEventStream
  },
});
```

## API Keys

```typescript
const agent = new Agent({
  model,
  streamOptions: { apiKey: process.env.MY_API_KEY },
  // Or resolve dynamically:
  getApiKey: async (provider) => {
    return provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  },
});
```
