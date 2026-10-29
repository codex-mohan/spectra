# LSP

> Language-server code intelligence plus automatic post-write formatting, diagnostics, and mid-conversation diagnostic injection.

## Source

- Tool: `packages/code/src/tools/lsp.ts` — schema, dispatch, read/write action classes.
- Actions: `packages/code/src/lsp/actions/{navigation,diagnostics,refactor,admin}.ts`.
- Client: `packages/code/src/lsp/client.ts` — lifecycle, document sync, push/pull diagnostics, progress, registrations.
- Transport: `packages/code/src/lsp/connection.ts` — JSON-RPC over child stdio or a socket.
- Manager: `packages/code/src/lsp/manager.ts` — lazy clients, LRU cap, workspace edits, formatting, diagnostics.
- Mux: `packages/code/src/lsp/mux/{protocol,client,broker,daemon}.ts` — per-project daemon sharing servers across processes.
- Writethrough: `packages/code/src/lsp/writethrough.ts` — format → write → watched-file notify → inline/deferred diagnostics.
- Ledger: `packages/code/src/lsp/diagnostics-ledger.ts` — per-file dedupe and summary.
- Inbox: `packages/code/src/services/diagnostics-inbox.ts` — late diagnostics delivery to the active session.
- Linters: `packages/code/src/lsp/linters.ts` — Biome CLI diagnostics merged with LSP results.
- Servers/config: `packages/code/src/lsp/servers.ts` — 14 language defaults, filetype/root routing, settings merge.
- Edits: `packages/code/src/lsp/edits.ts` — WorkspaceEdit text edits, file operations, diffs.
- Positions: `packages/code/src/lsp/positions.ts` — 1-based lines, `name#N` symbol columns.
- Post-write: `packages/code/src/lsp/post-write.ts`; registration in `packages/code/src/tools/index.ts`.

## Registration / gating

- Registered by `createBuiltinTools`.
- Permissions: read actions use `lsp`; write actions (`rename`, `rename_file`, `code_actions`, `format`, `reload`, `request`) use `lsp_write`. Both default to `ask`.
- Disabled with `tools.lsp.enabled: false`.
- Shared servers are on by default (`tools.lsp.shared`), falling back to a private process when the daemon or its entry is unavailable.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | enum | yes | `diagnostics`, `definition`, `type_definition`, `implementation`, `references`, `hover`, `symbols`, `rename`, `rename_file`, `code_actions`, `format`, `status`, `reload`, `capabilities`, `request`. |
| `file` | string | per action | File path; `"*"` runs a workspace diagnostics sweep. |
| `line` | number | no | 1-based line. |
| `symbol` | string | no | Text on the line; `name#N` selects the Nth occurrence. |
| `query` | string | no | Workspace symbol query, 1-based code-action index, or raw LSP method. |
| `new_name` | string | rename | New symbol or file name. |
| `apply` | boolean | no | Apply instead of preview (`rename`, `code_actions`). `format` applies by default. |
| `timeout` | number | no | Call deadline, 5–300 seconds. |
| `payload` | string | no | JSON payload for `request`. |

```jsonc
{
  "tools": {
    "lsp": {
      "enabled": true,
      "shared": true,
      "requestTimeout": 20000,
      "diagnosticsOnWrite": true,
      "formatOnWrite": false,
      "diagnostics": { "waitMs": 1500, "pull": true, "workspaceConcurrency": 4 },
      "settings": {},
      "linters": { "biome": { "enabled": true, "command": "biome" } },
      "servers": {
        "kotlin": { "command": "kotlin-lsp", "filetypes": [".kt"], "rootMarkers": ["build.gradle.kts"], "languageId": "kotlin" }
      }
    }
  }
}
```

## Outputs

- Text: locations (`path:line:col`), hover, symbol trees, diagnostics, unified diffs, or JSON.
- `details`: `{ action, server, success, count?, files?, source? }`.
- Write/edit results include inline diagnostics; late results arrive as a compact `LSP` transcript note and as a message the model sees on its next turn.

## Flow

1. Resolve settings and return early when disabled.
2. Read actions request the server directly; write actions are gated by `lsp_write`.
3. Clients are lazy, keyed by `server:root`, shared through the mux daemon when available; the least recently used of four is disposed first.
4. `diagnostics` prefers pull, then pushed diagnostics; `file:"*"` uses `workspace/diagnostic` when supported and otherwise sweeps configured files with bounded concurrency.
5. `rename` calls `prepareRename`, then previews or applies a WorkspaceEdit (text edits plus file operations). `code_actions` resolves actions when needed.
6. `format` requests formatting and applies the result.
7. Every successful `write`/`edit` runs the writethrough: optional format, document refresh/save, `workspace/didChangeWatchedFiles`, then diagnostics with a 500 ms inline budget.
8. Diagnostics that miss the budget are deduped per file and delivered to the inbox; the app appends them to the transcript and steers (streaming) or appends to agent history (idle).
9. Biome diagnostics are collected per file and merged with server diagnostics before dedupe.

## Mux

- One daemon per project listens on `SPECTRA_LSP_MUX_SOCKET`.
- Each client link binds to a server key (`command`, `args`, `cwd`); one server process serves every link.
- Request ids are remapped per link; notifications are broadcast; server requests are forwarded to the first link.
- `initialize` results are cached; a released server lingers 5 minutes, the daemon exits after 15 minutes idle.
- `tools.lsp.shared: false` or `SPECTRA_LSP_MUX_DISABLE=1` forces private servers.

## State / persistence

- In-process clients/documents/diagnostics plus the mux daemon's server registry. No LSP state on disk.
- Deferred diagnostics live in memory and are persisted as user messages when injected.

## Security

- Read/write action classes map to separate permissions.
- Edits and file operations are rejected outside the workspace root and checked by `PathSafety`.
- Raw `request`, `workspace/executeCommand`, and `reload` require `lsp_write`.
- Server stderr is retained for errors only.

## Errors

| Condition | Result |
| --- | --- |
| No server for extension | `No LSP server configured for <ext>` |
| Binary/initialize failure | `<server> is not available (…). Install "<command>" or configure tools.lsp.servers.` |
| Timeout | `<method> timed out after Ns` |
| Rename refused | `the server refuses to rename this symbol` |
| Edit outside workspace | `Refusing to edit outside the workspace: <path>` |
| Unknown action | `LSP <action>: Unknown action …` |

## Limitations

- Multi-root workspaces are not supported; one root per client.
- Document sync is full-text `didChange`, not incremental ranges.
- Position encoding is advertised as UTF-16 only; servers that force UTF-8 are not converted.
- Workspace pull diagnostics are used when advertised, but partial-result streaming is not implemented.
- Semantic tokens, signature help, inlay hints, code lens, call hierarchy, and document links are editor features and are not surfaced in the TUI.
- `rename_file` relies on `workspace/willRenameFiles` for reference updates; servers without it move the file without rewriting imports.
- Linter adapters currently cover Biome only; SwiftLint is not wired.

## Tests

- `packages/code/src/__tests__/lsp.test.ts` — navigation, hover, symbols, pull diagnostics, rename preview/apply, code actions, formatting, status/reload, writethrough inline/deferred/dedupe, Biome merge, mux server sharing, unsupported filetypes.
- `packages/code/src/__tests__/fixtures/fake-lsp.mjs` — framed fake server with diagnostics, navigation, rename, code actions, formatting, workspace pull, and shutdown.
- `packages/code/src/__tests__/fixtures/fake-biome.mjs` — JSON reporter fixture.

## Related

- [tool-registry.md](tool-registry.md), [permissions.md](permissions.md), [config.md](config.md)
