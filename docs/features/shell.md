# Shell tool

> Runs one shell command on the user's machine and returns its combined output, invoked by the agent under the tool name `bash`.

## Source

- Entry: `packages/code/src/tools/shell.ts` — argument schema, process spawn, timeout/kill, output streaming, truncation.
- Collaborators:
  - `packages/code/src/tools/index.ts:33-51` — `shellTool` is part of `createBuiltinTools` / `builtinTools`.
  - `packages/code/src/tools/index.ts:64-184` — `wrapExecute` applies permission, external-directory, path-safety, write-guard, and doom-loop checks.
  - `packages/code/src/utils/platform.ts:5-49` — resolves the platform shell (`SHELL` on POSIX, PowerShell scan on Windows).
  - `packages/code/src/tools/types.ts:5-27` — `SpectraTool` shape, including `capabilities` and `streaming`.

## Registration / gating

- Registered by: `createBuiltinTools` in `packages/code/src/tools/index.ts:33-51`, exported through `builtinTools`.
- Enabled by: always; there is no config key that disables it. `config.shell` (`services/config.ts:28`) is declared but not read by this tool — the shell comes from `getPlatformInfo()`.
- Permission profile: shell; `capabilities: { reads: true, writes: true }` (`shell.ts:96`).
- `bash` is a file tool (`FILE_TOOL_NAMES`, `tools/index.ts:60`). The permission layer extracts paths from the command text, prompts for `external_directory` when a path escapes the working directory, then enforces path safety and the write guard.
- For `permission === "bash"` (or `"shell"`), `checkPermission` only tests the static blocked-command list and then returns without an approval prompt (`security/index.ts:281-306`); the `bash` tool name therefore never opens the permission dialog. Paths extracted from the command still go through `external_directory`, path-safety, and write-guard checks (`tools/index.ts:79-136`).

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `command` | `string` | yes | Command line passed to the platform shell. |
| `description` | `string` | no | Brief description; not used by execution. |
| `timeout` | `number` | no | Timeout in milliseconds. Defaults to `DEFAULT_TIMEOUT` (30 min) and is clamped to 60 min (`shell.ts:10,116`). |
| `workdir` | `string` | no | Working directory; defaults to `process.cwd()`. |

## Outputs

- Tool result: one text block containing stdout with stderr appended (newline separated), or `(no output)`.
- Details: `{ exitCode, command, truncated, outputPath?, wallTimeMs, timeoutMs }` (`ShellDetails`, `shell.ts:17-24`); `wallTimeMs` and `timeoutMs` are filled by `finalize`.
- Events: none directly; progress is delivered through `ctx.onUpdate` at most every 100 ms with a preview of the last 30,000 characters (`shell.ts:14-15,211-240`). Streaming display is declared as `{ arguments: true, output: true }` (`shell.ts:97`).
- Files: when output exceeds the truncation budget, the complete output is written to `<os tmpdir>/spectra-truncation/shell_<timestamp>_<random>.txt` and the path is prefixed to the result (`shell.ts:86-93,262-271`).

## Flow

1. Resolve platform and shell. Windows: use `pwsh`/`powershell` if configured, otherwise `powershell.exe`, with `-NoLogo -NoProfile -NonInteractive -Command <command>` (`shell.ts:120-136`). POSIX: `spawn(command, [], { shell: true, detached: true })` (`shell.ts:137-144`).
2. stdin is `'ignore'`; stdout and stderr are piped and accumulated as UTF-8 strings.
3. An abort listener and a timeout timer both call `kill()`; `kill()` terminates the process tree (`taskkill /f /t` on Windows, `SIGTERM` to the process group then `SIGKILL` after 200 ms elsewhere) (`shell.ts:27-53,172-200`).
4. If the exit event has not arrived 3.1 s after a kill, the tool force-resolves with `exitCode: -1`, `isError: true`, and a timeout message after a further 500 ms (`shell.ts:174-199`).
5. On `exit`, output is truncated with `tailText` (last 2000 lines and at most 50 KiB, UTF-8 boundary aware) and the full output is saved if truncation occurred (`shell.ts:60-84,244-282`).
6. `isError` is `exitCode !== 0`; spawn failures produce a cleaned error message with `exitCode: 1` (`shell.ts:284-302`).

## State / persistence

- No tool state. The only artifacts are truncation dumps in the OS temp directory; nothing is tracked or cleaned up by the tool.

## Security

- Commands execute with the full privileges of the user running Spectra and inherit `process.env` (`shell.ts:127,140`). There is no sandbox, allowlist, or command rewriting.
- The permission/path layer is applied by `wrapExecute` only when tools are built through `spectraToolToAgentTool(tool, security)`; tools built without a `SecurityManager` run unguarded.
- The static blocked-command list is evaluated inside `checkPermission('bash', ...)`. The file-tool branch only calls it when no path patterns were extracted; a command whose first word is a known file command and that carries a non-flag argument produces path patterns (`security/index.ts:107-135`), so the blocklist is skipped for it even though `external_directory` and path-safety checks still run (`tools/index.ts:90-99,113-125`).
- Interactive programs cannot be driven: stdin is ignored and no PTY is allocated.
- The tool description advises seeking permission for destructive commands, but enforcement lives entirely in the permission layer, not in the tool.

## Errors

| Condition | Result |
| --- | --- |
| Exit code non-zero | Normal text result with `isError: true` and the captured output. |
| Timeout or abort | Process tree killed; if needed, forced result with `exitCode: -1`, timeout text, `isError: true`. |
| Spawn failure (`error` event) | Text result with the error message and `exitCode: 1`, `isError: true`. |
| Command matches the static blocked list | `Permission denied: <message>` from `wrapExecute`, `isError: true`; the command never runs. |
| Extracted path is outside the allowed roots | `External file access denied: <message>` or `Path safety blocked: <pattern>`. |
| Output over budget | Truncated tail plus full-output file path in the text. |

## Limitations

- No PTY, no stdin, no job control, no background execution; long-running interactive commands hang until timeout.
- On Windows the tool always routes through PowerShell unless the resolved shell is `pwsh`/`powershell`; `cmd.exe` is never used, so cmd built-ins behave differently.
- stdout and stderr are concatenated rather than interleaved by timestamp, so ordering between the two streams is approximate.
- A killed process may still produce no exit event; the forced result then lacks the real exit code and may omit output written after the last stream chunk.
- The timeout ceiling is fixed at 60 minutes and cannot be raised per call.

## Tests

- `packages/code/src/__tests__/live-tool-streaming.test.ts:68` — asserts `getToolStreamingDisplay('bash')` is `{ arguments: true, output: true }`.
- No test in `packages/code/src/__tests__/` exercises process spawning, timeout kill, or truncation behavior. Not verified by automated tests.

## Related

- [tool-registry.md](tool-registry.md), [permissions.md](permissions.md), [read.md](read.md)
- Settings keys: `shell`, `permission`, `security`
