# Settings

> One typed registry drives the tabbed TUI editor, `spectra config`, validation, and defaults for every user-editable setting.

## Source

- Entry: `packages/code/src/config/registry.ts` — `SETTINGS`, `SETTINGS_TABS`, typed paths, parsing/validation, atomic scoped writes, debounced `SettingsWriter`, config watcher.
- Entry: `packages/code/src/tui/ui/settings-dialog.tsx` — ten-tab editor with fuzzy search, scope switching, and inline editing.
- Entry: `packages/code/src/tui/ui/settings-state.ts` — navigation, filtering, row building, commit/reset helpers.
- Entry: `packages/code/src/commands/config.ts` — `list | get | set | reset | path`.
- Collaborators:
  - `packages/code/src/services/config.ts` — merged runtime config consumed by every service.
  - `packages/code/src/cli.ts` — `spectra config` command wiring.
  - `packages/code/src/tui/commands.ts` — `/settings`, `/theme`, `/permissions` deep links.

## Registration / gating

- Registry is module-level and static; there is no plugin registration point yet.
- Every `path` is compile-time checked against `SpectraConfig` via `SettingPath`.
- CLI actions are always available. The TUI editor opens from `/settings` (alias `/config`), `/theme` (Appearance tab), and `/permissions` (Interaction tab).
- Permission profile: writes configuration files only; no approval prompt for settings edits.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | dotted string | yes | Setting key, e.g. `tools.lsp.enabled` |
| `value` | typed | set only | Parsed as number, boolean, enum member, string, or JSON |
| `scope` | `global \| project` | no | CLI option (`--scope`); TUI toggles with `s`; default `global` for CLI, `project` for the TUI |
| `json` | boolean | no | CLI `--json` output |

The registry covers appearance (`theme`, `logLevel`), model (`model`, `smallModel`, `provider`, `apiKey`), interaction (`agent`, approval mode/policy, permission rules), context (`safety.*`), memory (`memory.*`, deprecated `skills.*`), files (`security.writeGuard*`, blocked/allowed paths, references), shell (`shell`, `commands.shellExecution`), tools (web search, LSP, SSRF, doom loop), tasks (auto-background, concurrency, runtime), and providers (`providers`, `mcp`, `plugins`).

## Outputs

- `SettingsWriter` → atomic writes: read under lock file, merge staged paths, write `<file>.<pid>.<ts>.tmp`, rename over the target.
- CLI → human lines or JSON; `list` masks secrets and annotates each value with its owning scope (`project`, `global`, `default`).
- TUI → editable rows with scope badge (`P`/`G`/`·`), changed (`*`) badge, restart badge, section labels, and search.
- Files: `<SPECTRA_HOME>/spectra.json`, `<cwd>/.spectra/spectra.json`.

## Flow

1. CLI parses the action; `set` looks up the registry entry, parses and validates the raw value, then writes one scope atomically.
2. TUI builds rows from the registry, reading project first, then global, then the registry default.
3. `enter` opens an inline editor; `enter` again validates and writes; invalid values show the error and never touch disk.
4. `s` toggles the write scope; `r` removes the key from that scope; `/` fuzzy-searches across all ten tabs.
5. `SettingsWriter` coalesces repeated edits for 100 ms per key and flushes once per scope, re-reading the file first so unrelated edits are preserved.
6. `watchConfigFiles` watches both scope directories with a 100 ms debounce; invalid JSON is reported invalid and the UI keeps its last good rows.

## State / persistence

- Project layer wins over global; defaults only fill unset values.
- Unknown keys in a file are preserved on write.
- Deprecated `skills.*` keys remain visible but are documented as no-ops.
- No settings are held in memory beyond the editor session; every read is from disk.

## Security

- `list` and TUI display mask values whose key matches `apiKey`, `token`, `secret`, `password`, or `authorization`, including nested provider headers.
- Files are written with mode `0600` where the platform supports it.
- Write lock file prevents two Spectra writers from interleaving; rename is atomic on the same volume.
- `get` is not masked because the caller explicitly requested one key.

## Errors

| Condition | Result |
| --- | --- |
| Unknown setting | `Unknown setting "<key>"`; exit 1 |
| Invalid number/boolean/enum/JSON | Validation message; file untouched |
| Invalid `--scope` | `Unknown scope`; exit 1 |
| Invalid JSON on disk | Watcher reports invalid; UI keeps last-good values; writes replace the invalid file only through an explicit edit |
| Lock contention | Retries for ~200 ms before writing |

## Limitations

- Arrays and objects (`providers`, `mcp`, `plugins`, `permissions`, LSP config) are edited as raw JSON, not as structured forms.
- No profiles, no YAML migration, no ancestor discovery beyond the existing config loader.
- `theme` persists but the palette is currently static.
- Restart badges are advisory; services that cache configuration are not hot-restarted.
- Interprocess locking is best-effort (lock file with a short retry window).

## Tests

- `packages/code/src/config/__tests__/registry.test.ts` — registry invariants, scope routing, invalid-write rejection, debounce/preservation, secret masking, navigation/search, CLI actions, watcher.

## Related

- [Config](config.md)
- [TUI shell](tui-shell.md)
