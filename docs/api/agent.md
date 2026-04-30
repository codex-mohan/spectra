# Agent API

## Constructor

```typescript
new Agent(config: AgentConfig)
```

### AgentConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `Model` | required | LLM model configuration |
| `systemPrompt` | `string` | undefined | System prompt |
| `tools` | `AgentTool[]` | [] | Registered tools |
| `maxTurns` | `number` | undefined | Max LLM turns (unlimited) |
| `toolExecution` | `"parallel" \| "sequential"` | `"parallel"` | Tool execution strategy |
| `beforeToolCall` | `BeforeToolCallHook` | undefined | Called before tool execution |
| `afterToolCall` | `AfterToolCallHook` | undefined | Called after tool execution |
| `transformContext` | `TransformContextHook` | undefined | Transform messages before LLM call |
| `getApiKey` | `GetApiKeyHook` | undefined | Dynamic API key resolution |
| `streamOptions` | `StreamOptions` | undefined | API key, headers, maxTokens, temperature |

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
|----------|------|-------------|
| `messages` | `Message[]` | Current transcript |
| `isStreaming` | `boolean` | Whether a run is active |
| `streamingMessage` | `AssistantMessage \| undefined` | Current partial assistant message |
| `pendingToolCalls` | `ReadonlySet<string>` | Tool calls in flight |
| `errorMessage` | `string \| undefined` | Last error message |
| `signal` | `AbortSignal \| undefined` | Current abort signal |
