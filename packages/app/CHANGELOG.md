# @singularity-ai/spectra-app

## 0.2.4

### Patch Changes

- [`973851c`](https://github.com/codex-mohan/spectra/commit/973851c4f9f2a9407a3dc2868030af5a62e1a3b6) Thanks [@codex-mohan](https://github.com/codex-mohan)! - feat: entry-based sessions with tree-structured provenance and audit trail

  - Add optional `provenance` field to `ToolResultMessage` for hook intervention tracking (blockedBy, blockReason, transformedBy, retryCount)
  - Refactor `Session` from flat `Message[]` to tree-structured `SessionEntry[]` with `id`/`parentId` linking
  - New entry types: `MessageEntry`, `ModelChangeEntry`, `AuditEntry`, `CustomEntry`
  - `SessionManager` additions: `appendEntry`, `appendMessage`, `appendAudit`, `appendCustom`, `appendModelChange`, `getBranch`, `getTree`, `getLeafId`, `buildContext`
  - `fork()` now branches from any entry point in the DAG, not just message indices
  - New stores: `FileSystemSessionStore` (JSON) and `SQLiteSessionStore` (better-sqlite3, optionalDependency)
  - Full structured persistence: thinking blocks, tool calls, stop reasons, usage, and audit events round-trip correctly
  - Comprehensive DAG/branching tests covering deep trees, multiple branches, context building, and provenance persistence

- Updated dependencies [[`973851c`](https://github.com/codex-mohan/spectra/commit/973851c4f9f2a9407a3dc2868030af5a62e1a3b6)]:
  - @singularity-ai/spectra-ai@0.2.4
  - @singularity-ai/spectra-agent@0.2.4

## 0.2.3

### Patch Changes

- [`1ec3278`](https://github.com/codex-mohan/spectra/commit/1ec3278a8611daa3707ae49b1e7fcacb4e227c92) Thanks [@codex-mohan](https://github.com/codex-mohan)! - fix: resolve workspace:_ protocol before publishing to npm - prevents workspace:_ from leaking into tarballs and breaking consumers

- Updated dependencies [[`1ec3278`](https://github.com/codex-mohan/spectra/commit/1ec3278a8611daa3707ae49b1e7fcacb4e227c92)]:
  - @singularity-ai/spectra-ai@0.2.3
  - @singularity-ai/spectra-agent@0.2.3

## 0.2.2

### Patch Changes

- [`dc0b8fd`](https://github.com/codex-mohan/spectra/commit/dc0b8fd5caa0f8c98cbd52a500723836c98ccfe6) Thanks [@codex-mohan](https://github.com/codex-mohan)! - fix: add build step to release workflow so compiled JS and type declarations are included in npm packages

- Updated dependencies [[`dc0b8fd`](https://github.com/codex-mohan/spectra/commit/dc0b8fd5caa0f8c98cbd52a500723836c98ccfe6)]:
  - @singularity-ai/spectra-ai@0.2.2
  - @singularity-ai/spectra-agent@0.2.2

## 0.2.1

### Patch Changes

- [`9a28b2a`](https://github.com/codex-mohan/spectra/commit/9a28b2a166c1efec3033df5c79ef00b926aad83b) Thanks [@codex-mohan](https://github.com/codex-mohan)! - docs: add per-package READMEs with full API documentation and enhance VitePress docs site with app package coverage (session management, orchestration, worker pools, rate limiting)

- Updated dependencies [[`9a28b2a`](https://github.com/codex-mohan/spectra/commit/9a28b2a166c1efec3033df5c79ef00b926aad83b)]:
  - @singularity-ai/spectra-ai@0.2.1
  - @singularity-ai/spectra-agent@0.2.1
