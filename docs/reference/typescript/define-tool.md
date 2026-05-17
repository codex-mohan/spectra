# defineTool Reference

Create a typed tool with Zod schema validation.

## Signature

```typescript
function defineTool<T extends z.ZodType>(schema: {
  name: string;
  description: string;
  parameters: T;
  promptGuidelines?: string[];
  execute: (
    args: z.infer<T>,
    context: {
      toolCallId: string;
      signal?: AbortSignal;
      onUpdate?: ToolUpdateCallback;
    }
  ) => Promise<ToolResult>;
}): AgentTool
```

## Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Unique tool identifier (snake_case recommended) |
| `description` | `string` | Yes | Description the LLM uses to decide when to call the tool |
| `parameters` | `z.ZodType` | Yes | Zod schema for argument validation |
| `promptGuidelines` | `string[]` | No | Additional guidance for the LLM about tool usage |
| `execute` | `Function` | Yes | Async function that performs the tool's action |

## Execute Context

| Field | Type | Description |
|---|---|---|
| `toolCallId` | `string` | Unique ID for this tool call |
| `signal` | `AbortSignal` | Abort signal for cancellation |
| `onUpdate` | `ToolUpdateCallback` | Report partial progress |

## ToolResult

```typescript
interface ToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError?: boolean;
}
```

## Related

- [Tools Guide](/typescript/tools) — Usage examples
- [Tool Design Patterns](/guides/tool-design-patterns) — Best practices
