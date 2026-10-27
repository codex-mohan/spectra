# Search tools

> Exposes `glob` (file discovery) and `grep` (content search) to the agent, both backed by the external `ripgrep` binary.

## Source

- Entry: `packages/code/src/tools/glob.ts` — file listing via `rg --files`.
- Entry: `packages/code/src/tools/grep.ts` — content search via `rg -n --no-heading`.
- Collaborators:
  - `packages/code/src/tools/utils.ts:19-49` — `spawnRg` spawns `rg` / `rg.exe`, captures stdout/stderr, maps `ENOENT` to `RIPGREP_NOT_FOUND`.
  - `packages/code/src/tools/index.ts:33-51` — both tools are in `builtinTools`.
  - `packages/code/src/security/index.ts:416-495` — `extractToolPatterns` treats `args.path` as a path pattern.

## Registration / gating

- Registered by: `createBuiltinTools` (`tools/index.ts:44-45`), part of `builtinTools`.
- Enabled by: always; no config key disables either tool.
- Permission profile: read-only. Both declare `capabilities: { reads: true, writes: false }` (`glob.ts:7`, `grep.ts:7`).
- Both names are in `FILE_TOOL_NAMES` (`tools/index.ts:60`), so `wrapExecute` checks `external_directory` for the resolved `path`, enforces path safety, and records the read. When no `path` argument is supplied, no path pattern exists and the tool-name permission (`glob` / `grep`) is requested instead.

## Inputs

### `glob`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `pattern` | `string` | yes | Glob passed to `--glob`, e.g. `**/*.ts`, `src/**/*.css`. |
| `path` | `string` | no | Directory searched; resolved against `process.cwd()`. |
| `maxResults` | `number` | no | Result cap; defaults to 100 (`glob.ts:21`). |

### `grep`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `pattern` | `string` | yes | Regular expression, passed after `--` so leading dashes are literal. |
| `include` | `string` | no | Additional `--glob`, e.g. `*.ts`, `*.{ts,js}`. |
| `path` | `string` | no | Directory searched; resolved against `process.cwd()`. |
| `maxResults` | `number` | no | Defaults to 50 (`grep.ts:22`). Used both as ripgrep `--max-count` and as the truncation threshold. |

## Outputs

- `glob`: newline-separated paths from `rg --files`, capped at `maxResults`; when more lines exist, appends `\n... (<total> results, truncated at <limit>)`. No matches yields `No files matched the pattern.`
- `grep`: newline-separated `path:line:content` matches (`-n --no-heading`). No matches yields `No matches found.` When `lines.length >= limit`, appends `\n... (truncated at <limit> results)`.
- Neither tool returns structured details; both return a single text block via `textResult`.
- No events and no files written.

## Flow

1. Resolve `searchDir` from `path` or `process.cwd()` (`glob.ts:20`, `grep.ts:21`).
2. `glob` runs `rg --no-config --files --hidden --glob=!.git/* --glob=<pattern> <searchDir>` (`glob.ts:24-31`).
3. `grep` runs `rg -n --no-heading --hidden --no-config --glob=!.git/* --max-count=<limit> [--glob=<include>] -- <pattern> <searchDir>` (`grep.ts:25-40`).
4. `spawnRg` collects output with stdin ignored (`utils.ts:22-26`); exit code `0` is matches, `1` is no matches, anything above `1` is an error (`glob.ts:35`, `grep.ts:42`).
5. Output is split on newlines, sliced/joined, and returned as text.

## State / persistence

- Stateless. Nothing is cached; every call spawns a new `rg` process.

## Security

- No path sandbox inside the tools. `path` may point anywhere; the permission layer is responsible for external-directory approval and path-safety rejection.
- `--hidden` includes dotfiles, so results can surface `.env`-style files inside the searched tree. Only `.git/*` is excluded explicitly.
- ripgrep still honors `.gitignore`/`.ignore` files because no `--no-ignore` flag is passed; `--no-config` only disables ripgrep's own config file.
- The pattern is passed after `--` in `grep`, preventing it from being parsed as an option. `include` and `pattern` in `glob` are embedded in `--glob=` values.

## Errors

| Condition | Result |
| --- | --- |
| `rg` missing from `PATH` | `ripgrep (rg) not found. Install it: <upstream URL>` with `isError: true`. |
| Exit code above 1 | `ripgrep error: <stderr or "unknown error">`. |
| Empty stdout with exit code 1 | `No files matched the pattern.` / `No matches found.` |
| Other spawn failure | `Glob search failed: <message>` / `Search failed: <message>`. |

## Limitations

- Requires an external `ripgrep` installation; the binary is not bundled.
- `grep`'s `maxResults` maps to ripgrep's `--max-count`, which limits matches per file, not globally. A repository with many files can therefore return more than `maxResults` lines; the tool only appends a truncation note when the line count reaches the limit.
- No context lines, multiline matching, case-sensitivity, file-type, or replacement flags are exposed.
- `glob` accepts only one glob pattern and one search directory per call.
- Output ordering is ripgrep's traversal order; results are not sorted.
- A `permission.glob` or `permission.grep` deny rule is only evaluated when the call has no `path` argument. With a path inside the working directory, the file-tool branch performs no tool-name permission check (`tools/index.ts:90-99`).
- `grep` truncation is applied after the process exits, so very large match sets are still held in memory.

## Tests

- No dedicated tests for `glob.ts` or `grep.ts` exist in `packages/code/src/__tests__/`. Behavior above is read from source; runtime behavior with a real ripgrep binary is not covered by the suite.

## Related

- [tool-registry.md](tool-registry.md), [permissions.md](permissions.md), [read.md](read.md), [shell.md](shell.md)
