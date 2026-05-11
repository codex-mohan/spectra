---
'@singularity-ai/spectra-ai': patch
'@singularity-ai/spectra-agent': patch
'@singularity-ai/spectra-app': patch
---

feat: entry-based sessions with tree-structured provenance and audit trail

- Add optional `provenance` field to `ToolResultMessage` for hook intervention tracking (blockedBy, blockReason, transformedBy, retryCount)
- Refactor `Session` from flat `Message[]` to tree-structured `SessionEntry[]` with `id`/`parentId` linking
- New entry types: `MessageEntry`, `ModelChangeEntry`, `AuditEntry`, `CustomEntry`
- `SessionManager` additions: `appendEntry`, `appendMessage`, `appendAudit`, `appendCustom`, `appendModelChange`, `getBranch`, `getTree`, `getLeafId`, `buildContext`
- `fork()` now branches from any entry point in the DAG, not just message indices
- New stores: `FileSystemSessionStore` (JSON) and `SQLiteSessionStore` (better-sqlite3, optionalDependency)
- Full structured persistence: thinking blocks, tool calls, stop reasons, usage, and audit events round-trip correctly
- Comprehensive DAG/branching tests covering deep trees, multiple branches, context building, and provenance persistence
