# Agent Reference

The `Agent` class orchestrates multi-turn conversations with automatic tool dispatch and streaming event delivery.

## Constructor

```typescript
new Agent(config: AgentConfig)
```

### AgentConfig

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `Model` | required | LLM model configuration |
| `systemPrompt` | `string` | — | System prompt for the agent |
| `tools` | `AgentTool[]` | `[]` | Registered tools |
| `maxTurns` | `number` | unlimited | Max LLM turns before stopping |
| `toolExecution` | `"parallel" \| "sequential"` | `"parallel"` | Tool execution strategy |
| `beforeToolCall` | `BeforeToolCallHook` | — | Called before each tool execution |
| `afterToolCall` | `AfterToolCallHook` | — | Called after each tool execution |
| `transformContext` | `TransformContextHook` | — | Transform messages before LLM call |
| `getApiKey` | `GetApiKeyHook` | — | Dynamic API key resolution |

## Methods

### `run(input)`

Start a conversation turn. Returns `AsyncGenerator<AgentEvent>`.

```typescript
async *run(input: string | Message | Message[]): AsyncGenerator<AgentEvent>
```

### `subscribe(listener)`

Subscribe to lifecycle events. Returns unsubscribe function.

```typescript
subscribe(listener: AgentEventListener): () => void
```

### `steer(message)`

Inject a message during streaming, processed at next turn boundary.

```typescript
steer(message: string | Message): void
```

### `followUp(message)`

Queue a message to run after the agent would otherwise stop.

```typescript
followUp(message: string | Message): void
```

### `abort()`

Abort the current run.

```typescript
abort(): void
```

### `reset()`

Clear transcript and runtime state.

```typescript
reset(): void
```

## Properties

| Property | Type | Description |
|---|---|---|
| `messages` | `Message[]` | Current transcript |
| `isStreaming` | `boolean` | Whether a run is active |
| `streamingMessage` | `AssistantMessage \| undefined` | Current partial assistant message |
| `pendingToolCalls` | `ReadonlySet<string>` | Tool calls in flight |
| `errorMessage` | `string \| undefined` | Last error message |
| `signal` | `AbortSignal \| undefined` | Current abort signal |

## Related

- [Agent Guide](/typescript/agent) — Usage examples and patterns
- [Events Reference](/typescript/events) — AgentEvent types
