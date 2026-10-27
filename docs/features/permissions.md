# Permissions and security

> `createSecurityManager()` turns configuration rules into tool-call decisions, and `wrapExecute` in the tool registry enforces them — permission prompts, sensitive-path blocking, read-before-write tracking, SSRF blocking, and loop detection — before and after every built-in tool runs.

## Source

- Manager: `packages/code/src/security/index.ts` — `createSecurityManager()`, `PermissionDeniedError`, rule evaluation, approval queue, bash blocklist, tool-pattern extraction.
- Rules: `packages/code/src/security/permissions.ts` — `evaluate()`, `fromConfig()`, `merge()`, `disabled()`, `getCanonicalPermission()`.
- Guards: `packages/code/src/security/path-safety.ts` (`PathSafety`), `ssrf-guard.ts` (`SsrfGuard`), `read-tracker.ts` (`ReadTracker`), `doom-loop.ts` (`DoomLoopDetector`), `wildcard.ts` (`matchWildcard`, `isInsideWorkingDir`, `canonicalPath`, `ensureDirGlob`).
- Types: `packages/code/src/security/types.ts` — `Rule`, `PermissionAction`, `SecurityConfig`, `PermissionRequest/Response`, result unions.
- Enforcement wrapper: `packages/code/src/tools/index.ts` — `wrapExecute` (`:64`), `spectraToolToAgentTool`, `createGatedMcpTools` (`:270`), `createAllToolsWithSecurity` (`:295`).
- Collaborators:
  - `packages/code/src/tui/hooks/use-agent.ts:56-93` — shared manager construction, toast warnings, approval persistence; `:401-434` builds per-session managers.
  - `packages/code/src/tui/hooks/use-permission-queue.ts` — serializes dialogs in the TUI.
  - `packages/code/src/tools/types.ts` — per-tool `capabilities { reads, writes }`.
  - `packages/code/src/services/config.ts:25-26` — `permission` and `security` config keys.

## Registration / gating

- TUI: `useAgent` creates one manager lazily per app run (`securityRef`) and a separate manager per subagent session through `createSessionFactory`; both pass `{ permission: config.permission, security: config.security, cwd }` (`use-agent.ts:56-93`, `:401-434`).
- Tools: every built-in tool returned by `createAllToolsWithSecurity` is wrapped; `todo` is added to that list and wrapped too. MCP tools are `AgentTool`s and are gated separately with permission `mcp` (`tools/index.ts:270-293`).
- Enabled by: no global switch; this is the policy layer, with enforcement in the tool wrapper. Absent rules mean "ask" for gated tools, so the default experience prompts for external paths, MCP tools, and non-file tools without rules.
- Defaults: `writeGuard: 'soft'`, SSRF `blockPrivate: true`, `blockLoopback: true`, `followRedirects: false`; doom-loop thresholds 5 identical calls, 8 consecutive non-write results, 4 patch failures.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `permission` | `Record<string, string \| Record<string, PermissionAction>>` | no | String value applies to pattern `*`; object maps wildcard patterns to `allow`/`ask`/`deny`. |
| `security.writeGuard` | `'soft' \| 'strict' \| 'off'` | no | Read-before-write enforcement mode, default `soft`. |
| `security.writeGuardExclude` | `string[]` | no | Tool names exempt from the write guard. |
| `security.blockedPaths` / `allowedPaths` | `string[]` | no | Replaces the default sensitive-path list / wins over blocked paths. |
| `security.ssrf` | `{ blockPrivate?, blockLoopback?, allowedHosts?, followRedirects? }` | no | Host-level URL policy. |
| `security.doomLoop` | `{ writeRepeatThreshold?, readOnlyRepeatThreshold?, patchSpiralThreshold? }` | no | Loop thresholds. |
| `cwd` | `string` | no | Base for path resolution; defaults to `process.cwd()` at manager creation. |
| `onPersist` | `(rules: Ruleset) => void` | no | Called after an "always" approval; the TUI writes them into `config.permission`. |
| `onWarning` | `(message: string) => void` | no | Receives doom-loop warnings; the TUI shows a toast. |

## Outputs

- `PermissionRequest { id, permission, pattern, tool, details, always }` emitted to the single listener; `always` lists the patterns an "always" answer would add.
- `PermissionResponse { action: 'once' | 'always' | 'deny' }` accepted by `respondToRequest()`.
- Denials become `PermissionDeniedError`, which the wrapper converts into an `isError` text result.
- Warnings are delivered through `onWarning`; loop stops and guard failures become `isError` results instead.
- No files are written by the security layer. Approvals reach disk only through the host's `onPersist` callback.

## Flow

`wrapExecute` runs these steps in order for each call (`tools/index.ts:64-230`):

1. `doomLoop.recordToolCall(name, args)` — an identical-call overrun returns an `isError` text result immediately.
2. `security.extractToolPatterns(name, args)` — derives `toolPatterns`, `pathPatterns`, and `externalPaths` from `path`/`file_path`/`filePath`, bash `command`, `web_fetch.url`, and `task.agent` (`security/index.ts:416-505`).
3. Permission check:
   - `SKIP_PERMISSION_CHECK` (`todo`, `memory`, `propose_skill`, `task`, `ask`, `web_fetch`, `webfetch`) skips rule evaluation.
   - File tools (`read`, `write`, `edit`, `grep`, `glob`, `bash`, `shell`) first require approval for each `externalPaths` entry under permission `external_directory`; the tool-level check runs only when there are no `pathPatterns`.
   - All other tools evaluate the tool name against `toolPatterns`.
4. `security.checkPath()` for every `pathPattern` (`PathSafety`): null bytes reject; allowed patterns win; blocked patterns reject.
5. If the tool declares `capabilities.writes`, `ReadTracker.checkWrite()` runs for every `pathPattern`.
6. `web_fetch`/`webfetch` URLs go through `SsrfGuard.check()`.
7. The tool executes.
8. `doomLoop.recordToolResult()`; `warn` calls `security.warn`, `stop` converts the result to `isError`. `edit`/`patch` failures feed patch-spiral tracking per path, and capabilities update the read tracker — reads always, writes only on success.

Rule evaluation (`security/permissions.ts:4-26`): rulesets are flattened in order `config → approved → session`, reversed, and the first rule whose permission and pattern both wildcard-match wins. No match yields `{ action: 'ask', pattern: '*' }`. `checkPermission` iterates the supplied patterns: `deny` throws immediately, `allow` returns immediately, and `ask`/no-match falls through. After the loop, bash/shell is auto-allowed, and file-tool patterns entirely inside the working directory are auto-allowed.

Approval flow (`security/index.ts:315-386`): the request is stored, the listener is called, and the tool waits. `deny` rejects; `once` resolves; `always` expands `generateAlwaysPatterns`, appends rules, resolves other pending requests fully covered by the new rules, and calls `onPersist`. After 120 s an unanswered request is removed and rejected as denied.

## State / persistence

- In-memory only: `pendingRequests`, `approvedRuleset`, the `ReadTracker` sets, `DoomLoopDetector` history/streaks, and the guard configuration.
- Approvals survive only if the host persists them. The TUI merges allowed rules into `config.permission` and calls `saveConfig()` (`use-agent.ts:65-88`, `:410-428`).
- Read tracking is per manager, so switching sessions or child views that reset the tracker forgets prior reads. Child-view switches call `getReadTracker().reset()` and `getDoomLoop().reset()` (`app.tsx:669-670`).
- Restart discards read/loop history and any approvals not saved to config; no caller passes `restoredApprovals`, so saved approvals are re-read only through `config.permission`.

## Security

- Default blocked paths cover `**/.ssh/**`, AWS credentials/config, `**/.gnupg/**`, `.netrc`, `/etc/shadow`, `/etc/gshadow`, `/etc/sudoers`, `.password-store`, Docker config, and kube config (`path-safety.ts:6-19`). Matching checks the full path, a `**/`-prefixed form, and a normalized suffix.
- `matchWildcard` converts `*`/`?` to regex with every other metacharacter escaped, expands a leading `~/`, anchors both ends, and is case-insensitive on Windows (`wildcard.ts:6-35`).
- SSRF blocks `localhost`, `::1`, `::`, `127.*`, RFC1918 ranges, link-local `169.254.*`, `0.*`, `>=224.*`, `fe80:*`, and `fc`/`fd` IPv6 prefixes; `allowedHosts` bypasses all checks (`ssrf-guard.ts:25-97`).
- Read-before-write: `soft` returns a warning failure on the first attempted overwrite of an unread existing file and allows a retry; `strict` blocks; `off` disables. New files and already-read/written paths pass, and excluded tool names pass (`read-tracker.ts:29-75`).
- Bash is blocklisted before rules: a fixed first-word set (`shutdown`, `reboot`, `halt`, `poweroff`, `mkfs`, `fdisk`, `mkswap`, `swapon`, `telnet`, `chroot`), plus patterns such as `rm -rf /*`, `curl * | sh`, `dd if=*of=/dev/*`, fork bombs, and forced pushes to `main`/`master` (`security/index.ts:28-70`, `:141-148`). If no rule denies it, bash is auto-allowed and never prompts.
- Doom loops: identical calls (same tool and JSON args) stop at the write threshold; a changed call resets all counts to 1; 60 s-old entries are pruned. Non-write tool results increment a consecutive-read counter; a successful `edit`/`write`/`apply_patch`/`bash` resets it; reaching the read threshold warns once and resets.

## Errors

| Condition | Result |
| --- | --- |
| Effective rule is `deny` | `Permission denied: '<permission>' for '<pattern>'`; tool result is `Permission denied: …`, `isError`. |
| External path denied | `External file access denied: …`, `isError`. |
| Path safety rejection | `Path safety blocked: <path>`, `isError`; the specific reason is not forwarded. |
| Write guard blocks (`strict`, or first `soft` warning) | Tool result is the guard's reason text, `isError`; `soft` allows the second attempt. |
| SSRF rejection | `SSRF guard: <reason>`, `isError`; invalid URLs report `Invalid URL: …`. |
| Identical-call threshold reached | `Doom loop detected: '<tool>' called N times with identical arguments. Breaking loop.`, `isError`. |
| Patch-failure threshold reached | Warning toast "Patch spiral on '&lt;path&gt;': …". |
| Read-only threshold reached | Warning toast "Read-only loop detected: N consecutive reads with no writes." |

## Limitations

- Bash/shell never prompts: after the first-word/fixed-pattern blocklist and rule evaluation, `isBash` returns before approval, so a rule can deny or allow but cannot force a prompt. Shell syntax beyond those patterns is not analyzed.
- File tools carrying a path never evaluate their own permission rules. The only rule-driven gate for them is `external_directory`; inside the working directory a `deny` rule for `read`/`write`/`edit` and friends has no effect.
- `internalPathsOnly()` also auto-allows file-tool checks when every pattern resolves inside the working directory, so a rule cannot force a prompt for in-tree file access.
- Later rules win: approvals are appended after config rules, so "always" can shadow an earlier config `deny` for the same permission and pattern.
- Read tracking is keyed on `process.cwd()` rather than the session's `directory`, and it only considers files that already exist.
- SSRF is applied only to `web_fetch` in the wrapper; other network paths are not checked.
- Bash path extraction recognizes only `FILE_COMMANDS` first words and splits on unescaped `;`, not `&&` or pipes, so many path-touching commands yield no `pathPatterns`.
- A relative path outside the working directory contributes both its raw and absolute forms to `externalPaths`, so a one-time approval can be followed by a second prompt for the same file.
- Custom tools loaded by `createAllToolsWithExtensions` and ACP's tool set (`integrations/acp/server.ts:133`) are not passed through `wrapExecute`, so they bypass these checks.

## Tests

- `packages/code/src/__tests__/permissions.test.ts` — safe orchestration tools (`task`) and pre-validation `web_fetch` failures produce no permission request; a `read` outside the working directory prompts with permission `external_directory` and returns "External file access denied".
- `packages/code/src/security/__tests__/doom-loop.test.ts` — read-only warnings at the configured threshold, counter reset after a warning and after a successful write, identical-call stop at the write threshold, patch-spiral warnings, reset after warning, and reset on patch success.
- No direct tests exist for `PathSafety`, `SsrfGuard`, or `ReadTracker`; their behavior above is read from source, not test-verified.

## Related

- [tool-registry.md](tool-registry.md) — `SpectraTool`, `AgentTool`, and where `wrapExecute` is applied.
- [tui-shell.md](tui-shell.md) — permission dialog plumbing and session switching resets.
- [config.md](config.md) — `permission`/`security` loading and persistence.
- [shell.md](shell.md), [web-fetch.md](web-fetch.md), [read.md](read.md), [write.md](write.md) — tools governed here.
- [mcp-client.md](mcp-client.md) — separately gated MCP tools.
