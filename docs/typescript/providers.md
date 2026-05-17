# Providers

Spectra provides built-in LLM providers and a registry for custom ones.

## Built-in Providers

```typescript
import { initProviders } from "@singularity-ai/spectra-ai";

initProviders(); // registers: anthropic, openai-completions, openai-responses
```

### Provider Registry

| Provider Key | API Type | SDK Used |
|---|---|---|
| `anthropic` | `anthropic-messages` | `@anthropic-ai/sdk` |
| `openai` | `openai-completions` | `openai` (Chat Completions) |
| `openai` | `openai-responses` | `openai` (Responses API) |

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

### Model Object

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Model identifier (e.g., `gpt-4o`, `claude-sonnet-4-20250514`) |
| `name` | `string` | Yes | Display name |
| `provider` | `string` | Yes | Provider registry key |
| `api` | `string` | Yes | API type within the provider |
| `baseUrl` | `string` | No | Override API endpoint |
| `reasoning` | `boolean` | No | Enable reasoning mode |
| `maxTokens` | `number` | No | Max tokens in response |
| `headers` | `Record<string, string>` | No | Custom headers |

## API Keys

### Environment Variables (Recommended)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

The providers automatically read these from `process.env`.

### Dynamic Resolution

```typescript
const agent = new Agent({
  model,
  getApiKey: async (provider) => {
    if (provider === "openai") return process.env.OPENAI_API_KEY;
    if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
    return undefined;
  },
});
```

### Per-Request Key

```typescript
const agent = new Agent({
  model,
  streamOptions: { apiKey: "sk-custom-key" },
});
```

::: warning
Never hardcode API keys in source code. Use environment variables, a secrets manager, or a dynamic resolution function.
:::

## Custom Providers

Register any LLM provider that supports streaming:

```typescript
import { registerProvider } from "@singularity-ai/spectra-ai";

registerProvider({
  name: "my-provider",
  stream: (model, context, options) => {
    const stream = new AssistantMessageEventStream();

    // Your streaming implementation here
    // Push events as they arrive:
    stream.push({
      type: "content_delta",
      delta: { type: "text", text: "Hello " },
    });

    // Signal completion:
    stream.end({
      content: [{ type: "text", text: "Hello world" }],
      stopReason: "stop",
    });

    return stream;
  },
});
```

### OpenAI-Compatible Endpoints

For providers that implement the OpenAI API format (Groq, Together, local models):

```typescript
registerProvider({
  name: "groq",
  stream: (model, context, options) => {
    const client = new OpenAI({
      apiKey: options?.apiKey || process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const stream = new AssistantMessageEventStream();

    (async () => {
      const response = await client.chat.completions.create({
        model: model.id,
        messages: context.messages,
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
    })();

    return stream;
  },
});
```

## Provider Comparison

| Feature | Anthropic | OpenAI Chat | OpenAI Responses |
|---|---|---|---|
| Streaming | SSE | SSE | SSE |
| Tool calling | Yes | Yes | Yes |
| Image input | Yes | Yes | Yes |
| Reasoning | Extended thinking | o1/o3 models | Native |
| Max tokens | 200K (context) | 128K (context) | 128K (context) |

## Next Steps

- [**Adding a Provider Guide**](/guides/adding-a-provider) — Step-by-step custom provider creation
- [**Agent**](/typescript/agent) — How providers integrate with the agent
- [**Error Handling**](/guides/error-handling) — Provider-specific error patterns
