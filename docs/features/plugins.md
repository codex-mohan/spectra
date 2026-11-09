# Plugins

> Local, trusted Cordis-style plugins contribute tools, commands, prompt sections, settings, and lifecycle hooks without editing central composition files.

## Source

- Runtime: `packages/code/src/runtime/types.ts`, `hooks.ts` — plugin contracts, effects, hook bus.
- Host: `packages/code/src/plugins/host.ts` — discovery, manifests, dynamic import, activation, contributions, enable/disable/reload, diagnostics.
- UI: `packages/code/src/tui/ui/plugins-dialog.tsx` — plugin manager; plugin settings render through the Phase 5 registry.
- Integrations: `tools/index.ts` (plugin tools + hooks), `services/context.ts` (prompt sections), `tui/commands.ts` (commands), `hooks/use-agent.ts` / `use-chat-submit.ts` (session and turn hooks).

## Registration / gating

- Discovery: `<cwd>/.spectra/plugins/<dir>/plugin.json`, `<configDir>/plugins/<dir>/plugin.json`, and `plugins[]` config entries with `path`.
- Enabled by default; `plugins[].enabled: false` disables a plugin.
- `/plugins` opens the manager; `enter` toggles, `r` reloads.
- Permission identity for plugin tools defaults to `plugin:<id>`.

## Inputs

| File/field | Required | Description |
| --- | --- | --- |
| `plugin.json.id` | yes | Stable plugin id |
| `plugin.json.entry` | yes | Relative ESM entry file |
| `plugin.json.requires` | no | Required service ids |
| `plugin.json.capabilities` | no | Declared capabilities (documentation in this MVP) |
| `plugins[].config` | no | Plugin configuration passed to `setup()` |

Plugin module:

```js
export default {
  setup(ctx) {
    ctx.tools.register({ name: 'echo', description: 'Echo', parameters: {}, execute: async () => ({ content: [] }) });
    ctx.commands.register({ id: 'demo:hello', name: 'hello', aliases: [], title: 'Hello', description: 'Demo', source: 'plugin', execute: () => ({ type: 'show_toast', message: 'hi' }) });
    ctx.prompts.section({ id: 'demo', order: 120, text: 'Use the echo tool when asked.' });
    ctx.settings.register({ key: 'enabled', type: 'boolean', default: true, description: 'Demo setting' });
    ctx.hooks.on('tool.beforeExecute', (payload) => payload.toolName === 'rm_rf' ? { block: true, reason: 'nope' } : undefined);
  },
};
```

## Outputs

- Tools merge into the agent toolset.
- Commands merge into slash/palette with source `plugin`.
- Prompt sections append to the system prompt in order.
- Settings appear in `/settings` under `Plugins · <name>` and in `spectra config` by path `pluginSettings.<id>.<key>`.
- Hooks run in priority order.

## Hook surface (MVP)

| Hook | Result |
| --- | --- |
| `tool.beforeExecute` | `{ block?, reason? }` |
| `tool.afterExecute` | `{ result? }` |
| `prompt.sections` | `{ text, order? }` |
| `session.start` / `session.end` | observe |
| `agent.turnEnd` | observe |
| `command.beforeExecute` | `{ block?, reason? }` |

## Flow

1. `launchTui` awaits `pluginHost.initialize()` before rendering.
2. Each enabled plugin is imported with a cache-busting URL, `setup(ctx)` runs with a 10 s activation timeout.
3. Registrations are effects; disposal runs in reverse order.
4. A throwing hook is contained, the plugin is marked `failed`, and its hooks are removed; the turn continues.
5. `setEnabled` disposes/reloads the plugin and writes `plugins[].enabled` to the project config.
6. `shutdown` disposes all plugins and clears dynamic settings.

## State / persistence

- Plugin enablement persists in the project config.
- Plugin settings persist under `pluginSettings`.
- Plugin instances are process-local; reloading re-imports the entry.
- No plugin code is written to session history.

## Security

- Plugins are trusted in-process code; there is no sandbox.
- Plugin tools go through the normal security wrapper and use `plugin:<id>` as their permission identity.
- Declared `capabilities` are documentation-only in this MVP.
- Hook errors are contained per handler.

## Errors

| Condition | Result |
| --- | --- |
| Missing/invalid `plugin.json` | plugin listed as `failed` with a diagnostic |
| Missing entry/module | `failed` with the import error |
| Setup throws/times out | `failed`, no contributions retained |
| Hook throws | plugin disabled, error recorded once, hook removed |
| Missing required service | `failed` with the missing ids |

## Limitations

- Local plugins only; no marketplace, remote install, or signatures.
- No service dependency reactivation graph; `requires` is checked once at activation.
- No arbitrary UI components or slot registry; plugin UI is limited to settings, commands, and prompts.
- No browser-half or dynamic model-written plugins.
- Capabilities are not enforced.
- Plugin reload does not rebuild already-created agents; new sessions see updated contributions.

## Tests

- `packages/code/src/__tests__/plugin-host.test.ts` — discovery, contribution unload/reload, settings, prompt sections, hook blocking, throwing-hook isolation.
