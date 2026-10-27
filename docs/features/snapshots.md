# Snapshots and revert

> A per-workdir shadow Git repository that captures the working tree before each agent turn so a reverted turn can restore exactly the files it touched.

## Source

- Entry: `packages/code/src/services/snapshot-manager.ts` — shadow repo setup, tree capture, change detection, restore, per-file revert, unified diff, prune.
- Collaborators:
  - `packages/code/src/tui/app.tsx:262` — creates one `SnapshotManager({ workdir: process.cwd() })` per app instance.
  - `packages/code/src/tui/hooks/use-chat-submit.ts:409-417` — captures `track()` before running an agent turn.
  - `packages/code/src/tui/hooks/use-chat-submit.ts:544-571` — computes `patch()` after the assistant turn, stores `{ hash, files }` in the assistant message's `metadata.patch`.
  - `packages/code/src/tui/hooks/use-revert.ts` — collects patches for removed messages, reverts files, and restores a pre-revert tree on redo.
  - `packages/code/src/tui/app.tsx:1418-1441` — message-controls actions (`Revert`, `Redo`) that call the hook.
  - `packages/code/src/tui/hooks/use-app-keyboard.ts:269-275` — `Ctrl+Y` triggers redo while a revert point exists.
  - `packages/code/src/tui/types.ts:27-31` — the `Patch` shape persisted with messages.

## Registration / gating

- Registered by: the TUI constructing `SnapshotManager` at startup. There is no registry and no CLI surface.
- Enabled by: always constructed; snapshotting only happens for TUI chat turns. The CLI (`session`, `db`, `doctor`) never creates one.
- Storage root: `join(getGlobalDataDir(), 'snapshots')`, where the global data dir honours `SPECTRA_HOME` and otherwise defaults to `~/.spectra` (`utils/paths.ts:5-17`).
- Permission profile: shell (spawns `git`) plus write to the global data directory and to tracked working-tree files during restore/revert.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `workdir` | `string` | no | Working tree to snapshot; defaults to `process.cwd()`. Hashed to choose the shadow repo. |
| `hash` | `string` | yes (patch/diff/restore) | Git tree hash previously returned by `track()` or `restore()` capture. |
| `patches` | `Patch[]` | yes (revert) | Ordered patches whose `files` are reverted to the `hash` that first saw each file. |

## Outputs

- `track()` → tree hash string.
- `patch(hash)` → `{ hash, files }` with absolute paths of changed files, filtered against the workspace `.gitignore`.
- `restore(hash)` → `void`; rewrites every path present in the tree.
- `revert(patches)` → `{ restored, deleted, errors }` counts and per-file error strings.
- `diff(hash)` → trimmed `git diff` text.
- Files: `<SPECTRA_HOME>/snapshots/<sha256(workdir)[0..12]>/` (bare-style Git dir), `<hash>.lock` in the same parent, and working-tree files rewritten by restore/revert.

## Flow

1. The constructor hashes the resolved `workdir` (SHA-256, first 12 hex characters) and derives `gitdir` and `lockPath` (`snapshot-manager.ts:65-71`).
2. `init()` optionally creates the shadow dir under the lock, then sets `core.autocrlf=false`, `core.longpaths=true`, `core.symlinks=true`, `core.fsmonitor=false` (`:128-156`).
3. Before an agent turn, `track()` acquires the lock, calls the private `add()`, and runs `git write-tree` (`:158-169`).
4. `add()` first calls `sync()`, which copies the workspace repository's `.git/info/exclude` into the shadow repo's `info/exclude`; with no workspace `.git`, the exclude file is written empty (`:330-348`).
5. `add()` then lists modified tracked files (`diff-files`) and untracked non-ignored files (`ls-files --others --exclude-standard`), removes newly ignored entries from the index, skips untracked files larger than 2 MB, and stages the rest with `git add --all --sparse --pathspec-from-file=-` (`:278-325`).
6. Ignore filtering shells out to the **workspace** repository: `git --git-dir <workdir>/.git check-ignore --no-index` (`:350-370`). Without a workspace `.git`, nothing is treated as ignored.
7. After the turn, `patch(preHash)` stages again and runs `git diff --cached --name-only <hash>`; a non-zero exit yields `{ hash, files: [] }` instead of throwing (`:171-192`).
8. The TUI stores that patch in the assistant message metadata; no patch is stored when the file list is empty (`use-chat-submit.ts:544-563`).
9. Revert collects patches from every message being removed, captures a fresh tree first (for redo), then calls `revert(patches)` (`use-revert.ts:47-96`).
10. `revert` keeps the **earliest** patch per file. If `git ls-tree <hash>` lists the file, it is restored with `git checkout <hash> -- <file>`; otherwise the file is unlinked (`:209-254`).
11. Redo calls `restore(preRevertHash)`, which runs `git read-tree <hash>` then `git checkout-index -a -f` (`:194-207`).
12. `diff(hash)` and `gc()` exist but no caller in `packages/code/src` invokes them; `gc` would run `git gc --prune=7.days` (`:256-276`).

## State / persistence

- The shadow repo persists across restarts under the global data dir, keyed by working directory, not by session.
- Message metadata in `sessions.db` holds the only per-turn tree hash and file list; deleting sessions loses the mapping but leaves snapshot objects behind.
- A file lock (`wx` open of `<workdirHash>.lock`) serializes snapshot operations; locks older than 60 s are unlinked as stale, and acquisition fails after 10 s of retrying (`:84-125`).
- Nothing prunes unreferenced trees automatically; `gc` is never scheduled.

## Security

- Snapshot objects are copies of working-tree files; anything not excluded by the workspace `.gitignore` (or everything, when the workspace has no `.git`) is copied into `SPECTRA_HOME`, including secrets in untracked files.
- The shadow repo lives outside the workspace, so snapshot objects are never committed to the user's repository.
- `patch()` and `diff()` pass `core.quotepath=false` and `core.longpaths=true` so non-ASCII and long paths survive; file paths are resolved against `workdir` before being returned.
- Revert writes and deletes working-tree files without any permission prompt; the caller decides whether to run it.
- Git is executed via `execFile` with an argument array (no shell), a 30 s timeout, and a 50 MB output buffer.

## Errors

| Condition | Result |
| --- | --- |
| `git write-tree` non-zero | `Error: git write-tree failed: <stderr>` |
| `git read-tree` non-zero | `Error: git read-tree failed for <hash>: <stderr>` |
| `git checkout-index` non-zero | `Error: git checkout-index failed: <stderr>` |
| Lock held for more than 10 s | `Error: Could not acquire snapshot lock after 10s` |
| `git diff --cached` non-zero in `patch` | `{ hash, files: [] }` — no throw |
| Per-file revert failure | Entry in `RevertResult.errors`; other files continue |
| `track()`/`patch()` failure in the TUI | Logged to console; the turn proceeds without a patch (`use-chat-submit.ts:412-416`, `:550-553`) |
| `revert()` failure in the TUI | Toast `File revert failed — messages were still reverted` (`use-revert.ts:84-86`) |
| `restore()` failure on redo | Toast `File restore failed — messages were still restored` (`use-revert.ts:130-134`) |

## Limitations

- The `init()` git-availability check cannot fire: `runGit` resolves with `code: 1` on spawn errors instead of rejecting, and the `git init`/`config` results are not inspected, so a missing `git` surfaces later as a `write-tree`/`read-tree` failure.
- `track`/`patch` stage the **entire** workdir, not just agent edits, so a patch can include unrelated user edits made during the turn.
- Untracked files above 2 MB are silently excluded from snapshots, so reverting cannot restore them.
- Workspace `.gitignore` handling depends on the workspace having a `.git` directory; otherwise only the copied exclude file applies.
- `restore()` rewrites files from the tree but does not delete files created after that tree; only `revert()` deletes files absent from the recorded tree.
- `diff` and `gc` are dead API surface with no caller, so snapshots grow without pruning.
- The lock is per workdir, not per process tree; two Spectra instances on the same workdir serialize every snapshot operation.
- There is no snapshot test; behavior is only exercised indirectly by turn/revert UI tests (none currently assert tree contents).

## Tests

- No dedicated test file exists under `packages/code/src/__tests__` for `SnapshotManager`; **Not verified** by automated tests. Grep for `SnapshotManager` finds only the service, TUI call sites, and type imports.

## Related

- [sessions.md](sessions.md) — patch metadata is persisted inside session messages.
- [tui-shell.md](tui-shell.md) — message controls and keyboard bindings that drive revert/redo.
- [permissions.md](permissions.md) — file writes performed by revert bypass the permission prompt.
- Setting key: `SPECTRA_HOME` (`config.md`).
