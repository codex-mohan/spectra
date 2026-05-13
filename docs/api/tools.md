# Tools API

## `defineTool(schema)`

Create a typed tool with Zod schema validation.

```typescript
function defineTool<T extends z.ZodType>(schema: {
  name: string;
  description: string;
  parameters: T;
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

## `AgentTool` Interface

```typescript
interface AgentTool<TDetails = unknown> {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  promptGuidelines?: string[];
  prepareArguments?: (args: unknown) => Record<string, unknown>;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback<TDetails>
  ) => Promise<ToolResult<TDetails>>;
}
```

## `ToolResult`

```typescript
interface ToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError?: boolean;
}
```
