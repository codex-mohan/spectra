# Agent IRC

> Route messages between the calling parent agent and running child subagents by job id.

## Source

- Entry: `packages/code/src/tools/irc.ts`
- Collaborators: `services/job-control.ts` (handle registry), `services/job-registry.ts`, `packages/agent/src/agent.ts` (`steer`, `requestPause`, `restoreHistory`)

## Registration / gating

- Registered by: `createAllToolsWithSecurity`
- Enabled by: session context
- Permission profile: `write`

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `send \| inbox` | yes | Operation |
| `to` | `string` | send | Target job/child id |
| `message` | `string` | send | Plain-text message |
| `await` | `boolean` | no | Wait for a reply before returning |
| `replyTo` | `string` | no | Message id being answered |

## Outputs

- `send`: acknowledgement with delivery result
- `inbox`: queued inbound messages; with `peek`, without consuming
- `await`: blocks until a message arrives or the timeout elapses

## Flow

1. `send` looks up the job handle; a running job is steered mid-turn (`Agent.steer`), a paused job resumes with the message as the next instruction.
2. The child's outgoing messages are collected through the subagent stream and delivered to the parent's inbox.
3. The parent drains inbox messages between turns; no filesystem or shell access is granted.

## State / persistence

- Inbox state is in memory per parent process; messages are not persisted across restarts.
- Job targeting and child history live in the job registry and session store.

## Security

- The parent and child share the same process-level permissions; IRC grants no additional capabilities.
- Messages are plain text; no JSON status protocol is used.

## Errors

| Condition | Result |
| --- | --- |
| Unknown target | `Job <id> not found` |
| Send to a completed job with no handle | Delivery refused |
| Wait timeout | Returns empty without failing the turn |

## Limitations

- Replies are not persisted; a restart loses unread inbox messages.
- Steering a running child requires the provider adapter to be actively streaming.
