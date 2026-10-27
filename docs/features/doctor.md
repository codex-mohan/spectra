# Doctor

> `runDoctor()` performs a read-only health sweep of the runtime, configuration, tools, directories, provider registry, and terminal, returning pass/warning/error rows that the CLI prints and the TUI shows in a scrollable dialog.

## Source

- Entry: `packages/code/src/commands/doctor.ts` — `runDoctor()`, `getProviderReadiness()`, `DoctorResult`/`DoctorCheck`/`DoctorCheckStatus`.
- TUI rendering: `packages/code/src/tui/ui/doctor-dialog.tsx` — `DoctorDialog`, section grouping, one-line rows, scrollbox.
- CLI rendering: `packages/code/src/cli.ts:449-467` — `spectra doctor`.
- Collaborators:
  - `packages/code/src/utils/paths.ts` — `getGlobalConfigDir()`, `getGlobalDataDir()`, `getGlobalCacheDir()`; all derive from `SPECTRA_HOME` or `~/.spectra`.
  - `packages/code/src/utils/platform.ts` — `getPlatformInfo()` supplies OS, arch, and the resolved shell.
  - `packages/code/src/services/config.ts` — `loadConfig(cwd)`.
  - `packages/code/src/services/auth-store.ts` — `readAll()` credentials.
  - `packages/code/src/services/provider-connection.ts` — `isCredentialConnected()`.
  - `packages/code/src/tui/commands.ts:979-992` — the `/doctor` palette item runs the check, then opens the dialog.
  - `packages/code/src/tui/ui/modal-frame.tsx` — overlay frame used by the dialog.

## Registration / gating

- CLI: `spectra doctor` (`cli.ts:449-467`) is a yargs command; the default TUI command does not run it.
- TUI: `/doctor` sets `dialogStep` to `{ type: 'doctor', result: null }`, dynamically imports the module, runs `runDoctor()`, then sets `{ type: 'doctor', result }` (`tui/commands.ts:979-992`). The dialog renders only when `result` is non-null (`app.tsx:1233`).
- No config key or permission profile applies. Every check is read-only: files are probed with `existsSync`/`statSync`/`accessSync`, commands are executed for version strings, and the provider registry is imported.
- Directory checks deliberately do not create missing directories; a missing directory passes with "(created on first use)" (`doctor.ts:104-118`).

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `runDoctor()` | — | — | Takes no arguments; reads `process.env`, `process.cwd()`, `process.versions`, and `process.stdout` directly. |
| `getProviderReadiness(config, credentials, now?, env?)` | `SpectraConfig`, `Record<string, Credential>`, `number`, `NodeJS.ProcessEnv` | first two | `now` defaults to `Date.now()`; `env` defaults to `process.env`. Exposed for testing. |
| `DoctorDialog.result` | `DoctorResult` | yes | Rows to render. |
| `DoctorDialog.termWidth` / `termHeight` | `number` | yes | Dialog width is fixed at 68, clamped by `ModalFrame` to `termWidth - 4`; height is `min(32, termHeight - 4)`. |
| `DoctorDialog.registerHandler` | `(fn) => void` | no | Lets the app route `escape`/`enter` to `onClose`. |

## Outputs

- `DoctorResult { checks, allPassed, hasWarnings }`; `allPassed` is true when no check has status `error` (warnings do not fail it) (`doctor.ts:218-222`).
- Each `DoctorCheck { section, name, passed, status, detail }`; `passed` is exactly `status === 'pass'`.
- CLI: header `Spectra Code — System Health Check`, one `✓`/`!`/`✗` line per check with its detail, a summary line, and `process.exit(allPassed ? 0 : 1)` (`cli.ts:456-466`).
- TUI: title `✓ All checks passed`, `! N warning`/`! N warnings`, or `✗ N required checks failed`; rows show an icon, truncated name (35% of inner width), and truncated detail; footer `esc/enter close`; body is a vertical `scrollbox`.
- Files: none written. No repair action exists.

## Flow

Checks are appended in this order (`doctor.ts:84-222`):

1. `system` / Platform — always `pass`, detail `${os} (${arch})`.
2. `system` / Shell — runs the resolved shell; on Windows always `powershell.exe` (or `pwsh` when configured), otherwise the configured shell with `--version`. Failure is `error`.
3. `system` / Bun runtime — `pass` only when `process.versions.bun` is set; otherwise `error` explaining the current runtime.
4. `system` / Working directory — `existsSync(process.cwd())`.
5. `config` / Configuration — always `pass`; detail shows model/provider or notes built-in defaults. An empty config is not a failure.
6. `config` / Model selection — `warning` when `config.model` is empty.
7. `config` / Provider authentication — `pass` when `getProviderReadiness().credentialConnected`, otherwise `warning` naming the provider to connect.
8. `tools` / ripgrep — runs `rg --version` (`rg.exe` on Windows); missing is `error` because grep/glob require it.
9. `tools` / git — runs `git --version`; missing is `warning` and reports that snapshots, revert, and Git context are disabled.
10. `directories` / Config dir, Data dir, Cache dir — missing passes with "(created on first use)"; a non-directory or unreadable/unwritable path is `error`.
11. `providers` / Provider registry — dynamic import of `@mohanscodex/spectra-ai`, `listProviders()`; empty or import failure is `error`.
12. `terminal` / Interactive terminal — `process.stdout.isTTY`; false is `warning`.
13. `terminal` / TERM — `TERM` or `TERMINAL`; unset is `warning`.
14. `terminal` / Size — `process.stdout.columns && rows`; unset is `warning`.

Provider readiness (`doctor.ts:53-82`) resolves the provider from `config.provider`, else the prefix of `config.model`; aliases `openai-completions`/`openai-responses` canonicalize to `openai`. A provider counts as connected when it is a local no-auth provider (`ollama`, `lm-studio`, `llama-cpp`, `vllm`, `sglang`), has an unexpired stored credential, or has a provider-specific environment key. With no provider selected, any stored credential, enabled custom provider with an `apiKey`, or any known environment key is accepted.

## State / persistence

- Pure function of the environment; no state is retained between runs.
- `runDoctor()` does not create directories, write config, or modify credentials.
- The TUI dialog keeps only its scroll position via a local ref and closes on `escape`/`enter`.
- `/doctor` runs the full sweep each time; there is no cache.

## Security

- Read-only by construction: probes use `existsSync`, `statSync`, `accessSync(R_OK | W_OK)`, and `execFileSync` with 2 s timeouts and stderr discarded (`doctor.ts:91-102`).
- Credentials are read through `readAll()` but only used for `isCredentialConnected`; key material is never included in details.
- Details can contain absolute paths and provider ids; the TUI truncates them to fit and the CLI prints them verbatim.
- The provider check inspects a fixed environment-key table (`ANTHROPIC_API_KEY`, `ANTHROPIC_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `AZURE_OPENAI_API_KEY`, `CEREBRAS_API_KEY`, `XAI_API_KEY`) and reports only presence.

## Errors

| Condition | Result |
| --- | --- |
| Shell executable missing or exits non-zero | `system/Shell` status `error`, detail "`<shell>` could not be executed". |
| Not running under Bun | `system/Bun runtime` status `error`, detail names the current runtime. |
| `rg` missing | `tools/ripgrep` status `error`. |
| `git` missing | `tools/git` status `warning`. |
| Config/Data/Cache path exists but is not a directory, or is not readable/writable | `directories/*` status `error` with the OS message. |
| Provider registry import fails | `providers/Provider registry` status `error` with the exception message. |
| No model selected / no credential | `warning`, not `error`; `allPassed` can still be true. |
| Any `error` check | CLI exits `1`; TUI title counts required failures. |

## Limitations

- There is no repair mode. Failures identify a condition but never create directories, install tools, or connect providers.
- `config/Configuration` and `system/Platform` always pass, so they carry information rather than diagnostics.
- The shell check verifies that a version command runs, not that the shell can execute project commands or that the configured shell matches the terminal.
- Provider readiness is a heuristic: it accepts local providers and environment keys without contacting the provider, and it does not validate that the selected model exists.
- `getProviderReadiness` checks a fixed set of provider environment variables; custom providers are recognized only through `providers.<id>.apiKey`.
- Missing directories report `pass` with "(created on first use)", so a fresh install looks healthy before any directory exists.
- The dialog has no re-run key and no copy/export; output is only the rendered rows.
- Checks run sequentially on the main thread; each external probe is capped at 2 s.

## Tests

- `packages/code/src/__tests__/doctor.test.ts` — `getProviderReadiness` recognizes stored API keys, unexpired OAuth credentials, rejects expired OAuth, recognizes custom-provider keys and local no-auth providers, honors provider environment keys and registry aliases, and ignores a legacy top-level `apiKey`. For `runDoctor`, it asserts severity drives `allPassed`/`hasWarnings`, that no `fd` check is emitted, that `Configuration` passes and the ripgrep detail makes no "faster" claim, and that the cache directory is not created during diagnostics.

## Related

- [config.md](config.md) — configuration loading and defaults reported by the config checks.
- [providers.md](providers.md), [model-service.md](model-service.md) — provider registry and credential resolution.
- [permissions.md](permissions.md) — security config that doctor does not validate.
- [tui-shell.md](tui-shell.md) — `/doctor` overlay wiring.
- [sessions.md](sessions.md), [snapshots.md](snapshots.md) — features disabled when git is unavailable.
