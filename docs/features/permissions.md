# Permissions and security

> Capability-tier approval with modes, scoped grants, path safety, SSRF, and write guards.

## Source

- Manager: `packages/code/src/security/index.ts` — rule layering, approval resolution, scoped grants.
- Resolution: `packages/code/src/security/approval.ts` — tiers, modes, decision algorithm.
- Rules: `packages/code/src/security/permissions.ts` — wildcard evaluation and config conversion.
- Path safety: `packages/code/src/security/path-safety.ts`; SSRF: `ssrf-guard.ts`; write guard: `read-tracker.ts`; loop detection: `doom-loop.ts`.
- Wrapper: `packages/code/src/tools/index.ts` — extracts targets, assigns tiers, applies the decision.
- Config: `packages/code/src/services/config.ts` (`tools.approvalMode`, `tools.approval`, `permission`).

## Registration / gating

- Every built-in tool is assigned a tier: `read`, `write`, `exec`, or `network`.
- Unknown and custom tools default to `exec`.
- MCP tools are `write` and checked under the `mcp` permission.
- Disabled tools: `tools.approval.<tool>: "deny"`.

## Inputs

| Field | Type | Description |
| --- | --- | --- |
| `tools.approvalMode` | `always-ask \| write \| yolo` | Default `write`. |
| `tools.approval.<tool>` | `allow \| deny \| prompt` | Per-tool override. `shell` aliases `bash`; `lsp_write` falls back to `lsp`. |
| `permission` | map of tool → pattern → action | Map form; evaluated before the rule array. |
| `permissions` | array of `{ name, pattern, allow }` | Rule-array form; also honored, evaluated after the map. |
| `security` | object | Write guard, blocked/allowed paths, SSRF, doom-loop thresholds. |

Mode matrix:

| Mode | Auto-approves | Prompts |
| --- | --- | --- |
| `always-ask` | read | write, exec, network |
| `write` (default) | read, write | exec, network |
| `yolo` | all tiers | nothing except explicit denies and safety overrides |

## Outputs

- `checkPermission()` resolves to allow, or throws `PermissionDeniedError` with tool, target, and reason.
- Interactive approvals surface through the permission dialog with `[Allow once] [Always allow] [Deny]`.
- “Always” writes scoped grants: exact file or directory glob, command prefix, hostname, LSP action, MCP `server/tool`.

## Flow

1. Extract targets: external paths first, then path patterns (or tool patterns for non-file tools).
2. Decide:
   1. tool safety (`deny`/`prompt`) — e.g. destructive shell patterns;
   2. tool policy `deny`/`prompt` from `tools.approval`;
   3. permission rules over **all targets** — any deny wins; all allowed → allow;
   4. tool policy `allow`;
   5. external paths always prompt unless rules allow them;
   6. mode by tier.
3. Any `deny` stops the call. `prompt` asks when a listener exists; without one it **fails immediately** with an actionable message.
4. Approved calls proceed; the wrapper still applies path safety, write guard, read tracking, and doom-loop checks.

## State / persistence

- Session grants live in memory. “Always allow” persists scoped rules to `spectra.json` via the config service.
- Permission config is read live with a 1 s cache, so edits apply without restarting. Session grants and safety guards stay in memory.
- External-directory approvals are directory-scoped.

## Security

- Path safety blocks secrets (`.ssh`, `.aws`, `.gnupg`, `.netrc`, cloud configs, etc.) regardless of mode.
- External paths always require approval unless explicitly allowed.
- SSRF blocks loopback, private, link-local, multicast, and IPv6 local ranges unless whitelisted.
- Write guard (soft by default) requires reading an existing file before overwriting.
- Doom loop stops repeated identical calls and patch spirals.
- Shell critical patterns are denied before any rule can allow them.

## Errors

| Condition | Result |
| --- | --- |
| Deny rule or policy | `Permission denied: '<tool>' for '<target>' (reason)` |
| No interactive UI | Immediate denial naming the mode and how to allow |
| Blocked path | `Path safety blocked: <path>` |
| External path denied | `External file access denied: …` |
| SSRF rejection | `SSRF guard: <reason>` |
| Write guard warning | Soft warning once, retry allowed |
| Doom loop | `Doom loop detected: …` |

## Limitations

- Non-interactive hosts (ACP, CI) must configure `tools.approval` or run `approvalMode: yolo`; there is no implicit prompt.
- Custom AgentTools loaded outside `createBuiltinTools` do not pass through the wrapper.
- Permission patterns are wildcard-based, not a full glob engine.
- Security guards (write guard, path safety, SSRF) are constructed once at startup; only permission rules and approval mode are live-reloaded.

## Tests

- `packages/code/src/security/__tests__/approval.test.ts` — modes, exec/network prompting, yolo, deny rules, tool policies, external paths, scoped “always”.
- `packages/code/src/__tests__/permissions.test.ts` — tool wrapping, no prompt for invalid URLs, external directory prompts.
- `packages/code/src/security/__tests__/doom-loop.test.ts` — loop thresholds.

## Related

- [tool-registry.md](tool-registry.md), [config.md](config.md), [lsp.md](lsp.md)
