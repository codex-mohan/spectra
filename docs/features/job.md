# Job tool

> Durable, per-child background job control: list, wait, inspect, consume, pause, resume, restart, cancel, and exchange messages.

## Source

- Entry: `packages/code/src/tools/job.ts`
- Collaborators: `services/job-registry.ts` (state machine, persistence, delivery), `services/auto-background.ts`, `services/session-store.ts`

## Registration / gating

- Registered by: `createAllToolsWithSecurity`
- Enabled by: session context
- Permission profile: `write` (state mutation); approved like other orchestration tools

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `list \| get \| wait \| consume \| pause \| resume \| restart \| cancel` | yes | Operation |
| `ids` | `string[]` | no | Target ids; `consume` defaults to every settled job for the session |
| `mode` | `all \| first` | no | Wait mode, default `all` |
| `timeoutMs` | `number` | no | Wait window, default 30s, max 5 min |

## Outputs

- Result text listing each job's `id`, `state`, `agent`, duration, error, and result.
- `wait` returns the first/all settled job ids.
- `consume` marks results delivered and suppresses future completion injection.
- TUI transcript: job calls render as a structured card keyed by operation (`Job status`, `Wait for jobs`, `Cancel job`, …), with the job description as the display title, agent/state/elapsed, generation/retries, and activity. Long ids are shortened in the header and body. The card uses the Material Design console glyph (`md-console`), falling back to a laptop emoji when Nerd Font coverage is unavailable.

## Flow

1. Resolve owned ids (`forParent(sessionId)`), unless explicit ids are given.
2. `wait` polls the registry until the mode is satisfied or the deadline elapses; it does not block the agent loop's streaming.
3. State changes are compare-and-set transitions; stale generations cannot complete a job.
4. `pause` sets `pauseRequested` and asks the active agent to stop at the next tool boundary; `resume` restores child history; `restart` re-runs from start or the checkpoint.

## State / persistence

- `jobs.db` rows include state, generation, result, error, delivery flag, and `childSessionId`.
- `v2_jobs` migration adds `generation` and `delivery` to older databases.

## Security

- Jobs are scoped to the calling parent session; ids from other sessions are not returned by `list`.
- No filesystem exposure beyond session transcripts.

## Errors

| Condition | Result |
| --- | --- |
| Unknown id | Omitted from the result |
| Resume a running job | Error `Job <id> is running; pause it first` |
| Wait with no ids | Returns immediately |

## Limitations

- Wait is polling-based; no push notification into the tool call.
- Cancel aborts the child attempt but does not roll back files already written.
