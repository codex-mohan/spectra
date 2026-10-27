# Memory tool

> Reads and mutates charter-bounded memory files (`memory`, `user`, `project`) through the agent tool `memory`.

## Source

- Entry: `packages/code/src/tools/memory.ts` — argument schema, operation dispatch, result text.
- Entry: `packages/code/src/services/memory.ts` — file locations, char limits, entry delimiter, locking, atomic writes.
- Collaborators:
  - `packages/code/src/tools/index.ts:33-51` — `memoryTool` is in `builtinTools`.
  - `packages/code/src/tools/index.ts:62` — `memory` is in `SKIP_PERMISSION_CHECK`.
  - `packages/code/src/internal-urls/core-protocols.ts:92-112` — `memory://` resource handler for `read`.
  - `packages/code/src/tui/ui/memory-dialog.tsx` — TUI editor using the same service functions.
  - `packages/code/src/utils/paths.ts:5-16` — `$SPECTRA_HOME` (default `~/.spectra`) backs the global directory.

## Registration / gating

- Registered by: `createBuiltinTools` (`tools/index.ts:47`), exported through `builtinTools` and therefore present in every tool assembly path that starts from the builtins.
- Enabled by: always. `config.memory.enabled` and `config.memory.projectScope` exist (`services/config.ts:31,44-47`) but no code reads them; the service has no config dependency.
- Permission profile: none. `capabilities: { reads: true, writes: true }` (`tools/memory.ts:18`), but the name is skipped by `wrapExecute`, so no permission prompt and no path-safety check accompanies a write.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `target` | `memory \| user \| project` | yes | Memory scope. |
| `action` | `add \| replace \| remove \| read \| list` | yes | Operation. |
| `entry` | `string` | for `add`/`replace`/`remove` | Exact entry text; `replace`/`remove` match by exact equality after trimming. |
| `replacement` | `string` | for `replace` | New entry text. |

## Outputs

- `read`: `<target> (<used>/<limit> chars, <n> entries):` followed by entries separated by blank lines; `No entries in <target>.` when empty.
- `list`: `<target>: <n> entries, <used>/<limit> chars used.`
- `add`/`replace`/`remove`: a one-line success message including the new `used/limit`; failures use `errorResult` with the service message.
- No structured details, events, or streamed updates.
- Files written: `MEMORY.md`, `USER.md` (global), `PROJECT.md` (project) — see state below.

## Flow

1. Dispatch on `action` in `packages/code/src/tools/memory.ts:42-84`.
2. `read`/`list` call `readEntries` and `getMemoryUsage`, which read the target file if it exists.
3. `add` rejects missing `entry`, then `addEntry` trims the text, rejects an exact duplicate, appends, and checks the char limit before writing.
4. `replace` requires both `entry` and `replacement`; it finds the exact existing entry and swaps it, rejecting the write if the limit would be exceeded.
5. `remove` requires `entry`, finds it by exact match, and rewrites the file without it.
6. Every write goes through `writeEntries`: char-limit check, `${path}.lock` acquisition (10 attempts, 50 ms spin), a drift check, then write to `${path}.tmp` and `renameSync` over the target (`services/memory.ts:49-102`).
7. Entries are stored as one text file, joined by a line containing `§` (`DELIMITER`, `services/memory.ts:5,40,89`).

## State / persistence

- `memory` → `<SPECTRA_HOME>/memory/MEMORY.md`, limit 2200 chars.
- `user` → `<SPECTRA_HOME>/memory/USER.md`, limit 1375 chars.
- `project` → `<cwd>/.spectra/memory/PROJECT.md`, limit 2200 chars.
- `<SPECTRA_HOME>` is `$SPECTRA_HOME` when set, otherwise `~/.spectra` (`utils/paths.ts:5-16`).
- Entries are the unit of storage; reading splits on `\n§\n`, trims, and drops empties.
- Files persist across sessions and processes; no database or index is involved.
- The tool description claims memory is loaded into the agent context at session start. In this repository, context composition (`services/context.ts`) does not read these files; only the `memory` tool, the TUI memory dialog, and `read` with `memory://<scope>` read them. No automatic session-start injection was found in `packages/code/src` or `packages/agent/src`.

## Security

- Memory writes bypass the permission layer, including writes to `PROJECT.md` outside the working-directory approval flow and to the global home directory. This is intentional per `SKIP_PERMISSION_CHECK` but means the agent can persist arbitrary text without user confirmation.
- No secrets handling: entries are plain text and can be read by any later session with the tool or `read memory://...`.
- The lock is advisory and process-local-ish: it is a `wx` file with a busy-wait retry, and a crashed process can leave a stale `.lock` that blocks writes until removed manually.
- `driftCheck` reads the file immediately before comparing it to that same snapshot (`services/memory.ts:77-85,95-97`), so it cannot detect an external modification made before the write begins; the only observable protection is the atomic rename.
- Char limits count JavaScript string length (UTF-16 code units), not bytes.
- A write attempted while the file does not yet exist can throw from the "currently N" branch of `addEntry` (`services/memory.ts:113-116`), which reads the file for the error message.

## Errors

| Condition | Result |
| --- | --- |
| `entry` missing on add/replace/remove | `Missing required parameter: entry` (or `entry (the entry to replace)`). |
| `replacement` missing on replace | `Missing required parameter: replacement`. |
| Duplicate add | `Entry already exists in <label>.` |
| Replace/remove target absent | `Entry not found in <label>.` |
| Char limit exceeded | `<label> would exceed char limit (<used>/<limit>...). Remove or shorten existing entries first.` |
| Lock not acquired | `Could not acquire lock: <path>` thrown out of the tool. |

## Limitations

- Exact-string matching means a whitespace or wording change makes `replace`/`remove` fail.
- No entry-level ids, timestamps, ordering controls, search, or size reporting beyond `list`.
- `config.memory.enabled`/`projectScope` are inert.
- No session-start context injection despite the tool description.
- Concurrent writers serialize only through the lock file; there is no compare-and-swap with the previous content.
- ACP sessions include this tool because they build from `createBuiltinTools`, but without the permission wrapper.

## Tests

- No tests in `packages/code/src/__tests__/` cover `tools/memory.ts` or `services/memory.ts`. Claims above are from source; locking and drift behavior are not exercised by the suite.

## Related

- [read.md](read.md), [sessions.md](sessions.md), [permissions.md](permissions.md), [config.md](config.md)
- Settings keys: `memory.enabled`, `memory.projectScope` (declared, unused)
