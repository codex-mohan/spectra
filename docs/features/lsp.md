# LSP

> Language-server code intelligence: diagnostics, navigation, symbols, renames, code actions, formatting, and raw requests.

## Source

- Tool: `packages/code/src/tools/lsp.ts` — `createLspTool()`, schema and dispatch.
- Actions: `packages/code/src/lsp/actions/{navigation,diagnostics,refactor,admin}.ts`.
- Client: `packages/code/src/lsp/client.ts` — spawn, initialize, document sync, diagnostics cache, pull diagnostics, shutdown.
- Transport: `packages/code/src/lsp/connection.ts` — Content-Length JSON-RPC, request cancellation, server-to-client requests.
- Manager: `packages/code/src/lsp/manager.ts` — lazy clients, root detection, workspace edits, formatting, workspace diagnostics.
- Servers/config: `packages/code/src/lsp/servers.ts` — defaults, filetype routing, root markers, settings merge.
- Edits: `packages/code/src/lsp/edits.ts` — WorkspaceEdit extraction, application, unified-diff previews.
- Positions: `packages/code/src/lsp/positions.ts` — 1-based tool lines, `name#N` symbol columns.
- Post-write: `packages/code/src/lsp/post-write.ts` — optional format-on-write and cached diagnostics.
- Registration: `packages/code/src/tools/index.ts` — `lsp` is part of `createBuiltinTools`; write/edit results run `applyLspAfterWrite`.

## Registration / gating

- Registered by `createBuiltinTools`; permission name `lsp` (default `ask`).
- Disabled with `tools.lsp.enabled: false`.
- Server selection is by file extension, then the nearest ancestor containing one of the server's root markers.
- Four clients maximum; the least recently used is disposed first. A crashed client is respawned on the next request.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | enum | yes | `diagnostics`, `definition`, `type_definition`, `implementation`, `references`, `hover`, `symbols`, `rename`, `rename_file`, `code_actions`, `format`, `status`, `reload`, `capabilities`, `request`. |
| `file` | string | per action | File path; `"*"` runs a workspace diagnostics sweep. |
| `line` | number | no | 1-based line. |
| `symbol` | string | no | Text on the line used to resolve the column; `name#N` selects the Nth occurrence. |
| `query` | string | no | Workspace symbol query, 1-based code-action index, or raw LSP method for `request`. |
| `new_name` | string | rename | New symbol name or file name. |
| `apply` | boolean | no | Apply edits instead of previewing (`rename`, `code_actions`). `format` applies by default. |
| `timeout` | number | no | Call deadline, 5–300 seconds. |
| `payload` | string | no | JSON payload for `request`. |

Config:

```jsonc
{
  "tools": {
    "lsp": {
      "enabled": true,
      "requestTimeout": 20000,
      "diagnosticsOnWrite": true,
      "formatOnWrite": false,
      "diagnostics": { "waitMs": 1500, "pull": true, "workspaceConcurrency": 4 },
      "settings": {},
      "servers": {
        "kotlin": { "command": "kotlin-lsp", "filetypes": [".kt"], "rootMarkers": ["build.gradle.kts"], "languageId": "kotlin" }
      }
    }
  }
}
```

## Outputs

- One text block: locations (`path:line:col`), hover text, symbol tree, formatted diagnostics, unified diffs for edit previews, or JSON for `capabilities`/`request`.
- `details` carries `{ action, server, success, count?, files?, source? }`.
- `write`/`edit` results gain a `Diagnostics:` section when cached diagnostics exist; formatting runs first when enabled.

## Flow

1. Resolve settings; reject when disabled.
2. Dispatch to an action module.
3. `ensureClient` picks the server by extension, finds the root, spawns and initializes one client per `server:root`, opens the document, and sends `initialized` plus `workspace/didChangeConfiguration`.
4. Navigation actions resolve the symbol column, issue the request, and format locations.
5. `diagnostics` prefers pull diagnostics (`textDocument/diagnostic`), falls back to pushed diagnostics with a bounded wait; `file: "*"` sweeps `rg --files` filtered by configured filetypes with bounded concurrency.
6. `rename`/`code_actions` request a WorkspaceEdit, validate every path, then preview or apply.
7. `rename_file` asks `workspace/willRenameFiles`, applies returned edits, moves the file, and notifies `workspace/didRenameFiles`.
8. `format` requests `textDocument/formatting` and applies the returned edits.
9. `reload` disposes every client.

## State / persistence

- No LSP state on disk. Clients, open documents, and diagnostics live in the shared `LspManager` for the process lifetime.
- Documents are opened once, refreshed with full-text `didChange` after every write, and saved with `didSave`.

## Security

- The tool is permission-gated (`lsp`, default `ask`).
- Workspace edits are rejected outside the workspace root and checked against `PathSafety` (blocked secrets paths).
- Raw `request` and `workspace/executeCommand` (through applied code actions) run only after approval.
- Server stderr is retained for error messages but never replayed as content.

## Errors

| Condition | Result |
| --- | --- |
| No server for the extension | `No LSP server configured for <ext>` |
| Binary missing or initialize failure | `<server> is not available (…). Install "<command>" or configure tools.lsp.servers.` |
| Request timeout | `<method> timed out after Ns` |
| Abort/cancel | `… aborted`, with `$/cancelRequest` sent |
| No locations / symbols / actions | Non-error text such as `No locations found.` |
| Edit outside workspace | `Refusing to edit outside the workspace: <path>` |
| Unknown action | `LSP <action>: Unknown action …` |

## Limitations

- Private server process per root; no cross-process broker or shared mux.
- Push and pull diagnostics for open files, but no workspace-wide pull diagnostics protocol (`workspace/diagnostic`) beyond the file sweep.
- No external linter adapters (Biome, SwiftLint); diagnostics come from the language server only.
- No semantic tokens, signature help, inlay hints, code lens, or call hierarchy.
- `formatOnWrite` defaults off; formatting may mutate files unexpectedly if enabled.
- `rename_file` relies on `workspace/willRenameFiles` for reference updates; servers without it move the file without rewriting imports.

## Tests

- `packages/code/src/__tests__/lsp.test.ts` — navigation, hover, symbols, pull diagnostics, rename preview/apply, code-action list/apply, formatting, status/reload, unsupported filetypes.
- `packages/code/src/__tests__/fixtures/fake-lsp.mjs` — framed fake server implementing initialize, document sync, navigation, rename, code actions, formatting, pull diagnostics, and shutdown.

## Related

- [tool-registry.md](tool-registry.md), [permissions.md](permissions.md), [config.md](config.md)
