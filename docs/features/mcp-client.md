# MCP client

> Connects Model Context Protocol servers over stdio or Streamable HTTP and exposes each server tool to the agent under a namespaced tool name.

## Source

- Entry: `packages/code/src/integrations/mcp/client.ts` — connection registry, transports, notifications, tool/resource listing, ref counting.
- Entry: `packages/code/src/tools/mcp-tool.ts` — JSON Schema to Zod conversion and `AgentTool` bridge.
- Collaborators:
  - `packages/code/src/integrations/mcp/import-config.ts` — parses `mcpServers` blocks, server maps, and arrays from external JSON.
  - `packages/code/src/integrations/mcp/presets.ts` — curated server launch recipes.
  - `packages/code/src/integrations/mcp/args.ts` — shell-like argument splitting/formatting for the add-server UI.
  - `packages/code/src/services/config.ts:62-71,175-243` — `McpConfig`, scope paths, and add/remove/toggle persistence.
  - `packages/code/src/tools/index.ts:205-263,270-292` — tool assembly and permission gating.

## Registration / gating

- Tool assembly:
  - `createAllToolsWithMcp` and `createAllToolsWithExtensions` append one `AgentTool` per tool of every connected server (`tools/index.ts:205-263`).
  - `createAllToolsWithSecurity` instead appends `createGatedMcpTools`, which asks for the `mcp` permission per tool name before execution (`tools/index.ts:270-292`). An unknown `mcp` permission falls back to `ask` (`security/permissions.ts:4-8`).
- Connection start:
  - TUI: no startup auto-connect. Servers are connected by the manage dialog (`tui/ui/mcp-manage-dialog.tsx:191-192`), by `spectra mcp connect <name>` (`commands/mcp.ts:126-160`), or through the CLI subcommand (`cli.ts:362`).
  - ACP: `session/new` calls `connectAllServers(config.mcp)` when the loaded config lists servers (`integrations/acp/server.ts:128-130`).
- `connectAllServers` skips entries with `enabled === false` and connects the rest in parallel (`client.ts:226-235`). A failed server is logged with `console.error` and does not abort the others.
- Tool permission: `mcp` (security-wrapped path only). Without the wrapper, MCP tools execute with no permission check.

## Inputs

### Server configuration (`McpConfig`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | yes | Server identity; also the tool namespace prefix. |
| `command` | `string` | one of command/url | Executable for the stdio transport (`McpConfig` stores args separately). |
| `args` | `string[]` | no | Arguments for `command`. |
| `url` | `string` | one of command/url | Endpoint for the Streamable HTTP transport. |
| `env` | `Record<string, string>` | no | Extra environment merged over `process.env` for stdio. |
| `headers` | `Record<string, string>` | no | HTTP headers for the URL transport. |
| `enabled` | `boolean` | no | `false` excludes the server from `connectAllServers`. |
| `timeout` | `number` | no | Declared timeout; accepted but not applied (see Limitations). |

- Scope storage: project `.spectra/spectra.json` or global `<SPECTRA_HOME>/spectra.json` (`services/config.ts:175-243`). `mcp` is a name-merged config field (`config.ts:90`).
- Import accepts `{ "mcpServers": {...} }`, `{ "servers": {...} }`, an array of named entries, or a bare map of server configs, with comment/trailing-comma tolerance. Names are slugged to `[A-Za-z0-9_-]`; entries without `command` or `url` are skipped and reported (`import-config.ts:63-123`).

### Tool arguments

- Converted from the MCP tool's `inputSchema`: string (with string `enum`), number, integer, boolean, array of unknown, object record, or unknown fallback. Properties not listed in `required` are optional (`mcp-tool.ts:10-72`).
- Nested array/object item schemas are not converted; they degrade to `unknown`.

## Outputs

- Tool names: `<sanitizedServer>_<sanitizedTool>`, where sanitization replaces every character outside `[a-zA-Z0-9_]` with `_` (`client.ts:242-248`). Example: `my-server` + `list-files` → `my_server_list_files`.
- Tool result: text blocks from the MCP result joined by newlines; `(no output)` when no text block exists; an MCP `isError` result becomes `isError: true`.
- Call failures become `MCP tool "<toolName>" failed: <message>`.
- MCP resources and resource templates are listed and stored on the connection, but they are not attached to any tool or prompt automatically.

## Flow

1. `connectServer` rejects a duplicate name, creates an MCP `Client` named `spectra-mcp-<server>`, and chooses a transport: stdio when `command` is non-empty (string split on spaces or array), otherwise Streamable HTTP when `url` is set; neither throws `must have either "command" or "url"` (`client.ts:51-94`).
2. `client.connect(transport)` completes the MCP handshake.
3. `listTools`, `listResources`, and `listResourceTemplates` are each attempted independently; failures are swallowed and yield empty lists (`client.ts:81-101`).
4. The connection is stored in a module-level `Map` with `refCount: 0`; notification handlers refresh tools on `ToolListChanged` and resources/templates on `ResourceListChanged` (`client.ts:114-147`).
5. Tool calls go through `callMcpTool(serverName, toolName, args)` and are converted to text by `extractResultText`.
6. `disconnectServer(name, force)` closes the client and removes the entry; it is a no-op while `refCount > 0` unless `force` is set (`client.ts:149-166`).
7. `shutdownAllServers` disconnects every live server with `force = true`.

## State / persistence

- Live connections, tool lists, resources, and ref counts live only in the process-level `Map` in `client.ts`; nothing reconnects after restart.
- Server definitions persist in the project or global `spectra.json` through `saveMcpServer`, `removeMcpServerConfig`, and `setMcpServerEnabled`.
- Imported configuration is not persisted until the caller saves it.

## Security

- Stdio servers execute arbitrary local commands with the inherited environment plus `env`; the client performs no validation or sandboxing.
- HTTP `headers` are stored in plain JSON config; bearer tokens placed there are readable by anyone with file access.
- Tool descriptions, schemas, and results are untrusted third-party content; the schema conversion is lossy and the description is passed to the model verbatim.
- Permission gating exists only in `createGatedMcpTools`; `createAllToolsWithMcp`/`createAllToolsWithExtensions` (used by ACP) expose MCP tools with no permission check.
- `sanitizeToolName` can collapse distinct names to the same identifier and does not prevent a leading digit or empty result; collisions silently shadow earlier tools in the assembled list.

## Errors

| Condition | Result |
| --- | --- |
| Duplicate `connectServer` name | `Server "<name>" is already connected`. |
| No `command` and no `url` | `MCP server "<name>" must have either "command" or "url"`. |
| `listTools`/`listResources` failure | Empty list; connection stays alive. |
| Operation on an unknown server | `Server "<name>" is not connected`. |
| Tool execution throws | `MCP tool "<name>" failed: <message>` with `isError: true`. |
| MCP result flagged `isError` | Returned as an error result with the concatenated text. |
| Any server fails during `connectAllServers` | Logged to stderr; other servers continue. |

## Limitations

- `timeout` is assigned in `connectServer` (`client.ts:58`) but never used for connection, listing, or calls; all operations use SDK defaults.
- `acquireServer`/`releaseServer`/`getServerRefCount` are not exported from `integrations/mcp/index.ts` and are unused elsewhere, so `disconnectServer` never blocks on a ref count in practice.
- Tools are snapshotted into `AgentTool` objects when the tool set is assembled; a `ToolListChanged` notification updates `server.tools` but does not add or remove tools from an agent that already holds the old set.
- No reconnection, health check, or backoff. A dead stdio child surfaces as a per-call error.
- Only stdio and Streamable HTTP are supported; there is no SSE transport, OAuth flow, or OAuth token refresh.
- Resources/templates are listed but never surfaced as tools, context, or `read` targets.
- Nested JSON Schema structures and non-string enums are not represented accurately in the generated Zod schema.
- HTTP headers are attached only to the URL transport; `env` applies only to stdio.

## Tests

- `packages/code/src/__tests__/mcp.test.ts:12-31` — sanitization and server/tool name formatting, including special characters.
- `packages/code/src/__tests__/mcp.test.ts:33-91` — scope-aware persistence: write to one scope only, replace in place, toggle, remove, and `findMcpScope`.
- `packages/code/src/__tests__/mcp-import.test.ts` — argument splitting/formatting round-trips, server-name slugging, `mcpServers`/bare-map/array parsing, env/headers/url/timeout/disabled mapping, comment and trailing-comma tolerance, skipped entries, failure reasons, and preset catalog shape.
- No test starts a real MCP server or exercises `connectServer`, notifications, or tool bridging.

## Related

- [config.md](config.md), [permissions.md](permissions.md), [tool-registry.md](tool-registry.md), [acp-server.md](acp-server.md), [custom-tools.md](custom-tools.md)
- Settings keys: `mcp[]`, `permission.mcp`, `security.ssrf`
