# Hot reload

> Manual runtime reload of agents, skills, plugins, and commands without restarting the TUI.

## Source

- Registry: `packages/code/src/runtime/registry.ts` — monotonic revision and domain notifications.
- Coordinator: `packages/code/src/runtime/reload.ts` — cache invalidation and domain reloads.
- Agent refresh: `packages/code/src/tui/hooks/use-agent.ts` — idle agents reconfigured via `Agent.configure`; streaming agents wait for the next turn.
- App: `packages/code/src/tui/app.tsx` — subscribes to the registry, refreshes catalog/skill/command state.
- Command: `packages/code/src/tui/commands.ts` — `/reload`.
- Plugins: `packages/code/src/plugins/host.ts` — `reloadAll()` and change notification.

## Registration / gating

- Always available; `/reload` runs the default domains.
- No file watcher yet. Reload is explicit.
- Plugin manager reload/toggle marks the `plugins` domain.
- `runtimeRegistry.subscribe` is the only notification path.

## Domains

| Domain | Reload action |
|---|---|
| `agents` | Invalidate the agent catalog, re-scan `.spectra/agents`, `.claude/agents`, and user agents |
| `skills` | Invalidate the skill catalog, re-scan bundled/evolving/user/project skills |
| `plugins` | Reload every active plugin through the host |
| `commands` | Invalidate command/template-derived UI state |
| `context` | Re-read instruction files on the next agent configure |
| `tools` | Refresh custom/plugin tools on the next agent configure |

`mcp`, `providers`, and `settings` are accepted domain names but not yet reloaded by the coordinator.

## Flow

1. `/reload` calls `reloadRuntime()`.
2. Selected caches are invalidated; agent catalog and skill catalog are warmed.
3. Active plugins are reloaded; each reload is isolated.
4. `runtimeRegistry.mark(domains)` bumps the revision and notifies subscribers.
5. `App` re-runs catalog, skill-command, template, and command-registry effects.
6. `useAgent.refreshAgents()` reconfigures every idle agent with `Agent.configure`; streaming agents keep their current config.
7. The runtime fingerprint includes the registry revision, so a reloaded tool with the same name/description/schema is applied on the next turn.

## State / persistence

- Registry and revisions are process-local.
- Session history is preserved; `configure` never replaces it.
- Streaming turns are not aborted. Their config is applied on the next non-streaming `getOrCreateAgent`.

## Security

- Reload does not bypass permissions; tools still go through the security wrapper.
- Plugin reload keeps the plugin’s `plugin:<id>` permission identity.
- A failed domain reload reports an error and leaves the previous good registry in place where possible.

## Errors

| Condition | Result |
|---|---|
| Agent catalog load fails | `agents: <message>` in the reload result; previous catalog remains |
| Skill catalog load fails | `skills: <message>` |
| Plugin reload fails | `plugins: <message>`; plugin marked failed by its own lifecycle |
| Streaming agent | Configuration is deferred, not applied mid-turn |

## Limitations

- No file watcher; reload is manual.
- MCP reconnection, custom providers, and settings re-registration are not part of the coordinator yet.
- Removed agent definitions are not automatically remapped to a fallback in this iteration.
- Running subagent/job turns keep their config until their next turn.

## Tests

- `packages/code/src/__tests__/runtime-reload.test.ts` — revision/domain notification and agent catalog invalidation.
- `packages/code/src/__tests__/plugin-host.test.ts` — plugin schema validation, reload isolation, and failure cleanup.
