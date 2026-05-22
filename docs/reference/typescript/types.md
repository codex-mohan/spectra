# Types Reference

Core types used across the TypeScript SDK.

## Message

```typescript
type Message = UserMessage | AssistantMessage | ToolResultMessage;

interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
  /** Arbitrary metadata for app/ui use. Ignored by LLM context. */
  metadata?: Record<string, unknown>;
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  provider: string;
  model: string;
  responseId?: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
  /** Arbitrary metadata for app/ui use. Ignored by LLM context. */
  metadata?: Record<string, unknown>;
}

interface ToolResultMessage<TDetails = unknown> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  /** Typed tool-specific metadata (e.g. diff, truncation info). Ignored by LLM context. */
  details?: TDetails;
  isError: boolean;
  timestamp: number;
  /** Arbitrary metadata for app/ui use. Ignored by LLM context. */
  metadata?: Record<string, unknown>;
  provenance?: {
    blockedBy?: string;
    blockReason?: string;
    transformedBy?: string;
    retryCount?: number;
    hookDetails?: Record<string, unknown>;
  };
}
```

## Content

```typescript
type Content = TextContent | ImageContent | ThinkingContent;

interface TextContent {
  type: "text";
  text: string;
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

interface ImageContent {
  type: "image";
  data: string; // base64
  mimeType: string;
}
```

## ToolCall

```typescript
interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thinkingSignature?: string;
}
```

## StopReason

```typescript
type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

## Usage

```typescript
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
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

## Context

```typescript
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
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

## Related

- [Agent Reference](/reference/typescript/agent) — Uses Message, Model
- [Provider Reference](/typescript/providers) — Uses Model, Usage
