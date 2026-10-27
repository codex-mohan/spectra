# Edit tool

> `edit` applies either an exact, whitespace-tolerant find-and-replace or a hashline patch whose sections carry `[path#TAG]` headers, and returns a unified diff or a per-section header/op summary.

## Source

- Entry: `packages/code/src/tools/edit.ts` — parameter refinement, `WorkspaceFilesystem`, `blockResolver`, `createEditTool`.
- Matching: `packages/code/src/tools/edit-match.ts` — line-ending helpers, nine match strategies, `findEditMatch`, `replaceOnce`, `applyEdit`.
- Hashline mode: `packages/code/src/tools/hashline/` — `Patch.parse`, `Patcher`, `SnapshotStore`, recovery and mismatch errors.
- Snapshots: `packages/code/src/tools/read-snapshots.ts` — shared with `read`.
- Collaborators: `packages/code/src/tools/index.ts` (schema conversion and permission wrapper), `diff` package (unified diff).

## Registration / gating

- Registered as a built-in in `packages/code/src/tools/index.ts:38-54`; the same `ReadSnapshotStore` instance is shared with `read`.
- Allowed by agent definitions through `edit` (alias `Edit`).
- Capabilities: `{ reads: false, writes: true }`; streaming: `{ arguments: true }`.
- Permission profile: write. The wrapper also feeds `edit` successes and failures into the patch-spiral detector.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | exact mode only | Target file; resolved against the tool `cwd`. |
| `oldString` | `string` | exact mode only | Text to locate; matched tolerantly against the file. |
| `newString` | `string` | exact mode only | Replacement text. |
| `patch` | `string` | patch mode only | One or more `[path#TAG]` sections with hashline hunk headers. |

`superRefine` rules (`edit.ts:20-31`):

- `patch` may not be combined with `path`, `oldString`, or `newString`.
- Without `patch`, all three of `path`, `oldString`, `newString` must be present.
- Violations surface as `Invalid arguments for tool "edit": …` from `prepareArguments`.

## Outputs

- Exact mode: one text block containing a unified diff (`--- a/<basename>`, `+++ b/<basename>`, 3 lines of context) from the old and new content.
- Patch mode: one line per applied section — `<header>` followed by `<op> at line <n>` when a first changed line exists; `op` is `create`, `update`, `delete`, or `noop`. The header contains the freshly minted tag, so it can be reused for the next patch.
- Errors return `isError: true` with a text message; exact-mode failures append `[<relative path>]`.
- Files: the target file is rewritten in exact mode; patch mode may create, update, delete, or move files according to the hashline operations.

## Flow

1. Patch mode constructs `WorkspaceFilesystem(cwd)` (realpath-based canonicalization, tag path recovery limited to `cwd`) and runs `new Patcher({ fs, snapshots: snapshots.store, blockResolver }).apply(Patch.parse(patch, { cwd }))`.
2. `Patcher.prepare` parses, requires the section tag, reads the file, optionally rebinds a mistyped path from a matching tag, gates the write, and applies edits in memory after freshness and seen-line checks.
3. `Patcher.commit` writes, renames, or deletes, restores BOM and line endings, records a full-content snapshot, and returns `{ path, canonicalPath, op, before, after, persisted, written, fileHash, header, firstChangedLine, blockResolutions, warnings }`.
4. Exact mode resolves `path`, rejects missing files, reads UTF-8 content, and calls `applyEdit`.
5. `applyEdit` detects the file's line ending, normalizes both strings to it, and runs `findEditMatch`.
6. `findEditMatch` tries strategies in order and accepts only a candidate whose first and last occurrence in the file are the same index; the returned span is the file's real bytes, not the caller's text.
7. A successful splice that equals the original content is rejected as a no-op; otherwise the file is written and `snapshots.record` marks every line as seen.
8. The diff is generated and returned.

Match strategies, in order (`edit-match.ts:99-122`): exact substring; line-trimmed comparison; block anchor with first/last trimmed lines plus Levenshtein scoring (3+ lines); whitespace-collapsed; common-indent stripped; escape-sequence unescaped; trimmed boundary; context-aware (first/last trimmed anchors, ≥50% of non-empty middle lines matching); multi-occurrence enumeration.

## State / persistence

- Exact-mode writes update the snapshot store with the new content and every line marked seen, so a following hashline patch works without another read.
- Patch mode records a full snapshot after each commit, relocates history on `MV`, and invalidates history on `REM`.
- Nothing is persisted across process restarts; snapshot storage is the in-memory store by default.
- The tool keeps no other state; `cwd` and the snapshot store are captured at construction.

## Security

- The wrapper enforces permission, external-directory access, path safety, and the write guard for `path` arguments before execution.
- `WorkspaceFilesystem.allowTagPathRecovery` rejects recovered destinations outside `cwd`, preventing a stale tag from redirecting an edit elsewhere (`edit.ts:64-67`).
- Patch freshness is enforced by the 4-hex content tag plus the seen-line guard; a stale or invented tag raises `MismatchError` unless recovery succeeds.
- Exact mode does not consult tags, so it can modify a file the model never read; only the wrapper's rules constrain it.
- `blockResolver` is a local bracket/indent heuristic; it does not invoke a language server.

## Errors

| Condition | Result |
| --- | --- |
| `patch` combined with exact fields | `patch cannot be combined with path, oldString, or newString` |
| Missing exact fields | `provide patch or path, oldString, and newString` |
| Exact target missing | `File not found: <resolved>` |
| No tolerant match | `Could not find the specified text in the file. It must match including whitespace and indentation. Try reading the file first and copying the exact bytes.` |
| Multiple distinct occurrences | `Found multiple matches for the specified text. Include more surrounding context to make the match unique.` |
| Replacement equals original | `No changes made - the replacement didn't modify the file.` |
| Patch section without tag | `Missing hashline snapshot tag for <path>; use [path#tag] from your latest read/search output. To create a new file, use the write tool.` |
| Tag not from this session | `hash #<tag> is not from this session.` with the current hash and re-read guidance. |
| File drifted beyond recovery | `Edit rejected: file changed between read and edit.` |
| Anchored line never displayed | Unseen-lines message inlining the actual content and requiring a range re-read. |
| Multi-section patch produced no change | `Edits to <path> resulted in no changes being made.` (a single-section no-op returns `op: "noop"` instead) |
| Multi-file patch write failure | `Failed to write <path>: … Sections already written: … Sections not written: …` |

## Limitations

- Exact matching must resolve to one unique occurrence; repeated text requires more context or patch mode.
- The fuzzy strategies can accept a differently indented or escaped block; the tool reports success even when the matched span differs textually from `oldString`.
- Exact mode cannot create a file; missing files are errors, and patch mode requires the file to exist (`Use the write tool to create new files`).
- Sections targeting the same path are merged and applied as one batch, so every anchor in that batch must address the pre-edit content; a second section cannot anchor on lines the first section created.
- `blockResolver` understands bracket balance and indentation only; `SWAP.BLK` on other constructs is rejected or lowered with a warning.
- A multi-section patch prepares every section before writing, but a mid-batch write failure leaves earlier sections on disk; there is no rollback.

## Tests

- `packages/code/src/__tests__/edit-match.test.ts` — line-ending helpers, exact and CRLF matching, tab/space tolerance, each tolerant strategy, multi-occurrence semantics, `applyEdit` edge cases, and the `edit: hashline snapshots` end-to-end tag round trip.

## Related

- `docs/features/hashline.md` — tag format, operation grammar, recovery.
- `docs/features/read.md` — produces the tags patch mode requires.
- `docs/features/write.md` — whole-file creation and overwrite.
- `docs/features/tool-registry.md` — permission wrapper and capabilities.
