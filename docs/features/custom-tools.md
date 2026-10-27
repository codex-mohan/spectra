# Custom tools

> Loads user-authored TypeScript/JavaScript tool modules from `tools/` directories and exposes them to the agent as plain `AgentTool`s.

## Source

- Entry: `packages/code/src/integrations/custom-tools/loader.ts` — directory discovery, module import, export validation, tool construction.
- Entry: `packages/code/src/integrations/custom-tools/index.ts` — public exports.
- Collaborators:
  - `packages/code/src/tools/index.ts:237-263` — `createAllToolsWithExtensions` calls `loadCustomTools(process.cwd())` and appends the result to `all`.
  - `packages/code/src/utils/paths.ts:5-8,62-75` — `getGlobalConfigDir` (`$SPECTRA_HOME` or `~/.spectra`) and `discoverCompatibilityDirs` (global dir plus `.spectra`, `.opencode`, `.claude`, `.agents` in every ancestor directory).
  - `packages/agent/src/define-tool.ts` — `defineTool`, the `AgentTool` constructor used by `buildTool`.

## Registration / gating

- Loaded by: `createAllToolsWithExtensions` (`tools/index.ts:255`), which is used by the ACP server and exported from the package index.
- Not loaded by: `createAllToolsWithSecurity` (`tools/index.ts:295-313`), the path used by the TUI (`tui/hooks/use-agent.ts:128`). Custom tools therefore do not appear in interactive TUI sessions.
- Enabled by: presence of `.ts`/`.js` files in the discovered `tools/` directories. No config key, allowlist, or manifest gates loading.
- Permission profile: none. The resulting `AgentTool` carries no `capabilities`, and it is not passed through `wrapExecute`, so there is no permission prompt, path safety, read/write tracking, or doom-loop detection.

## Inputs

### Discovery

- For each directory returned by `discoverCompatibilityDirs(startDir)` plus the global config dir: `<dir>/tools`, if it exists and is a directory (`loader.ts:20-40`).
- Only immediate children ending in `.ts` or `.js` are collected; subdirectories are not walked (`loader.ts:42-57`). Duplicate absolute paths are de-duplicated.
- The order is the compatibility-directory order followed by the global directory; `loadCustomTools` concatenates tools in that order.

### Module format

| Export | Required shape | Tool name |
| --- | --- | --- |
| `export default { description, args?, execute }` | Only a callable `execute` is checked; `description` is passed through as-is and may be absent despite the declared interface. | `<fileBase>` (filename without `.ts`/`.js`). |
| `export const name = { description, args?, execute }` | `execute` must be a function and `description` must be a string. | `<fileBase>_<exportName>`. |

- `args` is `Record<string, z.ZodType>` converted with `z.object(def.args)`; an omitted or empty map becomes `z.object({})` (`loader.ts:83-86`).
- `execute` receives `(args, context)` where `context = { directory: process.cwd(), worktree: process.cwd(), signal }` (`loader.ts:88-93`). The `cwd` passed to `loadCustomTools` is not propagated into the context.
- Return values: a `string` becomes a single text block; an object with a `content` array is returned unchanged as a `ToolResult`; anything else is `JSON.stringify`-ed into a text block (`loader.ts:95-105`).
- Other exports are ignored. A default export with no `execute` is ignored; named exports missing either `execute` or a string `description` are ignored.

## Outputs

- `AgentTool` objects only. Each has `name`, `description`, `parameters`, and `execute`.
- No `displayName`, `label`, `promptGuidelines`, `capabilities`, or `streaming` metadata.
- Results are text blocks unless the module returns a `ToolResult` with a `content` array.
- No events, no files written by the loader.

## Flow

1. `loadCustomTools(startDir)` calls `discoverCustomToolFiles(startDir)` (`loader.ts:108-110`).
2. For each file it calls `loadCustomTool(file)`, which dynamically `import()`s the resolved path (`loader.ts:59-60`).
3. The default export is checked for a callable `execute`; named exports are checked for callable `execute` plus string `description` (`loader.ts:65-80`).
4. Each accepted export is converted by `buildTool` into an `AgentTool` whose `execute` calls the module function and normalizes the return value.
5. Per-file import or construction errors are caught in `loadCustomTools` and logged as `Failed to load custom tool "<file>": <message>`; other files continue loading (`loader.ts:108-122`).
6. The tools are appended after builtins, MCP tools, and (in the extensions path) before the final `all` array is returned.

## State / persistence

- No persisted state. Modules are imported once per `createAllToolsWithExtensions` call and are not cached or watched for changes.
- Module top-level state lives for the lifetime of the process; re-import behavior depends on the runtime's module cache.

## Security

- Loading a custom tool executes arbitrary code during agent construction, before any permission check and without a sandbox. The module runs with the user's full privileges and can import anything resolvable from its location.
- Discovery includes foreign compatibility directories (`.opencode`, `.claude`, `.agents`) in ancestor directories and the global directory, so assets placed by other tools are executed.
- No signature, allowlist, integrity check, or manifest validation exists.
- Because the loader bypasses `wrapExecute`, custom tools are invisible to the read tracker, write guard, doom-loop detector, permission rules, and MCP permission gate.
- Module output is returned to the model as tool text, so a tool can inject arbitrary instructions or content into the conversation.

## Errors

| Condition | Result |
| --- | --- |
| Import throws (syntax error, missing dependency) | File skipped; `Failed to load custom tool "<file>": <message>` on stderr. |
| Default export lacks `execute` | No tool produced; no message. |
| Named export lacks `execute` or string `description` | Export skipped silently. |
| `execute` throws at call time | Exception propagates through the agent tool call; no local conversion to `isError`. |
| `tools/` directory absent | No candidates; empty tool list. |

## Limitations

- No hot reload, file watching, or cache invalidation.
- No subdirectory support, barrel files, or nested tool packages.
- No manifest, version field, dependency declaration, or validation errors surfaced to the user beyond stderr.
- No way for a custom tool to declare read/write capabilities or opt into permission gating; it is always ungated or always absent.
- Not available in TUI sessions because that path does not call `loadCustomTools`.
- Name collisions with builtin, MCP, or other custom tools are not detected; the later tool in the array wins only if the consumer deduplicates, which the assembly code does not do.
- Context paths are always `process.cwd()`, ignoring the `startDir` argument and any session directory.
- Tools are rebuilt per assembly call, so module-level initialization repeats whenever the tool set is rebuilt.

## Tests

- `packages/code/src/__tests__/custom-tools.test.ts:8-11` — `discoverCustomToolFiles(process.cwd())` returns an array.
- `packages/code/src/__tests__/custom-tools.test.ts:13-40` — a default-export module in a temp directory loads as one tool named after the file, with description and parameters.
- `packages/code/src/__tests__/custom-tools.test.ts:42-71` — named exports become `<file>_<export>` tools.
- `packages/code/src/__tests__/custom-tools.test.ts:73-79` — `createAllToolsWithExtensions` merges builtins plus a `custom` array and returns at least the builtin count.
- No test covers import failures, invalid exports, discovery across compatibility directories, or execution result normalization.

## Related

- [tool-registry.md](tool-registry.md), [mcp-client.md](mcp-client.md), [acp-server.md](acp-server.md), [permissions.md](permissions.md), [config.md](config.md)
