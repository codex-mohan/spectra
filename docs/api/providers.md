# Provider API

## Provider Registry

```typescript
function registerProvider(provider: Provider): void
function getProvider(name: string): Provider | undefined
function listProviders(): string[]
```

## Provider Interface

```typescript
interface Provider {
  name: string;
  stream: (model: Model, context: Context, options?: StreamOptions) => AssistantMessageEventStream;
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
