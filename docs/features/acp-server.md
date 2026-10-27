# ACP server

> Runs Spectra as a JSON-RPC 2.0 agent server over stdio for Agent Client Protocol clients, started with `spectra acp`.

## Source

- Entry: `packages/code/src/integrations/acp/server.ts` — `ACPAdapter`, JSON-RPC dispatch, session creation, prompt streaming.
- Entry: `packages/code/src/cli.ts:470-479` — `acp` CLI command instantiates the adapter and calls `start()`.
- Collaborators:
  - `packages/code/src/integrations/acp/index.ts` — re-exports `ACPAdapter`.
  - `packages/code/src/agents/registry.ts` — `AgentRegistry.setConfig` updated for each session.
  - `packages/code/src/agents/index.ts` — agent catalog and `filterToolsByAgent`.
  - `packages/code/src/services/context.ts:16-18` — `buildAcpSystemPrompt` wraps `loadContext`.
  - `packages/code/src/services/auth-store.ts`, `services/model-service.ts` — credentials and provider headers.
  - `packages/code/src/integrations/mcp/client.ts` — `connectAllServers` on session creation.

## Registration / gating

- Registered by: the yargs command `acp` (`cli.ts:470-479`); it is a process mode, not a tool.
- Enabled by: invoking `spectra acp`. No config key gates it.
- Permission profile: none. Sessions use `createAllToolsWithExtensions` (`server.ts:133`), which does not wrap tools with a `SecurityManager`; there is no permission dialog, no path safety, and no SSRF guard in this mode.
- Transport: newline-delimited JSON on `stdin`/`stdout`; a startup line is written to `stderr` (`server.ts:58`). stdout is reserved for protocol messages.

## Inputs

### JSON-RPC methods

| Method | Params | Result |
| --- | --- | --- |
| `initialize` | none | `{ protocolVersion: "0.1.0", serverInfo: { name: "Spectra Code", version }, capabilities: {} }`. |
| `session/new` | `{ sessionId?, cwd? }` | `{ sessionId, serverInfo }`; creates an `Agent`. |
| `session/prompt` | `{ sessionId, message: { role, content } }` | `{ status: "accepted" }`, then streamed `session/update` notifications. |
| `session/cancel` | `{ sessionId }` | `{ status: "cancelled" }`; aborts and deletes the session if present. |
| `shutdown` | none | Process exits with code 0 and no response. |

- `session/new` config resolution: `config.agent || "build"`; `config.model || "anthropic/claude-sonnet-4-20250514"` split on the first `/` into provider and model id; API key lookup through the auth store; headers through `resolveProviderHeaders`. Missing agent definition returns `Unknown agent: <name>` with code `-32603` (error code delivered in-band as a JSON-RPC error).
- `session/prompt` accepts `message.content` as a string, or anything else via `JSON.stringify`.

## Outputs

- Responses are written as single-line JSON with the request `id`.
- Notifications use method `session/update` with `{ sessionId, status?, content?, toolCall?, message?, error? }`:
  - `status`: `running`, `thinking`, `done`, `error`.
  - `content`: `{ type: "text" | "thought" | "toolcall", text: <delta> }` for assistant text, reasoning, and partial tool-call arguments (`server.ts:211-231`).
  - `toolCall`: `{ id, name, args?, result?, status: "running" | "completed" | "error" }` on tool execution start/end (`server.ts:233-251`).
  - `message`: the last assistant message `{ role, content, stopReason }` on `agent_end` (`server.ts:253-266`).
- Errors use JSON-RPC error objects with codes `-32601` (method not found), `-32602` (session not found), `-32603` (internal/session creation failure).

## Flow

1. `start()` reads stdin line by line, parses each line as a JSON-RPC request, and dispatches it; malformed JSON is ignored without a response (`server.ts:57-79`).
2. `initialize` reports protocol version `0.1.0`, server name `Spectra Code`, `APP_VERSION`, and empty capabilities (`server.ts:98-104`).
3. `session/new` calls `initProviders()`, loads config for the requested `cwd`, loads the agent catalog, merges tools from `createAllToolsWithExtensions({ includeSkillProposal: false })` and filters them by agent, builds the system prompt, reads credentials, constructs the model, connects configured MCP servers, and creates `new Agent({ ..., maxTurns: def.maxTurns ?? 10 })` (`server.ts:106-170`).
4. `session/prompt` looks up the session, responds `accepted`, notifies `running`, then iterates `agent.run({ role: "user", content, timestamp })`, translating every `AgentEvent` into `session/update` notifications and stopping at `agent_end` (`server.ts:174-209`).
5. `session/cancel` aborts the agent and removes the session from the in-memory map (`server.ts:274-283`).
6. When stdin closes, all sessions are aborted, the map is cleared, and the process exits 0 (`server.ts:74-78`).

## State / persistence

- Sessions are an in-memory `Map<string, AcpSession>` (`server.ts:55`); nothing is written to the session database and there is no `session/load` or resume.
- Session ids are client-supplied or `crypto.randomUUID()`; they are not validated for uniqueness beyond `Map.set`.
- `AgentRegistry.setConfig` is process-global and overwritten by each `session/new`.
- MCP connections are process-global and shared across sessions.

## Security

- No permission checks: tools were built without a `SecurityManager`, so filesystem, shell, web, and MCP operations execute without approval and without path-safety or SSRF enforcement.
- The client declares no capabilities and is never asked to perform filesystem or terminal operations; all tool execution is server-side.
- Credentials are read from the local auth store and model headers are constructed server-side; they are not sent to the ACP client.
- Trust boundary is the stdio pipe: any process able to write to stdin can create sessions and run tools with the user's privileges.
- `shutdownAllServers` is imported but never called (`server.ts:10`), so MCP child processes are not explicitly closed before exit.

## Errors

| Condition | Result |
| --- | --- |
| Unknown method | Error `-32601`, `Method not found: <method>`. |
| Prompt for unknown/cancelled session | Error `-32602`, `Session not found: <id>`. |
| Unknown configured agent | Error `-32603`, `Unknown agent: <name>`. |
| Session setup exception (providers, config, auth) | Error `-32603` with the exception message. |
| Agent stream throws while streaming | `session/update` with `status: "error"`; while `agent.isStreaming`, the error notification is suppressed. |
| Malformed JSON line | Ignored; no response. |

## Limitations

- Protocol support is a small subset of ACP: only `initialize`, `session/new`, `session/prompt`, `session/cancel`, and `shutdown`. No `session/load`, `session/list`, permission requests, or client capability negotiation.
- `capabilities` is always `{}`, so clients cannot discover features.
- Requests without an `id` are handled with non-null assertions (`req.id!`); a notification-shaped request can emit a response with `id: undefined`.
- `shutdown` exits without replying, so a client waiting for a response sees EOF.
- No concurrency control per session; a second prompt while one runs is passed straight to the agent.
- No session persistence, history export, or token accounting beyond what the agent events carry.
- No permission gating, no auth, and no sandbox for tool execution.
- MCP servers are connected per `session/new` and never shut down; the shared registry rejects a second `connectServer` for the same name, which surfaces as a logged failure.
- `includeSkillProposal: false` is hard-coded because ACP has no review surface for skill proposals.

## Tests

- `packages/code/src/__tests__/acp.test.ts:110-146` — spawns `bun src/cli.ts acp`, proves `session/new` returns a string session id and honors a client-supplied `sessionId`, and reports server name `Spectra Code`.
- `packages/code/src/__tests__/acp.test.ts:66-108` — proves ACP and TUI share the same `Agent` class, `loadConfig`, `readAll`, and builtin agent definitions (`build`, `debug`, `explore`, `general`, `plan`, `title`).
- `packages/code/src/__tests__/acp.test.ts:149-214` — `initialize` shape (`0.1.0`, `Spectra Code`, version, `{}` capabilities), `-32601` for unknown methods, malformed JSON ignored, `session/cancel` returns `cancelled` for a nonexistent session.
- `packages/code/src/__tests__/context-entry-points.test.ts:75-86` — ACP system prompt contains project instructions but not the agent role prompt; memory is not injected.
- No test drives `session/prompt` end-to-end with a live model or tool calls.

## Related

- [mcp-client.md](mcp-client.md), [agent-loop.md](agent-loop.md), [providers.md](providers.md), [sessions.md](sessions.md), [config.md](config.md)
