# Feature Contracts

One page per subsystem: source entry points, gating, inputs, outputs, flow, state, security, errors, limitations, tests.

Rules:

- Every user-visible feature or subsystem has exactly one page here, linked from the index below.
- Any change to a feature updates its page in the same commit. New feature → new page + new index row.
- Copy `_TEMPLATE.md`; keep the section order.
- Scheduled work and status live in `PHASES.md` (repo root). This folder describes what exists, not what is planned.
- Document limitations in prose. Never encode them in class or type names.

## Index

| Feature | Page | Source | Phase | Status |
| --- | --- | --- | --- | --- |
| Agent loop | [agent-loop.md](agent-loop.md) | `packages/agent/src/agent.ts` | 0 | documented |
| Providers | [providers.md](providers.md) | `packages/ai/src/providers/` | 0 | documented |
| Tool registry | [tool-registry.md](tool-registry.md) | `packages/agent/src/define-tool.ts`, `packages/code/src/tools/index.ts` | 0 | documented |
| Read tool | [read.md](read.md) | `packages/code/src/tools/read.ts` | 0 | documented |
| Write tool | [write.md](write.md) | `packages/code/src/tools/write.ts` | 0 | documented |
| Edit tool | [edit.md](edit.md) | `packages/code/src/tools/edit.ts` | 0 | documented |
| Hashline patcher | [hashline.md](hashline.md) | `packages/code/src/tools/hashline/` | 0 | documented |
| Shell tool | [shell.md](shell.md) | `packages/code/src/tools/shell.ts` | 0 | documented |
| Search tools | [search.md](search.md) | `packages/code/src/tools/glob.ts`, `grep.ts` | 0 | documented |
| Web fetch | [web-fetch.md](web-fetch.md) | `packages/code/src/tools/web-fetch.ts` | 0 | documented |
| Web search | `web-search.md` | `packages/code/src/tools/web-search/` (new) | 2 | planned |
| LSP | `lsp.md` | `packages/code/src/lsp/`, `packages/code/src/tools/lsp.ts` (new) | 3 | planned |
| Browser | `browser.md` | `packages/code/src/browser/` (new) | 6 | planned |
| MCP client | [mcp-client.md](mcp-client.md) | `packages/code/src/integrations/mcp/` | 0 | documented |
| ACP server | [acp-server.md](acp-server.md) | `packages/code/src/integrations/acp/server.ts` | 0 | documented |
| Permissions and security | [permissions.md](permissions.md) | `packages/code/src/security/` | 0 | documented |
| Sessions | [sessions.md](sessions.md) | `packages/code/src/services/session-store.ts` | 0 | documented |
| Snapshots and revert | [snapshots.md](snapshots.md) | `packages/code/src/services/snapshot-manager.ts` | 0 | documented |
| Commands and templates | [commands-templates.md](commands-templates.md) | `packages/code/src/command/` | 0 | documented |
| Skills | [skills.md](skills.md) | `packages/code/src/services/skill-store.ts` | 0 | documented |
| Subagents | `subagents.md` | `packages/code/src/tools/task.ts` | 4 | planned |
| Job tool | `job.md` | `packages/code/src/tools/job.ts` (new) | 4 | planned |
| Agent IRC | `irc.md` | `packages/code/src/tools/irc.ts` (new) | 4 | planned |
| Model service | [model-service.md](model-service.md) | `packages/code/src/services/model-service.ts` | 0 | documented |
| Config | [config.md](config.md) | `packages/code/src/services/config.ts` | 0 | documented |
| Custom providers and auth | [custom-providers.md](custom-providers.md) | `packages/code/src/services/custom-providers.ts`, `auth-store.ts` | 0 | documented |
| TUI shell | [tui-shell.md](tui-shell.md) | `packages/code/src/tui/app.tsx` | 0 | documented |
| Input lifecycle | `input-lifecycle.md` | `packages/code/src/tui/hooks/use-app-keyboard.ts` | 1 | planned |
| Settings | `settings.md` | `packages/code/src/tui/ui/settings/` (new) | 5 | planned |
| Doctor | [doctor.md](doctor.md) | `packages/code/src/commands/doctor.ts` | 0 | documented |
| Context compaction | [context-compaction.md](context-compaction.md) | `packages/code/src/services/compaction.ts` | 0 | documented |
| Todo tool | [todo-tool.md](todo-tool.md) | `packages/code/src/tools/todo.ts` | 0 | documented |
| Memory tool | [memory-tool.md](memory-tool.md) | `packages/code/src/tools/memory.ts` | 0 | documented |
| Custom tools | [custom-tools.md](custom-tools.md) | `packages/code/src/integrations/custom-tools/` | 0 | documented |
| Plugins | `plugins.md` | `packages/code/src/plugins/` (new; plan: `docs/plans/plugin-system-plan.md`) | 7 | planned |

Status values: `pending` (feature exists, page not written), `planned` (feature does not exist yet), `documented`.
