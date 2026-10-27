# Hashline patcher

> The hashline format binds every edit section to a file via a content-derived `[path#TAG]` header and expresses changes as line-anchored operations, so the patcher can reject stale edits, enforce that anchors were actually read, and fall back to snapshot-based recovery instead of guessing.

## Source

- Entry: `packages/code/src/tools/hashline/` — barrel export `index.ts`.
- Grammar and primitives: `format.ts` (keywords, separators, `computeFileHash`, header/numbered-line formatting), `tokenizer.ts` (line classifier, `Token` union), `parser.ts` (token-to-`Edit` state machine), `input.ts` (`Patch`, `PatchSection`, section splitting and same-path merging).
- Application: `apply.ts` (`applyEdits`, boundary-echo and landing repairs), `block.ts` (block target resolution), `types.ts` (`Edit`, `FileOp`, `ApplyResult`, resolver types).
- Orchestration: `patcher.ts` (`Patcher.prepare`/`commit`/`preflight`/`apply`), `mismatch.ts` (`MismatchError`), `recovery.ts` (3-way merge, line remap, session replay), `snapshots.ts` (`SnapshotStore`, `InMemorySnapshotStore`), `fs.ts` (`Filesystem`, `InMemoryFilesystem`, `NodeFilesystem`), `normalize.ts` (line endings, BOM), `messages.ts` (all error/warning text), `diff-preview.ts` (compact numbered-diff preview).
- Consumed by: `packages/code/src/tools/edit.ts` (patch mode).

## Registration / gating

- Not registered directly; the `edit` tool constructs `Patch.parse(...)` and a `Patcher` per call.
- The `Patcher` requires a `SnapshotStore` and throws `Hashline Patcher requires a SnapshotStore; section tags are opaque store pointers.` without one (`patcher.ts:201-209`).
- The edit tool supplies `WorkspaceFilesystem(cwd)`, the shared `ReadSnapshotStore.store`, and a bracket/indent `BlockResolver`.
- Permission profile: write, enforced by the edit tool's wrapper before the patcher runs.

## Inputs

Patch text: one or more sections, each starting with `[path#TAG]` (TAG is four hex characters, canonically uppercase) followed by hunk headers and `+`-prefixed body rows.

| Operation | Form | Body | Effect |
| --- | --- | --- | --- |
| Replace | `SWAP N.=M:` | `+line` per new line | Replaces lines `N..M`. `SWAP N:` (single line) is also accepted. |
| Delete | `DEL N` or `DEL N.=M` | none | Deletes the range. |
| Insert before | `INS.PRE N:` | `+line` per line | Inserts before line `N`. |
| Insert after | `INS.POST N:` | `+line` per line | Inserts after line `N`. |
| Insert head | `INS.HEAD:` | `+line` per line | Inserts at start of file. |
| Insert tail | `INS.TAIL:` | `+line` per line | Inserts at end of file. |
| Block replace | `SWAP.BLK N:` | `+line` per line | Resolves `N` to a syntactic block span, then replaces it. |
| Block delete | `DEL.BLK N` | none | Resolves `N` to a block span, then deletes it. |
| Block insert | `INS.BLK.POST N:` | `+line` per line | Resolves `N` to a block span, then inserts after its last line. |
| Remove file | `REM` | none | Deletes the whole file. |
| Move file | `MV DEST` | none | Renames/moves the file; may accompany line edits. |

Optional envelope markers `*** Begin Patch`, `*** End Patch`, and `*** Abort` are consumed. Bare body rows are auto-prefixed with `+` and warn; `-` rows are rejected. A stray `.` before a header colon is tolerated. Apply-patch-style path noise (`*** Update File:`) is stripped from section headers.

## Outputs

- `Patcher.apply()` returns `{ sections: PatchSectionResult[] }`, one per section in patch order. Each result carries `path`, `canonicalPath`, `op` (`create`/`update`/`delete`/`noop`), `before`, `after`, `persisted`, `written`, `fileHash`, `header`, optional `firstChangedLine`, `blockResolutions`, `moveDest`, and `warnings`.
- `header` is the freshly computed `[path#newTag]`, reusable for the next patch on that file (meaningless after `REM`, which deletes it).
- Warnings are collected on each section result and merged from parse, resolve, apply, and recovery stages. The `edit` tool currently renders only `header`, `op`, and `firstChangedLine`, so warnings never reach the model.
- Files: create, overwrite, delete, or move at the section path, with original BOM and line endings restored.

## Flow

1. `Patch.parse(input, { cwd })` splits sections on header lines, strips envelope noise, and merges consecutive or interleaved sections that target the same path so their anchors stay valid in one batch (`input.ts:409-412`, `input.ts:428-...`).
2. `Patcher.apply` prepares every section before writing any; `preflight` stops after preparation. In a multi-section batch, a no-op section aborts the whole batch (the single-section fast path returns `op: "noop"`).
3. `prepare` parses the body, requires a tag, canonicalizes the path, reads the file, and — when the path is missing — attempts recovery from a unique `(basename, tag)` snapshot match, subject to `allowTagPathRecovery`.
4. `fs.preflightWrite` runs before any write work; a missing file then fails with `File not found: <path>. Use the write tool to create new files.`
5. Text is split into BOM and body; line ending is detected; the body is normalized to LF.
6. Freshness: `computeFileHash(normalized)` equal to the section tag means the anchors index the tagged content, so block edits resolve against live text and the seen-line guard runs.
7. Seen-line guard: when the snapshot store has provenance for the exact text, any anchor line the read never displayed is rejected with the actual content of those lines inlined.
8. Drift path: head/tail-only inserts apply onto live content with `HEADTAIL_DRIFT_WARNING`; anchored edits go to `Recovery`.
9. `applyEdits` validates bounds, repairs replacement boundary echoes and after-insert landing depth, then applies line edits bottom-up.
10. `commit` writes via the filesystem, records a full snapshot, and returns the new tag; `REM` deletes and invalidates, `MV` relocates history and writes the destination.
11. In a multi-section batch, a mid-batch write failure reports the sections already written and the sections not written, without rollback.

## State / persistence

- Tags are content hashes over the whole normalized file: trailing spaces/tabs/CR are trimmed per line before hashing, and any read of identical bytes produces the same tag.
- `Snapshot` records `{ path, text, hash, recordedAt, seenLines? }`; `seenLines` is the union of all lines displayed under that tag and is absent when no provenance was recorded.
- `InMemorySnapshotStore` defaults: 30 paths, 4 versions per path, 64 MiB of retained text across all paths, LRU eviction. `byHash` returns the most recently recorded version when two texts collide on the 4-hex tag.
- Snapshots are session memory; nothing survives a process restart. `record`/`relocate`/`invalidate`/`clear` are the mutation points.

## Security

- Section tags act as freshness proof: an invented or prior-session hash fails with a message telling the caller to re-read.
- The seen-line guard prevents edits to lines the model never observed, and its reveal is capped at 40 lines and 512 columns so it cannot be used to dump a line the model has not read.
- `WorkspaceFilesystem.allowTagPathRecovery` confines tag-based path recovery to the working directory.
- `fs.preflightWrite` runs the host write gate before commits. `NodeFilesystem` itself does no sandboxing; jailing is the caller's responsibility.
- No escaping or encoding is applied to payload text; body lines are written as parsed apart from the documented boundary and landing repairs.

## Errors

| Condition | Result |
| --- | --- |
| Missing section tag | `Missing hashline snapshot tag for <path>; … To create a new file, use the write tool.` |
| Path missing after recovery attempt | `File not found: <path>. Use the write tool to create new files.` |
| `SWAP` with no body | `SWAP N.=M: needs at least one +TEXT body row. To delete lines, use DEL N.=M.` |
| `DEL` with a body | `DEL N.=M does not take body rows. …` |
| `INS` with no body | `INS needs at least one +TEXT body row.` |
| `REM` with a body or line ops | `REM deletes the whole file and takes no body rows or line ops. Issue it alone under the header.` |
| `MV` with a body | `MV DEST does not take body rows. …` |
| Tag mismatch, unrecoverable | `Edit rejected: file changed between read and edit.` with the expected and actual hashes. |
| Tag not recognized | `hash #<tag> is not from this session.` with the current hash. |
| Anchored line out of range | `Line N does not exist (file has M lines)`. |
| Unresolved block | Block-specific message asking for a concrete range; block ops without a resolver report `… are not available here (no block resolver configured).` |
| Section applied to no change | `Edits to <path> resulted in no changes being made.` (multi-section) or `op: "noop"` (single section). |
| `MV` onto itself | `MV destination is the same as <path>.` |

Recovery warnings: `RECOVERY_EXTERNAL_WARNING`, `RECOVERY_SESSION_CHAIN_WARNING`, `RECOVERY_SESSION_REPLAY_WARNING`, `RECOVERY_LINE_REMAP_WARNING`, plus landing-shift warnings.

## Limitations

- The tag is only four hex characters; collisions are possible, and an unrelated file state that hashes to the same prefix is accepted as a match on the no-drift path. The store retains colliding versions separately, but `byHash` exposes only the most recent one to recovery.
- Patcher warnings are computed but not surfaced by the `edit` tool, so landing shifts, boundary repairs, and recovery modes are invisible to the caller.
- Recovery is heuristic: exact 3-way replay refuses fuzz, line remap requires one consistent offset across anchors, and session replay requires equal line counts plus matching anchor content; none of these proves intent.
- The seen-line guard only runs when provenance exists for the exact tagged text; an externally minted tag or aged-out snapshot skips it.
- `SWAP.BLK`/`DEL.BLK`/`INS.BLK.POST` depend on an injected resolver. The edit tool's resolver is a bracket/indent heuristic, not a language parser.
- `INS.POST` landing can be silently corrected outward or inward when body indentation implies a different depth; the move is reported as a warning but the patch still applies.
- There is no rollback for a mid-batch write failure, and no dry-run through the tool (only the internal `preflight` API).
- Binary files are handled as UTF-8 text.

## Tests

- No dedicated hashline test file exists under `packages/code/src/__tests__/`.
- `packages/code/src/__tests__/edit-match.test.ts` (`edit: hashline snapshots`) covers the end-to-end path: `read` mints `[path#TAG]` and `SWAP 1.=1:` applies the replacement under that tag.

## Related

- `docs/features/edit.md` — the only tool that invokes the patcher.
- `docs/features/read.md` — mints tags and seen-line provenance.
- `docs/features/write.md` — creates files that hashline refuses to create.
- `docs/features/snapshots.md` — user-facing snapshot/revert service, distinct from this in-memory store.
