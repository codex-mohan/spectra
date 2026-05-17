# Adding Providers

How to add a new LLM provider to Spectra.

## TypeScript

### 1. Create the Provider

In `packages/ai/src/providers/`, create a new file:

```typescript
// my-provider.ts
import { AssistantMessageEventStream } from "../event-stream";
import type { Model, Context, StreamOptions } from "../types";

export function createMyProvider() {
  return {
    name: "my-provider",
    stream: (model: Model, context: Context, options?: StreamOptions) => {
      const stream = new AssistantMessageEventStream();

      // Your streaming implementation
      // Push events as they arrive:
      // stream.push({ type: "content_delta", delta: { type: "text", text: "..." } });

      // Signal completion:
      // stream.end({ content: [...], stopReason: "stop" });

      return stream;
    },
  };
}
```

### 2. Register It

```typescript
import { registerProvider } from "../registry";
import { createMyProvider } from "./my-provider";

registerProvider(createMyProvider());
```

### 3. Add to Built-ins (Optional)

Add to `packages/ai/src/providers/register-builtins.ts`:

```typescript
import { createMyProvider } from "./my-provider";
registerProvider(createMyProvider());
```

## Rust

### 1. Create the Client

In `crates/spectra-http/src/`, create a new file:

```rust
// my_client.rs
use async_trait::async_trait;
use spectra_rs::{LlmClient, LlmRequest, LlmResponse, LlmStream, SpectraError};

pub struct MyClient {
    api_key: String,
    base_url: String,
}

impl MyClient {
    pub fn new(api_key: String) -> Self {
        Self { api_key, base_url: "https://api.example.com/v1".to_string() }
    }

    pub fn from_env() -> Result<Self, SpectraError> {
        let api_key = std::env::var("MY_API_KEY")
            .map_err(|_| SpectraError::ConfigError("MY_API_KEY not set".into()))?;
        Ok(Self::new(api_key))
    }
}

#[async_trait]
impl LlmClient for MyClient {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse, SpectraError> {
        // Implement non-streaming
        todo!()
    }

    async fn stream(&self, req: LlmRequest) -> Result<LlmStream, SpectraError> {
        // Implement SSE streaming
        todo!()
    }
}
```

### 2. Export It

In `crates/spectra-http/src/lib.rs`:

```rust
mod my_client;
pub use my_client::MyClient;
```

### 3. Add Tests

In `crates/spectra-http/src/test.rs`, add wiremock tests for your client.

## Testing

Test your provider with a simple script:

```typescript
const agent = new Agent({
  model: { id: "your-model", name: "Test", provider: "my-provider", api: "my-api" },
});

for await (const event of agent.run("Say hello")) {
  if (event.type === "message_update") {
    console.log(event.message.content);
  }
}
```

## Next Steps

- [**Provider Reference**](/typescript/providers) — Provider interface
- [**Coding Standards**](/contribute/coding-standards) — Conventions
