# Adding a Provider

This guide shows you how to register a custom LLM provider in Spectra.

Spectra already ships with **21 built-in providers** (Anthropic, OpenAI, Groq, OpenRouter, plus 16 OpenAI-compatible endpoints) and an auto-generated model catalog of **4,000+ models** across **150+ providers**. You only need to add a custom provider if your target is not covered.

## When to Add a Custom Provider

- Using an OpenAI-compatible endpoint not already in the built-in list
- Integrating with a proprietary LLM API that has a non-standard format
- Adding support for a new provider not yet in Spectra

## TypeScript

### Step 1: Import the Registry

```typescript
import { registerProvider, AssistantMessageEventStream } from "@singularity-ai/spectra-ai";
```

### Step 2: Implement the Stream Function

```typescript
import { OpenAI } from "openai";

registerProvider({
  name: "groq",
  stream: (model, context, options) => {
    const stream = new AssistantMessageEventStream();

    const client = new OpenAI({
      apiKey: options?.apiKey || process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });

    (async () => {
      try {
        const response = await client.chat.completions.create({
          model: model.id,
          messages: context.messages.map(m => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : undefined,
          })),
          stream: true,
        });

        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            stream.push({
              type: "content_delta",
              delta: { type: "text", text },
            });
          }
        }

        stream.end({
          content: [{ type: "text", text: "full response" }],
          stopReason: "stop",
        });
      } catch (error) {
        stream.end({
          content: [{ type: "text", text: `Error: ${error.message}` }],
          stopReason: "error",
        });
      }
    })();

    return stream;
  },
});
```

### Step 3: Use the Provider

```typescript
const agent = new Agent({
  model: {
    id: "llama-3.1-70b",
    name: "Llama 3.1",
    provider: "groq",
    api: "openai-completions",
  },
});
```

### Optional: Add Model Listing

If you want your provider to support `getModels()`:

```typescript
registerProvider({
  name: "my-provider",
  listModels: () => [
    { id: "my-model-v1", name: "My Model v1" },
    { id: "my-model-v2", name: "My Model v2" },
  ],
  stream: (model, context, options) => { /* ... */ },
});
```

## Rust

### Step 1: Implement LlmClient

```rust
use async_trait::async_trait;
use spectra_rs::{LlmClient, LlmRequest, LlmResponse, LlmStream, SpectraError};

pub struct GroqClient {
    api_key: String,
    base_url: String,
}

impl GroqClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            base_url: "https://api.groq.com/openai/v1".to_string(),
        }
    }
}

#[async_trait]
impl LlmClient for GroqClient {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse, SpectraError> {
        // Implement non-streaming completion
        todo!()
    }

    async fn stream(&self, req: LlmRequest) -> Result<LlmStream, SpectraError> {
        // Implement SSE streaming (similar to OpenAIClient in spectra-http)
        todo!()
    }
}
```

### Step 2: Use the Client

```rust
let client = GroqClient::new(std::env::var("GROQ_API_KEY")?);
let agent = AgentBuilder::new()
    .model(Model::openai("llama-3.1-70b"))
    .build(client);
```

## Testing Your Provider

```typescript
const agent = new Agent({
  model: { id: "your-model", name: "Test", provider: "your-provider", api: "your-api" },
});

for await (const event of agent.run("Say hello")) {
  if (event.type === "message_update") {
    const text = event.message.content.filter(c => c.type === "text").map(c => c.text).join("");
    console.log(text);
  }
}
```

## Next Steps

- [**Providers Overview**](/typescript/providers) — Built-in providers and model catalog
- [**Error Handling**](/guides/error-handling) — Provider-specific error patterns
