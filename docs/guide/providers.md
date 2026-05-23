# Providers

Spectra provides built-in LLM providers and a registry for custom ones. On import, **21 providers** are auto-registered — core providers (Anthropic, OpenAI, Groq, OpenRouter) plus 16 OpenAI-compatible endpoints (xAI, DeepSeek, Mistral, Cerebras, Google, Fireworks AI, Together AI, Perplexity, Cohere, Novita AI, Moonshot AI, Chutes, MiniMax, HuggingFace, NVIDIA, Z AI).

## Built-in Providers

```typescript
import { initProviders } from "@mohanscodex/spectra-ai";

initProviders(); // auto-called on import
```

## Model Catalog

Spectra auto-generates a model catalog at build time from **OpenRouter API** and **models.dev**, producing 4,000+ models across 150+ providers. See [Providers Overview](/typescript/providers#model-registry) for details.

```typescript
import { getProviderModels, getModels, listProviders } from "@mohanscodex/spectra-ai";

const models = getProviderModels("anthropic");
const allProviders = listProviders();
```

## Using a Provider

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
import { registerProvider } from "@mohanscodex/spectra-ai";

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
