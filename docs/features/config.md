# Config

> Layered JSON/JSONC settings merged from the Spectra home directory and every ancestor project directory, with environment overrides applied last.

## Source

- Entry: `packages/code/src/services/config.ts` — `SpectraConfig` shape, `loadConfig`, `saveConfig`, merge rules, per-scope MCP helpers, effective model/provider defaults.
- Entry: `packages/code/src/config/registry.ts` — settings metadata, typed parsing/validation, atomic scoped writes, watcher (`docs/features/settings.md`).
- Entry: `packages/code/src/commands/config.ts` — `spectra config list|get|set|reset|path`.
- Entry: `packages/code/src/utils/paths.ts` — `SPECTRA_HOME` resolution and directory discovery (`getSpectraHomeDir`, `discoverConfigDirs`, `discoverCompatibilityDirs`).
- Collaborators:
  - `packages/code/src/cli.ts:304,327` — writes the merged config back after `spectra mcp add|remove`.
  - `packages/code/src/commands/mcp.ts:100,122` — same for MCP edits made through the command module.
  - `packages/code/src/tui/hooks/use-agent.ts:81,426` — persists newly allowed permission rules through `saveConfig`.
  - `packages/code/src/tui/utils/model-config.ts:44-59` — `saveModelConfig` writes only `model` and `provider` into the global file.

## Registration / gating

- Registered by: no registry. Modules call `loadConfig()` on demand; the TUI loads it during `App` state initialization and again per session directory (`use-agent.ts:139`).
- Enabled by: always; when no file exists `loadConfig` returns `{}` and callers apply defaults.
- Roots: `SPECTRA_HOME` if set (resolved), else `~/.spectra` (`paths.ts:5-8`). `getGlobalConfigDir`, `getGlobalDataDir`, and `getSpectraHomeDir` all return that same root; cache lives in `<root>/cache`, state in `<root>/state`.
- Permission profile: read for loading; write for the MCP and permission helpers.

## Settings registry and CLI

- `SETTINGS` enumerates every user-editable path with tab, section, type, default, options, secret/restart flags, and optional validator. Paths are compile-time checked against `SpectraConfig`.
- `spectra config list` prints effective values with owning scope and masks secrets; `--json` emits the merged config.
- `spectra config get <path>` reads the effective value; `set` and `reset` write one scope (`--scope global|project`, default global).
- `/settings` opens the registry-driven TUI editor; edits write the project scope by default and can switch to global with `s`.
- Writes are atomic (temp + rename) under a lock file and re-read the file first, so disjoint edits survive.

## Browser settings

```jsonc
{
  "browser": {
    "enabled": true,
    "executablePath": "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "cdpUrl": "",
    "headless": true,
    "idleCloseSec": 1800,
    "timeoutMs": 30000,
    "allowedDomains": ["example.com", "*.example.com"],
    "screenshotDir": "",
    "persistProfile": false
  }
}
```

- `executablePath` falls back to `SPECTRA_CHROME_PATH`, Chrome, then Edge.
- `cdpUrl` attaches to an existing browser instead of launching.
- `allowedDomains` is a request allowlist; an empty list permits public hosts subject to SSRF blocking.
- See [Browser](browser.md) for lifecycle and tool contracts.

## Safety settings

```jsonc
{
  "safety": {
    "repetition": { "enabled": true, "minRepeats": 4, "minUnitChars": 24 },
    "outputBloat": { "warnBytes": 50000, "truncateBytes": 200000 }
  }
}
```

- `repetition` accepts `false`, `'warn'`, `true`, or an object with `enabled`, `minRepeats`, `minUnitChars`.
- `outputBloat.warnBytes` controls the agent's warning event; `truncateBytes` controls the tool wrapper's artifact spill (0 disables). `read`, `grep`, and `glob` are exempt because they already bound output.
- `security.doomLoop.ask: true` asks before continuing an identical-call loop; default `false` keeps the current block behavior.
- These keys merge across global and project config like every other setting; no separate env override exists.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | `string` | no | `provider/model` selection; default from `getEffectiveModel`. |
| `smallModel` | `string` | no | Secondary model key read by consumers. |
| `provider` | `string` | no | Defaults to the text before `/` in `model`, else `anthropic`. |
| `apiKey` | `string` | no | Plaintext provider key. |
| `agent` | `string` | no | Default agent definition. |
| `theme` | `'dark' \| 'light'` | no | TUI palette. |
| `mcp` | `McpConfig[]` | no | MCP servers; merged by `name`. |
| `plugins` | `PluginConfig[]` | no | Plugin entries; merged by `name`. |
| `permissions` | `PermissionRule[]` | no | Rule list; merged by `name`. |
| `permission` | `PermissionConfig` | no | Deep-merged permission object. |
| `security` | `SecurityConfig` | no | Deep-merged security object. |
| `providers` | `Record<string, CustomProviderConfig>` | no | Custom OpenAI-compatible providers. |
| `references` | `ProjectReferenceConfig[]` | no | Extra directories; merged by `name`. |
| `memory` | `MemoryConfig` | no | `enabled`, `projectScope`. |
| `skills` | `SkillsConfig` | no | Legacy `autoSynthesize` / `confirmBeforeSave` keys, both marked deprecated. |
| `commands` | `CommandConfig` | no | `shellExecution` for templates. |
| `shell` | `string` | no | Preferred shell. |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error'` | no | Log verbosity. |

Environment inputs: `SPECTRA_HOME`, `SPECTRA_CONFIG` (JSON object), `SPECTRA_PROVIDER`, `SPECTRA_MODEL`, `SPECTRA_API_KEY` (falls back to `ANTHROPIC_API_KEY`, then `OPENAI_API_KEY`).

## Outputs

- `loadConfig(cwd?)` → fully merged `SpectraConfig`.
- `readConfigFile(path)` → one file's contents without layer merging.
- `mcpScopePath(scope, cwd?)` → `<cwd>/.spectra/spectra.json` or `<home>/spectra.json`.
- `findMcpScope(name)` → `'project' | 'global' | undefined`; `saveMcpServer`, `removeMcpServerConfig`, `setMcpServerEnabled` mutate one file and return the affected scope or a boolean.
- `saveConfig(cfg, filePath?)` → writes pretty-printed JSON (2 spaces) to `<home>/spectra.json` unless a path is given.
- Files: any of `spectra.json`, `spectra.jsonc`, `config.json`, `config.jsonc` inside each `.spectra` directory.

## Flow

1. `discoverConfigDirs(cwd)` appends the global home first, then walks ancestors of `cwd` up to the user's home, adding each existing `<ancestor>/.spectra` in root-to-cwd order (`paths.ts:51-62`). The home directory's own `.spectra` is skipped during that walk because the home root is already the global layer.
2. `loadConfig` visits every discovered directory and, within it, every filename in the fixed order `spectra.json`, `spectra.jsonc`, `config.json`, `config.jsonc` (`config.ts:89,129-141`). Later files therefore override earlier ones.
3. Each file is parsed with `safeJsonParse`: strict `JSON.parse` first, then a retry after regex removal of `//` line comments (not preceded by `:` or `"`) and `/* … */` blocks (`:255-265`).
4. Merging is recursive for plain objects. Arrays under `mcp`, `plugins`, `permissions`, and `references` merge by `name`, merging entries with the same name and appending new ones; every other array is replaced wholesale (`:92-127`).
5. `SPECTRA_CONFIG`, when set, is parsed and merged after all files; then `provider`, `model`, and `apiKey` are overwritten from environment variables when present (`:143-158`).
6. `getEffectiveModel` returns `cfg.model` or `anthropic/claude-sonnet-4-20250514`; `getEffectiveProvider` returns `cfg.provider`, else the leading `model` segment, else `anthropic` (`:247-253`).
7. MCP edits bypass merging: `readConfigFile` reads exactly one scope file, the server array is modified, and `writeConfigFile` rewrites that file (`:180-245`).

## State / persistence

- No in-memory cache: `loadConfig` re-reads from disk on every call, so manual edits apply on the next load.
- `saveConfig` overwrites the target file entirely; keys not present in the passed object are dropped.
- MCP helpers preserve unrelated keys in the scope file they touch, but only within that file.
- Discovered config directories are never created by loading; only `saveConfig`/`writeConfigFile` create parent directories.

## Security

- Config files are plain JSON with no encryption; `apiKey` and `providers.*.apiKey` are stored in clear text.
- OAuth and API-key credentials entered through the provider dialog are stored separately in `<home>/auth.json` with mode `0600` (`auth-store.ts:53-58`), not in config.
- Only native `.spectra` directories are application config sources; `.claude`, `.agents`, and `.opencode` directories are exposed by `discoverCompatibilityDirs` for instruction/tool assets and are deliberately excluded from `discoverConfigDirs` (`paths.ts:64-76`; asserted in `config.test.ts:52-70`).
- Environment-provided keys override file values, which means a shell variable silently wins over the saved config.

## Errors

| Condition | Result |
| --- | --- |
| Unreadable or unparseable config file | Silently skipped (`catch {}`), no diagnostic. |
| Unparseable `SPECTRA_CONFIG` | Ignored; file/env layers remain. |
| `saveConfig`/`writeConfigFile` write failure | Exception propagates; TUI callers wrap it in `try/catch`. |
| `mcp` entry without a string `name` | Appended without deduplication during merge. |
| `findMcpScope` for an unknown name | `undefined`; `setMcpServerEnabled` returns `false`. |

## Limitations

- There is no config schema validation; unknown or wrongly typed keys are stored and handed to consumers as-is.
- `saveConfig` always writes the merged view it was given. Permission auto-allow (`use-agent.ts:77-82`) and CLI MCP edits load the merged config and write it to the global file, flattening project-level overrides into the global layer.
- `saveModelConfig` writes a minimal `{ model, provider }` object with no merge of other keys — it re-reads the global file first, but only re-adds those two fields.
- Comment stripping is regex-based and runs only when strict parsing fails, so a `.jsonc` file with a stray parse error may be mangled further before failing.
- There is no per-key provenance, so callers cannot tell whether a value came from a project file, the global file, or the environment.
- Deprecated `skills.autoSynthesize` and `skills.confirmBeforeSave` remain in the type although proposals are always explicit and always reviewed.

## Tests

- `packages/code/src/__tests__/config.test.ts` — single `SPECTRA_HOME` root for all global dirs; foreign compatibility dirs excluded from config discovery; deep merge across global, project, nearest project, and `SPECTRA_CONFIG`; named-array merge for `mcp` and `references`.

## Related

- [custom-providers.md](custom-providers.md) — consumes `providers` and writes credentials to `auth.json`.
- [model-service.md](model-service.md) — consumes `model`/`provider` and resolves catalogs.
- [skills.md](skills.md) — the deprecated `skills` keys.
- [tui-shell.md](tui-shell.md) — theme and startup loading.
