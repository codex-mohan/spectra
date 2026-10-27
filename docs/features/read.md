# Read tool

> `read` returns one normalized view of a file, directory, document, image, archive member, SQLite database, HTTP resource, or internal resource URI, with line numbers, range selection, and a `[path#TAG]` header that later hashline edits must cite.

## Source

- Entry: `packages/code/src/tools/read.ts` — `createReadTool`, source dispatch, spill handling, snapshot recording, result formatting.
- Selectors: `packages/code/src/tools/read-selectors.ts` — `splitReadTarget`, `parseReadSelector`, `materializeRanges`.
- Snapshots: `packages/code/src/tools/read-snapshots.ts` — `ReadSnapshotStore`, canonical-path resolution, 4 MiB cap.
- Readers:
  - `packages/code/src/tools/image-reader.ts` — extension-to-MIME map and base64 image content.
  - `packages/code/src/tools/document-reader.ts` — PDF, DOCX, PPTX, XLSX, EPUB, RTF, ipynb to markdown/text.
  - `packages/code/src/tools/archive-reader.ts` — zip/tar member and listing reads.
  - `packages/code/src/tools/sqlite-reader.ts` — read-only SQLite queries.
  - `packages/code/src/tools/source-summary.ts` — tree-sitter structural summaries for large source files.
- Collaborators: `packages/code/src/internal-urls/` (scheme router, artifact store), `packages/code/src/security/ssrf-guard.ts`, `packages/code/src/services/session-store.ts`.

## Registration / gating

- Registered as a built-in in `packages/code/src/tools/index.ts:38-54` via `createReadTool`; `read` and `edit` share the same `ReadSnapshotStore`.
- Agent-visible only when the active definition allows `read`; aliases `Read` and `ls` normalize to it (`packages/code/src/agents/tool-filter.ts:5-30`).
- Capabilities: `{ reads: true, writes: false }`.
- Permission profile: read. The wrapper checks `external_directory` for paths outside the workspace, falls back to the `read` permission when no path argument is present, and records the path with the read tracker.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | yes | File, directory, `archive.ext:member`, `db.sqlite:table[:key]`, `http(s)://` URL, or internal-scheme URI, optionally with a trailing selector. |
| `offset` | `number` (>=1) | no | First line to show when no selector is present. |
| `limit` | `number` (>=1) | no | Maximum lines when no selector is present. |

Selector grammar (appended to `path`, case-insensitive):

| Form | Meaning |
| --- | --- |
| `:N` | Single line. |
| `:N-M` | Inclusive range; `..` is accepted as the separator. |
| `:N+K` | `K` lines starting at `N`. |
| `:N-` | From `N` to end of content. |
| `:A,B:C` | Comma-separated list of the above; each range is rendered in order. |
| `:raw` | Full content with no line prefixes. |
| `:conflicts` | Only unresolved merge-conflict blocks, from each `<<<<<<< ` line through its `>>>>>>> ` line. |

Each line number also accepts an `L` prefix (`:L10-L20`). Selector splitting is guarded so an `ssh://` authority or port is not consumed as a selector, and an `mcp://` target keeps the split as an opaque fallback (`read-selectors.ts:68-82`).

## Outputs

- Tool result: one text block shaped as `[path#TAG]\n[url | contentType | mutable|immutable | directory]\n<numbered lines>`. The tag line is omitted when no snapshot was recorded. The structural-summary path returns `[path#TAG]` plus the annotated summary and omits the details line.
- Numbered lines use `LINE:TEXT`; multi-range selections are separated by one blank line.
- `:raw` returns the resource body verbatim with no tag.
- Directories return `d name/`, `f name`, or `l name` rows sorted by name, with no tag.
- Images return a text note (`Read image file [mime] (N bytes)`) plus an `image` content block holding base64 data.
- Documents and archives return text; SQLite returns pretty-printed JSON.
- Oversized unselected output is written to the artifact store and replaced by the first 240 lines plus `[Output truncated after 240 lines. Full content: artifact://<id>]`.
- Errors return `isError: true` with the message as the only text block.

## Flow

1. `splitReadTarget` separates the trailing selector from the target.
2. Dispatch order: internal scheme (when the router handles it) → `http(s)` → unknown scheme error → archive member → SQLite → local image → local path (`read.ts:123-176`).
3. Local paths are resolved against `cwd`; a directory is listed, a non-regular file is rejected, a file over 16 MiB is rejected, convertible documents are converted, everything else is read as UTF-8.
4. HTTP reads apply the SSRF guard, redirect policy, `content-length` and body size limits, and derive content type from the response header.
5. With no selector and a mutable local file of at least 300 lines, `summarizeSource` may elide statement bodies and return a structural summary instead of full text.
6. With no selection and more than 240,000 characters, content spills to `artifact://`.
7. `selectedLines` materializes ranges (or `offset`/`limit`) and numbers them; `seenLines` collects every displayed line.
8. `ReadSnapshotStore.record` stores canonical-path content (BOM stripped, CRLF normalized, skipped above 4 MiB) and returns the `#TAG`; `:raw` records nothing.
9. The tag is attached as the first line and the result is returned.

## State / persistence

- Snapshots are in memory for the session (`InMemorySnapshotStore` by default; the abstract store allows other backends). Recording the same content again unions `seenLines` onto the same content tag.
- Artifacts are written under `.spectra/artifacts` (or `options.artifactDir`) and are readable later as `artifact://<id>`.
- Nothing else survives a restart; tags from a prior session are rejected by the patcher.

## Security

- HTTP reads go through `SsrfGuard` when one is injected; redirects are refused unless the guard enables them.
- When built through `createAllToolsWithSecurity`, read results are wrapped by `wrapExecute`, so path safety, external-directory permission, and read tracking apply before the tool runs. Unwrapped construction paths (`createAllToolsWithMcp`, `createAllToolsWithExtensions`) skip those checks.
- Archive member paths reject `..` traversal; SQLite opens read-only and rejects writes, multiple statements, and unsafe PRAGMAs.
- Document conversion and archive extraction happen in-process with no sandboxing.

## Errors

| Condition | Result |
| --- | --- |
| Missing file | `File not found: <resolved>` |
| Path is not a regular file | `Not a regular file: <resolved>` |
| File/HTTP body over 16 MiB | `File exceeds the 16 MiB read limit: …` / `HTTP resource exceeds the 16 MiB read limit` |
| Malformed selector | `Invalid read selector: <value>` |
| Descending range | `Invalid descending read selector: <value>` |
| Unknown internal scheme | `Unsupported resource protocol: <scheme>://` |
| Unhandled internal resource | Router error propagated as tool text. |
| Archive member missing | `Archive member not found: <member>` |
| SQLite table/row missing | `SQLite table not found: <table>` / `SQLite row not found: <table>:<key>` |
| Unsafe SQL | `SQLite query must be a single read-only …` |
| Unsupported image format | `Unsupported image format: <ext>` |

## Limitations

- The spill truncation happens before range selection; a selector applied to a spilled resource sees only the first 240 lines, so a full re-read with an explicit range is required elsewhere.
- Structural summaries require at least 300 lines, a supported grammar, a parse with no errors, and at least one elided body; unsupported languages return full text.
- Binary files without a recognized image or document extension are decoded as UTF-8.
- Archive members are extracted fully into memory; nested archives are not opened.
- SQLite exposes tables, single rows by key, and filtered listings; it does not expose BLOBs (rendered as `<BLOB N bytes>`).
- The structural-summary path records only each elided range's start and end line as seen, so snapshot provenance for that response does not correspond to the lines the summary displayed.
- Snapshot tags identify content, not a read event: identical bytes read twice share one tag, and the seen-line set is the union of all reads under that tag.

## Tests

- `packages/code/src/__tests__/read-tool.test.ts` — selector parity across files and protocol resources, conflict extraction, artifact spill, raw mode, image notes and errors, directory rejection for image names.
- `packages/code/src/__tests__/edit-match.test.ts` (`edit: hashline snapshots`) — the emitted `[path#TAG]` header is consumed by the edit tool end to end.

## Related

- `docs/features/hashline.md` — tag semantics, freshness, and the patcher.
- `docs/features/edit.md`, `docs/features/write.md` — mutation paths.
- `docs/features/search.md` — `glob`/`grep`.
