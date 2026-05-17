# Types Reference

Core types used across the TypeScript SDK.

## Message

```typescript
type Message = UserMessage | AssistantMessage | ToolResultMessage;

interface UserMessage {
  role: "user";
  content: (TextContent | ImageContent)[];
  timestamp?: number;
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ImageContent)[];
  toolCalls?: ToolCall[];
  timestamp?: number;
}

interface ToolResultMessage {
  role: "tool";
  content: (TextContent | ImageContent)[];
  toolCallId: string;
  toolName: string;
  timestamp?: number;
}
```

## Content

```typescript
type Content = TextContent | ImageContent;

interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string; // base64
  mimeType: string;
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

## ToolCall

```typescript
interface ToolCall {
  id: string;
  name: string;
  args: string; // JSON string
}
```

## StopReason

```typescript
type StopReason = "stop" | "length" | "tool_calls" | "error";
```

## Usage

```typescript
interface Usage {
  input: number;   // input tokens
  output: number;  // output tokens
  total: number;   // total tokens
}
```

## Related

- [Agent Reference](/reference/typescript/agent) — Uses Message, Model
- [Provider Reference](/typescript/providers) — Uses Model, Usage
