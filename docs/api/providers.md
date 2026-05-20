# Provider API

## Provider Registry

```typescript
function registerProvider(provider: Provider): void
function getProvider(name: string): Provider | undefined
function listProviders(): string[]
function getModels(providerName: string): Promise<ModelInfo[]>
```

## Provider Interface

```typescript
interface Provider {
  name: string;
  stream: (model: Model, context: Context, options?: StreamOptions) => AssistantMessageEventStream;
  listModels?: () => ModelInfo[] | Promise<ModelInfo[]>;
}
```

## Model

```typescript
interface Model {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl?: string;
  reasoning?: boolean;
  maxTokens?: number;
  headers?: Record<string, string>;
}
```

## ModelEntry (from auto-generated catalog)

```typescript
interface ModelEntry {
  id: string;
  name: string;
}

function getProviderModels(providerId: string): ModelEntry[]
```

The model catalog is auto-generated at build time from OpenRouter API and models.dev, containing 4,000+ models across 150+ providers.

## StreamOptions

```typescript
interface StreamOptions {
  signal?: AbortSignal;
  apiKey?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
}
```

## EventStream

```typescript
class EventStream<T, R> implements AsyncIterable<T> {
  push(event: T): void;
  end(result?: R): void;
  result(): Promise<R>;
}
```
