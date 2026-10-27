# Write tool

> `write` creates or fully overwrites a text file with the supplied content, creating parent directories, and returns a unified diff of the change.

## Source

- Entry: `packages/code/src/tools/write.ts` — the `writeTool` descriptor: Zod parameters, `execute`, display name.
- Collaborators:
  - `packages/code/src/tools/utils.ts` — `textResult`/`errorResult`.
  - `diff` package — `createTwoFilesPatch` with 3 lines of context.
  - `packages/code/src/tools/index.ts` — `spectraToolToAgentTool` and `wrapExecute` supply schema conversion, permissions, path safety, and the write guard.

## Registration / gating

- Registered as a built-in in `packages/code/src/tools/index.ts:38-54`; exported as `writeTool` from `write.ts`.
- Agent-visible only when the active definition allows `write`; the alias `Write` normalizes to `write`.
- Capabilities: `{ reads: false, writes: true }`, so the wrapper runs the write guard and records a successful write.
- Streaming: `{ arguments: true }` — the TUI may render the file content while the model is still emitting it.
- Permission profile: write. For a `path` argument the wrapper runs external-directory and path-safety checks plus the write guard; the named `write` permission is requested only when no path pattern is derived.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | yes | Absolute or relative path; relative paths resolve against `process.cwd()`. |
| `content` | `string` | yes | Complete new file content, written as UTF-8. |

No `offset`, `oldString`, or patch form exists; partial updates belong to `edit`.

## Outputs

- Tool result: one text block containing a unified diff from `createTwoFilesPatch`:
  - `--- a/<basename>` or `--- /dev/null` for a new or previously empty file,
  - `+++ b/<basename>`,
  - hunks with 3 lines of context.
- No `details` object and no `isError` on success. The diff is the only confirmation the model receives.
- No `[path#TAG]` header is produced, so the next hashline edit must be preceded by a `read`.
- Files: the target path is created if absent, truncated and rewritten if present; missing parent directories are created recursively.

## Flow

1. `resolve(process.cwd(), path)` computes the absolute target.
2. `existsSync(parentDir)` gates `mkdirSync(parentDir, { recursive: true })`.
3. Existing content is read synchronously as UTF-8 (`''` when the file does not exist).
4. `writeFileSync(resolved, content, 'utf-8')` replaces the file in one call.
5. The file's basename is used for both diff labels; `oldContent` empty selects the `/dev/null` label.
6. The patch text is returned via `textResult`.
7. In the wrapped path, the permission check, path safety check, and write guard run before `execute`, and write tracking runs after.

## State / persistence

- The file on disk is the only state. The tool keeps no snapshot, cache, or history; it does not register content with `ReadSnapshotStore`.
- Because no snapshot is recorded, a follow-up hashline patch for the same file requires a fresh `read` to obtain a current tag.
- An existing file's prior contents are not retained by this tool, and no session snapshot is recorded here.

## Security

- The tool itself performs no permission or path checks; those come from `wrapExecute` when the tool is built through `createAllToolsWithSecurity`.
- The wrapper derives patterns from the arguments, checks external directories and path safety, and applies the write guard because `capabilities.writes` is set; the raw tool performs no checks of its own.
- Symlinks are followed by the operating system; the tool does not resolve or re-check the final target after resolution.
- Content is written verbatim, including a BOM or CRLF sequences present in `content`.
- Constructing tools through `createAllToolsWithMcp`/`createAllToolsWithExtensions` yields an unwrapped `write` with no permission, path, or write-guard checks.

## Errors

| Condition | Result |
| --- | --- |
| Permission denied | `Permission denied: <message>` with `isError: true` (wrapper). |
| External path denied | `External file access denied: <message>` with `isError: true` (wrapper). |
| Blocked path | `Path safety blocked: <pattern>` with `isError: true` (wrapper). |
| Write guard failure | guard reason text with `isError: true` (wrapper). |
| Directory creation or write fails (`EACCES`, `EISDIR`, `ENOSPC`, …) | Native Node error propagates; the agent records the error message as an `isError` tool result. |
| Path resolves to an existing directory | Native `EISDIR` from `writeFileSync`. |

The tool has no custom error messages of its own.

## Limitations

- Every call is a full-file overwrite; there is no append, prepend, or conditional write.
- No no-op detection: writing identical content still rewrites the file and returns a diff with no hunks.
- Line endings and a BOM are not normalized; whatever bytes `content` contains are written.
- The diff is built in memory from the whole old and new content, so very large files allocate both strings and a full patch.
- The diff labels use the basename only, so two files with the same name in different directories produce identical headers.
- No snapshot/tag is recorded, which forces a read before the next hashline edit.
- `write` only handles text; binary payloads must go through another tool.

## Tests

- None. No test file references `write` or `writeTool`; fixtures in other suites are created with `node:fs` directly.

## Related

- `docs/features/read.md` — required before hashline edits.
- `docs/features/edit.md` — exact replacement and hashline patch application.
- `docs/features/hashline.md` — snapshot tags and freshness checks.
- `docs/features/permissions.md` — write guard and path rules.
