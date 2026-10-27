# Tool registry

> Built-in tools are declared as Zod-backed `SpectraTool` descriptors, converted to `AgentTool`s, wrapped with permission, path, write-guard, SSRF, and loop-detection checks, then filtered per agent definition before the agent loop ever sees them.

## Source

- Entry: `packages/code/src/tools/index.ts` — `builtinTools`, `spectraToolToAgentTool`, `wrapExecute`, MCP gating, session tool assembly, streaming-display lookup.
- Descriptor type: `packages/code/src/tools/types.ts` — `SpectraTool<TArgs>`, `ToolContext`, `ToolStreamingDisplay`.
- Conversion: `packages/agent/src/define-tool.ts` — `defineTool()` turns a Zod schema into an `AgentTool` with JSON Schema parameters and `prepareArguments` validation.
- Agent filtering: `packages/code/src/agents/index.ts` (`filterToolsByAgent`) and `packages/code/src/agents/tool-filter.ts` (alias normalization, allow/deny rules).
- Capabilities: `packages/code/src/security/types.ts` — `ToolCapabilities` (`reads`, `writes`).
- Collaborators: `packages/code/src/security/index.ts` (permissions, path safety, write guard, doom loop, SSRF), `packages/code/src/tools/mcp-tool.ts`, `packages/code/src/integrations/custom-tools/index.ts`.

## Registration / gating

- `createBuiltinTools()` builds the module-level `builtinTools` array at import: `shell`, `read`, `write`, `edit`, `grep`, `glob`, `web_fetch`, `memory`, `propose_skill`, `ask` (`tools/index.ts:38-54`). `read` and `edit` share one `ReadSnapshotStore` so read-issued tags resolve in edits.
- `createAllToolsWithSecurity()` builds the per-session list: built-ins wrapped by `wrapExecute`, plus `todo`, an optional `task` tool when an `AgentRegistryConfig` exists, and gated MCP tools (`tools/index.ts:291-305`).
- `createAllToolsWithExtensions()` adds MCP and custom tools without the security wrapper, for hosts that gate elsewhere.
- Skill tools (`find_skills`, `skill`) come from `discoverAndCreateSkillTools()`.
- Enabled per agent by `AgentDefinition.tools` (allowlist) and `disallowedTools` (denylist); aliases such as `Read`, `Bash`, `find`, `ls`, `webfetch` are normalized first (`tool-filter.ts:5-40`).
- Permission profile: read, write, or shell depending on the descriptor plus the host ruleset; see `docs/features/permissions.md`.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | yes | Unique registry key and model-visible tool name. |
| `description` | `string` | yes | Model-facing behavior contract. |
| `parameters` | `z.ZodType` | yes | Converted to OpenAPI-style JSON Schema for the provider. |
| `capabilities` | `ToolCapabilities` | no | `{ reads, writes }`; defaults to both `false` in the wrapper. |
| `promptGuidelines` | `string[]` | no | Extra guidance passed through to the agent tool. |
| `displayName` | `string \| (args, result) => string` | no | UI label; string form becomes the agent tool `label`. |
| `streaming` | `ToolStreamingDisplay` | no | Whether UIs may render partial arguments and/or partial output. |
| `execute` | `(args, ctx) => Promise<ToolResult>` | yes | Receives `toolCallId`, abort `signal`, and `onUpdate`. |

## Outputs

- `AgentTool` with `name`, `description`, JSON Schema `parameters`, optional `label`/`promptGuidelines`, and `prepareArguments` that validates with the original Zod schema.
- Tool execution returns `ToolResult`: `content` (`text`/`image` blocks), optional typed `details`, optional `isError`.
- Permission, path-safety, write-guard, SSRF, and doom-loop rejections return `isError: true` with a text explanation; they do not throw.
- `getToolStreamingDisplay(name)` exposes the partial-render flags to the TUI; `getToolStats()` counts built-in and MCP tools (excluding custom tools).
- Files: mutation is expected only from tools that declare `capabilities.writes`; the wrapper uses that flag for the write guard and write tracking, but nothing prevents an undeclared tool from writing.

## Flow

1. `spectraToolToAgentTool(tool, security)` calls `defineTool()`; without a `SecurityManager` the raw `execute` is used unchanged (`tools/index.ts:191-208`).
2. At call time the wrapper first records the call with the doom-loop detector and returns its message when the loop says stop.
3. `security.extractToolPatterns(name, args)` derives tool and path patterns from the arguments.
4. Tools in `SKIP_PERMISSION_CHECK` (`todo`, `memory`, `propose_skill`, `task`, `ask`, `web_fetch`) bypass the permission prompt because they touch no filesystem, shell, network, or external resource (`tools/index.ts:60`).
5. File tools (`read`, `write`, `edit`, `grep`, `glob`, `bash`, `shell`) first request `external_directory` for each external path, then request the tool permission when no path pattern exists.
6. Every path pattern is checked by `security.checkPath()`; write-capable tools then pass the write guard (`tracker.checkWrite`).
7. `web_fetch` URLs pass through the SSRF guard before execution.
8. The underlying tool executes; the result is recorded with the doom loop, and `edit`/`patch` successes and failures feed the patch-spiral detector.
9. Read/write tracking records `capabilities.reads` paths and successful `capabilities.writes` paths.
10. MCP tools bypass `wrapExecute`, so `createGatedMcpTools()` wraps them with an `mcp` permission check before delegation (`tools/index.ts:257-287`).

## State / persistence

- `builtinTools`, `builtinToolByName` are module-level; the snapshot store, read tracker, and doom-loop detector are per security/session instance.
- The permission ruleset and pending approval requests live in the `SecurityManager`; approvals answered with "always" append rules for the session.
- No tool registry state is written to disk; session stores are injected only where a tool needs them (`todo`, `read` artifact/session resolution).

## Security

- Path safety and external-directory rules are enforced before execution, not by each tool.
- Capabilities default to `{ reads: false, writes: false }`; a tool that declares neither skips both the write guard and read/write tracking, so capabilities are security-relevant metadata.
- MCP tools receive only the `mcp` permission check; they are not path-checked, write-guarded, or SSRF-checked.
- `createAllToolsWithMcp()`/`createAllToolsWithExtensions()` produce unwrapped tools; callers must supply their own gating.
- `SKIP_PERMISSION_CHECK` is a name-based allowlist; a new tool reusing one of those names bypasses the prompt.

## Errors

| Condition | Result |
| --- | --- |
| Zod validation fails in `prepareArguments` | `Invalid arguments for tool "<name>": …`; the agent records a blocked call. |
| Permission denied | `Permission denied: <message>`, `isError: true`. |
| External path denied | `External file access denied: <message>`, `isError: true`. |
| Path safety rejection | `Path safety blocked: <pattern>`, `isError: true`. |
| Write guard rejection | guard reason text, `isError: true`. |
| Doom-loop stop | loop message, `isError: true`. |
| SSRF rejection | `SSRF guard: <reason>`, `isError: true`. |
| Patch-spiral stop | spiral message, `isError: true`. |

## Limitations

- Agent filtering is name-based; an MCP or custom tool that normalizes to a known alias can be allowed or denied by an unrelated definition entry.
- `filterToolsByDefinition` treats an empty `tools` array as "no allowlist" rather than "no tools".
- Permission checks run once per call, before execution; the tools themselves do not re-check mid-run.
- An unanswered permission request is rejected after a fixed 120-second timeout (`security/index.ts:339-344`).
- Custom tools loaded by `createAllToolsWithExtensions()` are not wrapped with permission, write-guard, or tracking checks.
- `getToolStats()` omits custom tools and `todo`/`task`, so its total is not the full session tool count.

## Tests

- `packages/code/src/__tests__/permissions.test.ts` — permission evaluation, denial paths, and write/path guards.
- `packages/code/src/__tests__/agents-catalog.test.ts` — agent definitions and tool filtering inputs.
- `packages/code/src/__tests__/live-tool-streaming.test.ts` — streaming display metadata usage.
- `packages/agent/src/__tests__/agent.test.ts` (`defineTool` block) — Zod schema conversion and argument validation.

## Related

- `docs/features/permissions.md` — ruleset semantics and approval flow.
- `docs/features/read.md`, `docs/features/write.md`, `docs/features/edit.md`, `docs/features/hashline.md` — the file tools built here.
- `docs/features/custom-tools.md`, `docs/features/mcp-client.md`, `docs/features/subagents.md` — alternate tool sources.
