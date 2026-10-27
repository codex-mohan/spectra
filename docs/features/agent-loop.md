# Agent loop

> The `Agent` class owns one conversation: it streams a model response, dispatches the tool calls it contains, appends every message to canonical history, and yields an `AgentEvent` per step to whoever iterates `run()`.

## Source

- Entry: `packages/agent/src/agent.ts` — `Agent`, `run()` async generator, `runLoop()`, streaming retry, sequential and parallel tool dispatch, audit/provenance emission.
- Types: `packages/agent/src/types.ts` — `AgentEvent`, `AgentConfig`/`AgentRuntimeConfig`, `AgentTool`, `ToolResult`, hook contexts.
- Exports: `packages/agent/src/index.ts` — re-exports `Agent`, `defineTool`, `runSubagent`, skill helpers, and the types above.
- Collaborators:
  - `packages/ai/src/registry.ts` — `stream()` resolves the provider for `model.provider`.
  - `packages/ai/src/event-stream.ts` — `EventStream`/`AssistantMessageEventStream` implement the queue-plus-promise `result()` pattern.
  - `packages/agent/src/define-tool.ts` — `defineTool()` converts a Zod schema into an `AgentTool` with `prepareArguments`.

## Registration / gating

- Not registered in a global registry; the host constructs it. Live call sites: `packages/code/src/tui/hooks/use-agent.ts:317` and `:540`, `packages/code/src/integrations/acp/server.ts:156`.
- Tools are supplied per construction/runtime config; `registerTool()` adds one after construction.
- Defaults: `toolExecution: 'parallel'`, `steeringMode: 'one-at-a-time'`, `followUpMode: 'one-at-a-time'`, `maxRetryDelayMs: 30000`, provenance enabled with `includeArgs: 'hash'` (`agent.ts:47-51`, `agent.ts:200-211`).
- Permission profile: none. The loop executes whatever tools it is given; policy lives in the tool wrapper (`docs/features/tool-registry.md`) and hooks.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `string \| Message \| Message[]` | yes | Strings become user messages with a timestamp; arrays are normalized element-wise (private `normalizeInput`). |
| `options.signal` | `AbortSignal` | no | Linked to the internal controller; an already-aborted signal aborts the run immediately. |
| `config.model` | `Model` | yes | Provider/model identity used for `stream()` and error messages. |
| `config.systemPrompt` | `string` | no | Placed on every built `Context`. |
| `config.tools` | `AgentTool[]` | no | Replaces the tool map on construction and on `configure()`. |
| `config.maxTurns` | `number` | no | Turn cap; omitted means unlimited. |
| `config.toolExecution` | `'parallel' \| 'sequential'` | no | Dispatch mode, default `parallel`. |
| `config.beforeToolCall` / `afterToolCall` | hook | no | Block/transform args; replace result content or error flag. |
| `config.transformContext` / `beforeModelCall` | hook | no | Rewrite history before a turn; inject messages for one model call. |
| `config.convertToLlm` | `(messages) => Message[]` | no | Applied immediately before each provider stream call. |
| `config.getApiKey` | `(provider) => key` | no | Resolved each turn; when omitted, `streamOptions.apiKey` is used, and the provider falls back to its environment lookup. |

## Outputs

- `run()` yields `AgentEvent` variants: `agent_start`, `message_start`, `message_update`, `message_end`, `turn_start`, `turn_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `audit`, `agent_end`.
- Terminal `agent_end` carries the full `Message[]`; the internal `AgentEventStream` treats it as the completion event (`agent.ts:126-140`).
- Subscribers registered with `subscribe()` receive the same events; listener exceptions are swallowed so one failing subscriber cannot break the run (`agent.ts:252-262`).
- Tool results are appended as `ToolResultMessage` (role `toolResult`) with `content`, `details`, `isError`, `timestamp`, optional `provenance`, then emitted as `message_start`/`message_end` before `tool_execution_end` (`agent.ts:929-966`).
- Files: none. The loop never touches the filesystem.

## Flow

1. `run()` rejects a second concurrent run, creates an `AbortController`, links `options.signal`, appends user messages, and emits `agent_start` plus `message_start`/`message_end` per input, then `turn_start` (`agent.ts:264-318`).
2. `runLoop()` is started fire-and-forget; the generator yields events as the internal `AgentEventStream` receives them, then awaits the loop (`agent.ts:321-340`).
3. Each turn optionally applies `transformContext`, builds a `Context` (system prompt, messages, tool definitions), applies `beforeModelCall`, resolves the API key, then streams (`agent.ts:366-441`).
4. `doStream()` replaces the last history entry with each partial message, emitting `message_update` for text/thinking/tool-call deltas; `done`/`error` resolves the final `AssistantMessage` (`agent.ts:644-706`).
5. Text-only responses emit `turn_end`; steering is drained, then follow-ups, and either the loop continues with `turns = 0` or emits `agent_end` (`agent.ts:420-431`).
6. Responses with tool calls run either `executeToolCallsSequential` or `executeToolCallsParallel`; parallel prepares every call (validation + `beforeToolCall`) sequentially, then runs them via `Promise.all` (`agent.ts:716-727`).
7. Each prepared call emits `tool_execution_start`, executes with the abort signal and an `onUpdate` callback that emits `tool_execution_update`, then finalizes through `afterToolCall` and emits `tool_execution_end` (`agent.ts:757-926`).
8. After `turn_end`, steering is drained; a non-empty queue resets the turn counter and loops. The `while` condition stops on abort (`agent.ts:341`, `agent.ts:433-440`).

## State / persistence

- `_messages` is the only conversation state; `messages` returns a copy and `restoreHistory()` replaces it. Nothing is written to disk.
- `reset()` clears history, queues, streaming flags, and error text; queued steering/follow-up messages are discarded.
- `configure()` replaces model, prompt, tools, limits, stream options, and context messages but throws while streaming (`agent.ts:228-233`, `agent.ts:970-985`).
- `_pendingToolCalls`, `_streamingMessage`, and `_errorMessage` are transient views for UIs. `_isStreaming` and the abort controller are cleared in `run()`'s `finally`.

## Security

- The loop performs no path, network, or secret handling itself; all of that belongs to tools, hooks, and the host.
- Provenance defaults to audit enabled, message provenance enabled, and tool arguments recorded only as a stable hash; `includeContextDiff` is off (`agent.ts:47-51`).
- Provider errors are stored as sanitized `ProviderErrorDetails` in `metadata.error`, never as raw provider payloads replayed into history.
- A throwing hook is contained: `beforeToolCall` failure blocks that call, `afterToolCall` failure keeps the original result, `transformContext`/`beforeModelCall` failure aborts the turn with an audit event (`agent.ts:389-410`, `agent.ts:800-832`, `agent.ts:909-925`).

## Errors

| Condition | Result |
| --- | --- |
| `run()` called while `_isStreaming` | throws `Agent is already processing a prompt`. |
| Provider throws before streaming | assistant error message pushed with `stopReason: 'error'` or `'aborted'`; `agent_end` emitted. |
| Provider returns `stopReason` `error`/`aborted` | `_errorMessage` set from `errorMessage` or sanitized details; turn ends. |
| Tool name not in map | blocked result `Unknown tool "<name>"`, `isError: true`, audit `tool_blocked`. |
| `prepareArguments` throws | blocked result `Argument validation failed: …`. |
| Tool `execute` throws | result text is the error message, `isError: true`; the turn continues. |
| Retryable transport error | up to 3 retries with exponential backoff plus jitter, capped by `maxRetryDelayMs`; `onRetry` may cancel or set the delay. |
| `maxTurns` reached | `_errorMessage` reports the turn limit; `agent_end` emitted. |

## Limitations

- One run per instance; concurrent prompts require separate `Agent` instances.
- Abort stops the loop between steps and signals tools, but queued tool executions already started are awaited before the loop observes the stop.
- The retry loop retries the same prepared context; it does not re-run context hooks, so `beforeModelCall` effects are not refreshed per attempt.
- Steering/follow-up queues are in memory only; `reset()` drops them.
- `AgentEventStream` buffers events when the consumer is slower than the producer; there is no backpressure or event coalescing.

## Tests

- `packages/agent/src/__tests__/agent.test.ts` — steering turns, follow-ups deferred until tool work finishes, queue clearing on reset.
- `packages/agent/src/__tests__/agent-edge-cases.test.ts` — maxTurns enforcement, non-retryable errors, abort during run, concurrent-run rejection.
- `packages/agent/src/__tests__/e2e.test.ts` — event sequencing, parallel and sequential tools, unknown tools, hook and listener failure isolation, provenance/audit behavior.
- `packages/agent/src/__tests__/agent-runtime-config.test.ts` — runtime reconfiguration, ephemeral context messages, retry without context re-preparation, provider failure metadata.

## Related

- `docs/features/providers.md` — stream contract and key resolution.
- `docs/features/tool-registry.md` — how `AgentTool`s are built and gated.
- `docs/features/hashline.md`, `docs/features/edit.md` — tools the loop dispatches.
- `docs/features/permissions.md`, `docs/features/context-compaction.md`.
