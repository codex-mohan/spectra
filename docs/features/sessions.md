# Sessions

> SQLite-backed conversation records that survive restarts, plus the in-process registry that binds a session id to a live agent and streams its turns.

## Source

- Entry: `packages/code/src/services/session-store.ts` — schema, CRUD, messages, revert state, checkpoints, parent/child hierarchy.
- Entry: `packages/code/src/services/session-manager.ts` — per-session runtime state (`SessionState`), agent creation/reuse, prompt execution, cancellation, background-result injection.
- Collaborators:
  - `packages/code/src/tui/app.tsx` — creates the single `SessionStore` (`:262`) and `SessionManager` (`:289`); loads, forks, and deletes sessions from dialogs and commands.
  - `packages/code/src/tui/hooks/use-chat-submit.ts` — persists each SDK message through `addMessage` (`:138-141`) and rewrites metadata through `save`.
  - `packages/code/src/tui/ui/session-list.tsx` — load/delete/rename picker over `listTopLevel(process.cwd())` (`:42`).
  - `packages/code/src/tools/task.ts` — creates child sessions for subagents (`:280-286`) and appends subagent messages (`:262`, `:292`).
  - `packages/code/src/commands/session.ts` — `spectra session list|delete|load`.
  - `packages/code/src/commands/db.ts` — `spectra db path|query` against the same database file.

## Registration / gating

- Registered by: constructing `new SessionStore()` (TUI startup and the CLI commands). No registry entry exists; the store is a plain class.
- Enabled by: always on. No config key controls persistence.
- Database location: `join(getGlobalDataDir(), 'sessions', 'sessions.db')` unless a `dataDir` argument is supplied (`session-store.ts:74-83`). `getGlobalDataDir()` honours `SPECTRA_HOME`, otherwise `~/.spectra` (`packages/code/src/utils/paths.ts:5-17`).
- Permission profile: write. The process creates the sessions directory and the SQLite file.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | `string` | no | Defaults to `New Session`; replaced by the first user message or the title agent. |
| `agent` | `string` | no | Defaults to `build`. |
| `model` / `provider` | `string` | no | `provider` falls back to the segment before the first `/` in `model`. |
| `thinkingEffort` | `string` | no | Stored per session and used when rebuilding the agent. |
| `directory` | `string` | no | Working directory; defaults to `process.cwd()` and scopes `list(dir)`. |
| `message` | `Message` | yes (for `addMessage`) | Serialized to JSON at the next `position`. |
| `parentId` | `string` | no | Set only by `createChild`; children are excluded from `listTopLevel`. |

`SessionManager.runPrompt` accepts model/provider/agent/custom-provider/thinking-effort plus streaming callbacks (`onMessageStart`, `onMessageUpdate`, `onMessageEnd`, `onToolStart`, `onToolEnd`, `onAgentEnd`).

## Outputs

- Store results: `SessionInfo` rows (metadata plus `messageCount`), `SessionData` (metadata, `messages`, optional `revert`, optional `checkpoints`), `SessionCheckpoint`, booleans from `delete`/`rename`/`archive`.
- Manager results: `SessionState` objects and `SessionEvent` values (`status_change`, `messages_update`, `error`) delivered to handlers registered with `onEvent`.
- Files: `sessions.db` plus SQLite `-wal`/`-shm` sidecars.

## Flow

1. `create` generates the id `Date.now().toString(36)-<6 base36 chars>` and calls `save` (`session-store.ts:195-219`).
2. TUI submits a prompt; `SessionManager.runPrompt` reuses the agent when `<agent>:<model>:<provider>:<effort>` still matches, otherwise calls the injected `agentFactory` and restores `loadedMessages` through `agent.restoreHistory` (`session-manager.ts:158-191`).
3. `runPrompt` iterates `agent.run(prompt)`, forwarding `message_*`, `tool_execution_*`, and `agent_end` events to callbacks, and flips status `busy` → `idle` in `finally` (`:193-273`).
4. Each SDK message is appended with `addMessage`. The first user message in a non-child session becomes the title (first 60 characters) (`session-store.ts:301-325`); the TUI title agent may later overwrite it with a 3-6 word summary (`use-chat-submit.ts:175-232`).
5. Assistant-message metadata (turn tokens, duration, snapshot patch, context usage) is merged into the stored row and the whole session is re-saved (`use-chat-submit.ts:144-159`).
6. Fork copies the session, appends ` (fork)` to the title, and clones the message array (`session-store.ts:278-291`). The message-controls fork additionally truncates to the selected message (`tui/app.tsx:1429-1438`).
7. Child sessions are created by the `task` tool with a parent id, title `<agent>: <description>` (80 chars), and the subagent's model/provider; child directory is always `process.cwd()`.
8. `delete` removes the session row; `messages` and `checkpoints` disappear through `ON DELETE CASCADE`. Child rows keep existing with `parent_id` set to `NULL` (`ON DELETE SET NULL`).
9. Interrupts: an empty trailing assistant message is popped; an assistant text turn gets a hidden `[Response interrupted by user]` user marker persisted to the session (`session-manager.ts:316-344`).

## State / persistence

- Tables: `sessions`, `messages`, `checkpoints`, plus indexes on `(session_id, position)`, `parent_id`, `directory`, and `updated DESC` (`session-store.ts:86-127`).
- `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`; SQLite is opened through `bun:sqlite` with a `better-sqlite3` fallback.
- `save` runs one transaction that updates/inserts the session row and **replaces all messages and checkpoints for that session** (`:221-266`).
- `revert` state is two columns on the session; checkpoints live in their own table and are exposed through `addCheckpoint`/`getCheckpoints`.
- Runtime state (`SessionManager.sessions`) is memory-only: agent handles, streaming flags, abort controllers, loaded messages, and custom-provider configs are lost on restart. Persisted messages are rehydrated from SQLite on load.

## Security

- All SQL uses prepared statements with bound parameters; message bodies are stored as opaque JSON.
- Session records include the working directory, so `session list` and the TUI picker filter by `process.cwd()` rather than exposing every directory's sessions (`commands/session.ts:16-28`, `session-list.tsx:42`).
- Session files live under the user's Spectra home; the store does not set restrictive permissions on `sessions.db` beyond the process umask.
- Deleting a session is destructive and immediate; there is no trash layer.

## Errors

| Condition | Result |
| --- | --- |
| SQLite module missing | `openDatabase` lets the `require` failure propagate; the store cannot be constructed. |
| `get`/`setRevert`/`addCheckpoint` on an unknown id | `null` / `undefined`; no exception. |
| `addMessage` with an unknown session id | `null`; nothing written. |
| Agent throws during a turn | `status_change` + `error` event; status returns to `idle`. |
| Prompt submitted while `isStreaming` | Call is ignored (early return). |
| `session delete <id>` for a missing id | `Session not found: <id>` on stderr, exit code 1. |
| `db <query>` failure | `Query failed: <message>`, exit code 1. |

## Limitations

- Every `save` deletes and re-inserts every message row for the session; cost grows with conversation length.
- `archive` is implemented as `delete` (`session-store.ts:293-299`); nothing is retained for later restore despite the command label.
- There is no schema version table; `migrate` only issues `CREATE TABLE IF NOT EXISTS`, so column changes require manual migration.
- `SessionManager.injectBackgroundResult` reconstructs model/provider by splitting `agentKey` on `:`, which breaks for models containing a colon.
- Child sessions inherit no directory from the parent; they always use the process cwd.
- `SessionManager` emits no `messages_update` events itself; UI updates are driven by the callbacks passed into `runPrompt`.

## Tests

- `packages/code/src/__tests__/session-store.test.ts` — create/retrieve, message append, ordering, delete, rename, fork, child creation, child title preservation, top-level filtering, revert state, checkpoints, auto-title, directory filter.
- `packages/code/src/__tests__/session-messages.test.ts` — hydration of persisted messages, attachments, steering, subagent tool calls, per-turn agent metadata, provider failures, token totals.
- `packages/code/src/__tests__/session-state-prefs.test.ts` — pre-session agent preferences held by TUI session state.

## Related

- [snapshots.md](snapshots.md) — per-turn patches stored in assistant-message metadata and used by revert.
- [context-compaction.md](context-compaction.md) — compaction rewrites the persisted message list.
- `subagents.md` — child sessions created by the task tool.
- Config keys: `model`, `provider`, `agent` (`config.md`).
