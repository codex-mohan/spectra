# Subagents

> Spawn isolated child agents for research, review, or parallel work; the `task` tool fans out one child per assignment, returns results, and exposes durable job handles.

## Source

- Entry: `packages/code/src/tools/task.ts` — tool schema, prompt composition, child spawning, job handles
- Collaborators:
  - `packages/agent/src/subagent.ts` — `runSubagent`, restore history, pause boundary, cancellation
  - `packages/code/src/services/job-registry.ts`, `job-store.ts` — durable job state
  - `packages/code/src/services/auto-background.ts` — promotes foreground tasks when the user types
  - `packages/code/src/services/context.ts` — `buildSubagentSystemPrompt`

## Registration / gating

- Registered by: `createAllToolsWithSecurity` in `packages/code/src/tools/index.ts` (requires a session and agent config)
- Enabled by: always available in the TUI; requires `ctx.sessionId` or a parent session id
- Permission profile: `task` requires approval; policy marks it as orchestration (no approval prompt for safe orchestration unless `tools.task` is grid-listed)
- Blocked: a subagent listed in `primaryOnly` (e.g. `build`, `plan`) cannot be spawned

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `agent` / `subagent_type` | `string` | yes (single) | Subagent to run |
| `prompt` | `string` | yes (single) | Assignment for a single task |
| `tasks[]` | `array` | no | Fan-out items: `{ id?, name?, role?, description?, agent?, assignment, reporting? }` |
| `context` | `string` | no | Batch-wide goal and constraints prepended to every prompt |
| `reporting` | `string` | no | Caller-level reporting instruction |
| `background` | `boolean` | no | Return immediately after starting jobs; default `false` |
| `task_id` | `string` | no | Resume an existing job instead of starting a new one |

## Outputs

- Result text: one `<task id="..." state="...">` block per item (foreground), or an acknowledgement listing job ids (background)
- Structured details: `{ jobs: [{ id, state, childSessionId }], results }`
- Transcripts: child sessions under the parent session (`SessionStore.createChild`)
- Jobs: rows in `jobs.db`, visible to `job` and `agent://<id>`

## Flow

1. Validate the request (`normalizeTaskArgs`): resolve the agent, reject primary-only agents, require a parent session.
2. For each item create a child session and a `queued` job; register a `JobHandle`.
3. `runAttempt` transitions the job to `running`, builds the child config (`filterToolsByAgent`, filtered MCP tools, new security manager), and calls `runSubagent`.
4. Streamed child events are tailed into the renderer (best effort); completed messages are appended to the child session.
5. A result with `paused` moves the job to `paused`; otherwise `complete`/`fail`. Retryable transport failures retry once when no assistant output was committed.
6. Foreground mode awaits all items (concurrency 4); background mode returns immediately. Foreground tasks register with `autoBackground`; a new user prompt promotes the open waiter so the turn ends and the task keeps running.
7. `task_id` resumes through the registered handle (history restored from the child session).

## State / persistence

- Jobs in `~/.spectra/jobs.db` (SQLite, `bun:sqlite` under Bun, `better-sqlite3` under Node); rows survive restarts.
- Running rows are recovered as `paused` on the next registry load.
- Child transcripts live in the session store; restart-from-start clears them.

## Security

- Child tool access is filtered by the subagent definition; read-only agents get read-only tools.
- Child tools get a fresh `SecurityManager` scoped to the child session, so a narrow parent profile can be enforced independently.
- External tool/MCP access follows the parent's env and permission configuration.
- Prompt composition contracts: assignment, shared context, reporting, and the subagent system prompt.

## Errors

| Condition | Result |
| --- | --- |
| Unknown agent | `Unknown subagent "<x>". Available: ...` |
| Primary agent requested | `"<x>" is a primary agent and cannot be spawned as a subagent` |
| No parent session | `task requires a parent session` |
| Empty batch | `task requires at least one task or prompt` |
| Child failure | Job `failed` with the error; failure is isolated from sibling items |

## Limitations

- Foreground fan-out keeps the turn open until every item settles; use `background: true` for work that must outlive the turn.
- Child event streaming is tailed from the child session store; it is not a separate IPC channel.
- Retry is limited to one retry for transport-style failures with no committed assistant output.
