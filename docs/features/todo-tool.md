# Todo tool

> Maintains a phased task tree for the current session, invoked by the agent as `todo` and persisted through tool-result history.

## Source

- Entry: `packages/code/src/tools/todo.ts` — schema, in-memory tree, operations, persistence replay, formatting.
- Collaborators:
  - `packages/code/src/tools/index.ts:295-313` — `createAllToolsWithSecurity` constructs `createTodoTool(sessionStore, parentSessionId)` and appends it after the builtins.
  - `packages/code/src/services/session-store.ts:71-130,162-175` — `SessionStore.get()` returns the session and its messages.
  - `packages/code/src/tools/index.ts:62` — `todo` is in `SKIP_PERMISSION_CHECK`.

## Registration / gating

- Registered by: `createAllToolsWithSecurity` (`tools/index.ts:304-309`). It is not in `builtinTools`, so paths that assemble tools from `createBuiltinTools` alone (for example the extension list used by ACP) do not expose it.
- Factory: `createTodoTool(sessionStore?, sessionId?)` (`todo.ts:70`). Without a store or session id, state starts empty and is never persisted.
- Enabled by: always, when the security-aware tool set is used. No config key toggles it.
- Permission profile: none. `capabilities: { reads: false, writes: false }` (`todo.ts:107`) and the name is skipped by the permission layer.

## Inputs

Arguments pass through `normalizeTodoArgs` before Zod validation (`todo.ts:51-69,235-327`), so several aliases are accepted: `operation` → `op`, `complete` → `done`, `remove` → `rm` → `drop`, `phase_id` → `phaseId`, `task_id` → `id`. `phase` and `task` may be objects or JSON-encoded strings; for `add`/`add_phase` a bare `title` is lifted into the nested payload.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `op` | `init \| add_phase \| add \| start \| done \| drop \| update \| move \| view \| clear` | yes | Operation. |
| `phases` | `Phase[]` | for `init` | Full tree. |
| `phase` | `Phase` | for `add_phase` | `{ id?, title, tasks? }`. |
| `phaseId` | `string` | no | Target phase for `add`, `update`, `move`. |
| `task` | `Task` | for `add` | `{ id?, title, status?, priority? }`. |
| `id` | `string` | for `start`/`done`/`drop`/`update`/`move` | Task id. |
| `title` | `string` | no | Replacement title for `update`. |
| `status` | `pending \| in_progress \| done \| dropped` | no | New status for `update`. |
| `priority` | `high \| medium \| low` | no | New priority for `update`. |
| `afterId` / `beforeId` | `string` | no | Insertion anchors for `move`. |
| `reason` | `string` | no | Accepted for `drop`; not stored or returned. |

## Outputs

- Text: `Todo updated: <done>/<total> done[ · N active][ · N pending][ · N dropped]`, a blank line, then the full tree as `- Phase <id>: <title>` with `  - <taskId> [status priority=...] <title>` lines (`todo.ts:357-380`).
- Details: `{ action, todoState, summary }` (`TodoDetails`, `todo.ts:24-29`); `todoState` is a deep copy of the phase tree.
- Errors use `errorResult` and carry no `todoState`.
- No events and no files.

## Flow

1. On construction, `loadTodoState` scans the session's messages and keeps the `todoState` from the last `toolResult` whose `toolName` is `todo` (`todo.ts:225-240`).
2. `nextPhase`/`nextTask` counters are recomputed from the highest numeric `p<N>` / `t<N>` id (`todo.ts:71-73,388-398`).
3. Each operation mutates the in-memory tree, then `complete()` clones it into `details` together with the summary and formatted tree (`todo.ts:100-107`).
4. `init` replaces the whole tree, de-duplicating ids with numeric suffixes when the same id appears twice (`todo.ts:122-146,383-388`).
5. `start` demotes every other `in_progress` task to `pending`, then marks the target `in_progress` (`todo.ts:167-176`); `done`/`drop` set the status directly; `update` can set any status, title, priority, or move the task to another phase.
6. `move` removes the task and inserts it before `beforeId`, else after `afterId`, else at the end of the target phase (`todo.ts:199-213`); `beforeId` wins when both are supplied.
7. `clear` empties the tree and resets both counters to 1.
8. Persistence happens only when the surrounding session layer saves the tool result message; the tool itself writes nothing.

## State / persistence

- In-memory `TodoState` per tool instance, rebuilt from session messages on construction.
- Durable copy lives in the session store (`sessions.db` under the Spectra data directory, `session-store.ts:75-79`), as part of the `todo` tool-result details. Without `sessionStore` and `sessionId`, state survives only within the tool instance.
- Subagents receive the parent session id in `createAllToolsWithSecurity` (`parentSessionId`), so their todo tool reads the parent's last state.

## Security

- No filesystem, shell, or network access; no permission prompt.
- Any state visible in the session is copied into tool details, so secrets placed in task titles persist in the session database.

## Errors

| Condition | Result |
| --- | --- |
| `init` without `phases` | `Missing required parameter: phases`. |
| `add_phase` without `phase` | `Missing required parameter: phase`. |
| `add`/`start`/`done`/`drop`/`update`/`move` without required payload | `Missing required parameter: task` / `id`. |
| Duplicate phase id on `add_phase` | `Phase already exists: <id>`. |
| Duplicate task id on `add` | `Task already exists: <id>`. |
| Unknown task id | `Task not found: <id>`. |
| Zod validation failure | Raised before execution by the tool schema. |

## Limitations

- `reason` is accepted but discarded; drops carry no explanation.
- Only `start` enforces a single active task; `update` can set several tasks to `in_progress`.
- `ensurePhase` silently falls back to the last existing phase when `phaseId` is unknown or omitted (`todo.ts:77-88`), so `add`, `update`, and `move` can land in an unexpected phase instead of erroring.
- Phase removal, phase reordering, and phase renaming are not supported.
- Id collisions from `init` are resolved by suffixing (`-2`, `-3`), which changes caller-supplied ids.
- State depends on the session message history being available; replay ignores todo results whose details were stripped or truncated.
- Clear resets numbering, so ids can be reused later in the same session.
- ACP sessions do not get this tool because they build tools through `createAllToolsWithExtensions`.

## Tests

- No tests in `packages/code/src/__tests__/` cover `createTodoTool`, normalization, transitions, or persistence. The behaviors above are read from source and are not verified by the suite.

## Related

- [sessions.md](sessions.md), [tool-registry.md](tool-registry.md), [context-compaction.md](context-compaction.md)
- Subagent tool set assembly: `packages/code/src/tools/task.ts:221-225` (subagents page is planned)
