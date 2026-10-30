# Spectra Phase Ledger

Single source of truth for scheduled work. `TODO.md` is the idea backlog; this file is the execution plan. Feature contracts live in `docs/features/`.

**Branch:** `feat/new-beginning`. One phase per PR-sized batch.

## Execution protocol

1. Read the phase end to end. Re-verify the **Reference** citations; if a cited file moved or changed, update this file before writing code.
2. Implement the **Steps** in order. Do not pull work forward from a later phase.
3. Run **Verification** exactly as written. A phase is not done because tests pass; it is done when the acceptance list is observed.
4. Update the affected `docs/features/*.md` page and this phase's status in the **same commit**.
5. Add one changeset per phase (`bun run changeset`), scoped to the touched packages.
6. Commit format: `code(feat) <phase outcome>` or `code(fix) …`; no phase numbers in the subject.

Global checks for every phase: `bun run lint`, `bun run test`, `bun run build`, and `bun run docs:build` when a docs page changed.

## Non-negotiable Spectra invariants

Reference work informs **behavior**, never architecture. Every phase preserves:

- **Independent native SDKs** — TypeScript and Rust share design shapes, not code, bindings, or runtime.
- **Construction kit** — primitives over policy. Capabilities live in the app layer or plugins, not baked into the SDKs.
- **TypeScript core** — `EventStream`/`AsyncIterable` events, provider registry, `defineTool` + Zod, class-based `Agent`, hooks. Do not replace them with another harness's runtime model.
- **Rust core** — zero unsafe, rustls, `thiserror` + `miette`, builder patterns.
- **Spectra-owned persistence** — SQLite sessions, workdir-keyed shadow-git snapshots, layered JSON/JSONC config. Do not import foreign storage models.
- **TUI** — React + OpenTUI. No alternate renderer.
- **One policy layer** — permissions, path safety, SSRF, doom loop. Every new tool routes through it.

Do not port mechanisms that assume another harness's runtime: model-role chains, internal URL protocols (`proc://`, `agent://`), Eval preludes, broker/mux transports, or external settings discovery. Reproduce the user-visible behavior with Spectra primitives, or leave it out.

## Status

| Phase | Scope | Size | Status | Depends on |
|---|---|---|---|---|
| 0 | Documentation and phase infrastructure | M | done | — |
| 1 | Input and exit contract | S | done | 0 |
| 2 | Web search + shared network egress | M | done | 1 |
| 3 | LSP tool and edit diagnostics | L | done | 1 |
| 3.5 | Permission approval model (tiers, modes, scoped grants) | M | done | 2 |
| 4 | Subagent lifecycle: fan-out, background, steer, pause/resume/restart | L | planned | 1 |
| 5 | Settings registry, tabbed UI, config CLI | L | planned | 1 |
| 6 | Browser automation | L | planned | 5 |
| 7 | Plugin system | XL | planned | 4, 5 |

Parallel lanes after Phase 1: {2, 3, 4, 5} are independent. Phase 6 needs 5 (permission/settings surface). Phase 7 needs 4 (job lifecycle) and 5 (settings contributions).

---

## Phase 0 — Documentation and phase infrastructure

**Goal:** every existing subsystem has a contract page; every future change has a place to record itself.

**Current state**

- `docs/features/README.md` indexes 33 rows; only `README.md` and `_TEMPLATE.md` exist.
- `AGENTS.md` references both plus this file and states the update rules.
- Stray compiled output untracked: `packages/code/src/tools/hashline/{format,snapshots,types}.js`.

### Steps

1. Delete the three stray `.js` artifacts; confirm `packages/code/tsconfig.json` emits to `dist/` only.
2. Write runtime pages: `agent-loop.md`, `providers.md`, `tool-registry.md`.
3. Write tool pages: `read.md`, `write.md`, `edit.md`, `hashline.md`, `shell.md`, `search.md`, `web-fetch.md`, `todo-tool.md`, `memory-tool.md`.
4. Write integration pages: `mcp-client.md`, `acp-server.md`, `custom-tools.md`, `permissions.md`.
5. Write service pages: `sessions.md`, `snapshots.md`, `config.md`, `model-service.md`, `custom-providers.md`, `context-compaction.md`, `skills.md`.
6. Write app pages: `tui-shell.md`, `commands-templates.md`, `doctor.md`.
7. Add `docs/features` to the VitePress sidebar (`docs/.vitepress/config.ts`, "Internals" group).
8. Cross-check every index row has a file; remove or add rows to match reality.

**Page standard:** Source (entry file), Registration/gating (config key + permission name), Inputs table, Outputs (result shape + events), numbered Flow, State/persistence, Security, Errors table, Limitations in prose, Tests, Related.

### Verification

- `bun run docs:build` succeeds; the Internals group renders.
- Script check: every link in `docs/features/README.md` resolves.
- `git status` shows no untracked `.js` under `src/`.

**Acceptance**

- Every `pending` row has a page with no empty section.
- Each page names a test file or the manual verification used.
- `AGENTS.md` rule is present and accurate.

**Non-goals:** rewriting existing VitePress docs. **Risk:** pages rot — the AGENTS.md same-commit rule is the mitigation.

---

## Phase 1 — Input and exit contract

**Goal:** one owner for Esc and exit keys; no keystroke destroys a draft or skips teardown.

### Reference (oh-my-pi)

- Esc is one ordered ladder in `modes/controllers/input-controller.ts` `editor.onEscape` (~468-612): MCP-test handlers → side panels → command report → compaction/handoff/retry abort (main view only) → speech stop → loop pause → focused agent (clear text, else unfocus; never interrupt) → collab abort → loading animation → bash abort/mode exit → eval abort/mode exit → streaming abort → **non-empty draft = do nothing** → empty draft = double-Esc (500 ms) opens rewind/tree, configurable `none`.
- Named, rebindable actions (`tui/src/app-keybindings.ts`): `app.interrupt` Esc, `app.clear` Ctrl+C, `app.exit` Ctrl+D, `app.suspend` Ctrl+Z.
- Ctrl+C clears the draft (recallable via Up; bounded 100 entries; not persisted). Double Ctrl+C within 500 ms exits. Ctrl+D exits and doubles as forward-delete when the buffer is non-empty.
- Teardown is one memoized path (`modes/session-teardown.ts`): snapshot draft → `saveDraft(text)` (empty clears the sidecar) → `disposeSession()`; `isShuttingDown`/`teardownFailed` guard re-entry.
- Draft sidecar is consumed on resume (`sessionManager.consumeDraft()`).

### Spectra current state

| Behavior | Evidence |
|---|---|
| Ctrl+C calls `renderer.destroy()` directly | `tui/hooks/use-app-keyboard.ts:267-269` |
| Esc needs two presses to interrupt; footer says so | `use-app-keyboard.ts:277-310`, `tui/footer-status.ts:21,48` |
| Esc exits child view | `tui/app.tsx:702-707` |
| `exitOnCtrlC: false`, alt screen | `tui/index.tsx:31` |
| Tip advertises nonexistent `:q` | `tui/tips.tsx:5` |
| Draft lives only in component state | `use-app-keyboard.ts` |

### Steps

1. Add `tui/input/escape-ladder.ts` with the ordered ladder: dialog → palette → autocomplete → approval (Esc = deny) → child view → compaction abort → streaming abort → non-empty draft no-op → empty-editor double-Esc (default `none`).
2. Add `tui/input/exit.ts`: `clearDraft()`, `exitNow()`, 500 ms `lastClearAt`, single `shutdown()`.
3. Wire `use-app-keyboard.ts` to the ladder; delete `interruptArmed` and the two-press path; update footer hints to `esc interrupt`.
4. Implement `shutdown(reason)`: idempotent; 2 s cleanup budget — abort stream → flush session → close MCP clients → cancel background tasks → save draft → `renderer.destroy()` last.
5. Add `services/draft-store.ts`: `save(sessionId, text)`, `consume(sessionId)`, `clear(sessionId)` at `<configDir>/drafts/<sessionId>.txt`; save on shutdown, consume when a session is loaded, clear on submit.
6. Bind Ctrl+D to exit; Ctrl+C clears when text exists, arms exit when empty.
7. Remove the `:q` tip. Keep Ctrl+L clear-conversation tip.
8. Write `docs/features/input-lifecycle.md` with the ladder table and exit sequence.

**Adaptation:** Spectra has no rewind/tree, so the empty-editor double-Esc action defaults to `none`; the slot stays for later. Drafts use a plain file, not SQLite (no migration, survives a locked DB). Keys are not rebindable in this phase.

### Verification

- `bun run test` — `tui-input-lifecycle`, `prompt-submit-lifecycle`, new `exit-contract`.
- Manual TUI: launch, type text, Esc (alive), Esc empty (alive), submit a stream + Esc once (aborts), Ctrl+C with draft (clears), Ctrl+C twice (exit 0), Ctrl+D (exit 0), `grep -r ":q" src/` empty; draft restore is covered by unit tests because no provider is configured in the smoke environment.

**Acceptance**

- Idle Esc never exits and never clears a draft.
- One Esc aborts streaming; partial message retained.
- Esc closes only the topmost surface.
- Ctrl+C clears, double Ctrl+C exits, Ctrl+D exits.
- Exit flushes session, closes MCP clients, cancels jobs, writes the draft.
- Resume restores the draft; `:q` appears nowhere.

**Non-goals:** rebindable keys, suspend, Vim mode, signals beyond SIGINT.

---

## Phase 2 — Web search and shared network egress

**Goal:** provider-chained search with honest failure reporting and one guarded fetch path.

### Reference (oh-my-pi)

- `web_search` (`web/search/index.ts`) over a lazy provider registry; **no provider param**; candidates from the `web` model-role chain, tried **sequentially**.
- Schema `query`, `recency`, `limit`, `max_tokens`, `temperature`, `num_search_results`; adapters clamp.
- Output `formatForLLM`: answer (if any), sources `[n] title (age)` + URL + 240-char snippet, citations, related, up to 3 queries at 120 chars.
- Failures return text + `details.error`; multiple failures aggregate. Per-provider timeout default 60 s, max 300 s.
- `query.ts` parses Google-style directives and leniently post-filters, emitting a `Note:` when relaxed.
- Bodies byte-capped (2 MiB); **no SSRF guard in this layer**.

### Spectra current state

- No `web_search`. `web_fetch` calls `fetch()` directly (`tools/web-fetch.ts:24`), 15 s timeout; the security wrapper checks SSRF on the **initial URL only** (`tools/index.ts:137`), redirects are not re-checked, and the tool is in `SKIP_PERMISSION_CHECK` (`tools/index.ts:57`). `SpectraConfig` has no `tools` block.

### Steps

1. Extend config: `tools.webSearch.{providers,maxResults,timeoutMs}` with defaults `['brave','tavily']`, 5, 60 000.
2. Add `tools/network.ts` `safeFetch(url, init, guard)`: parse → SSRF check → redirect policy → timeout → byte cap.
3. Refactor `web-fetch.ts` onto `safeFetch`; remove it from `SKIP_PERMISSION_CHECK`; permission pattern = hostname. `safeFetch` must re-check SSRF on every redirect hop, not only the initial URL.
4. Add `tools/web-search/`: `types.ts`, `providers/base.ts`, `providers/brave.ts`, `providers/tavily.ts`, `provider.ts` (lazy registry + chain), `query.ts` (directives + lenient filter), `format.ts`, `index.ts` (tool).
5. Chain execution: sequential, per-provider timeout, skip unavailable, aggregate failures; return `details.error`, never throw.
6. Register in `createBuiltinTools`; include in agent tool filters; add `web_search`/`web_fetch` to the permission UI categories.
7. Write `docs/features/web-search.md` and update `web-fetch.md`.

**Adaptation:** no model-role chain — the chain is an explicit config list of two API adapters. SSRF is a deliberate addition (the reference has none). Scrapers, grounded providers, and role-based fallback are out of scope.

### Verification

- `bun run test` — provider fixtures (all-success, first-fails, all-fail, missing key, 429), SSRF rejection before request, directive parsing + relaxation note.
- Manual with a real key: one query returns results; unset key gives the config-naming error and makes no request.

**Acceptance**

- Valid key returns ≥1 result with title, URL, snippet.
- First provider failure falls through; both failing yields the aggregated message.
- Missing keys produce an actionable error and no network call.
- Both network tools reject loopback/private hosts unless whitelisted.
- `web_fetch` prompts under the default `ask` policy.

**Non-goals:** scrapers, model-grounded search, role chains, caching.

### Follow-on fixes delivered before Phase 3

- **Home footer:** folder/branch Nerd Font glyphs, ahead/behind, changed/untracked/conflict counts, width-aware truncation, async polling, last-good retention through transient git failures.
- **About panel:** gradient S mark, compact six-row layout, live runtime/platform/config values, clickable repository URL.
- **Runtime performance:** removed `useRef(expensive())` eager evaluation (git status ran synchronously on every render), lazy `SessionStore`/`PromptHistoryService`/`SnapshotManager`, per-frame delta coalescing, memoized transcript/composer, stable session-state API, draft state committed only for `/` and `@` input.
- **Known issue (deferred):** the streaming markdown tail can render raw syntax for up to one frame because OpenTUI's `streaming` mode keeps the trailing block provisional. Candidate fixes: `streaming={false}` per update, or `internalBlockMode: "top-level"`.

---

## Phase 3 — LSP tool and edit diagnostics

**Delivered beyond the original scope:** project mux daemon (cross-process shared servers), writethrough format/diagnostics for every write and edit, inline + deferred diagnostics with ledger dedupe injected into the session, Biome adapter, watched-file notifications, `prepareRename`, `codeAction/resolve`, document-create/rename/delete operations, workspace pull diagnostics, position-encoding advertisement, `willSave`/`didSave`, and separate `lsp`/`lsp_write` approvals.

**Goal:** code intelligence from real servers plus post-edit diagnostics.

### Reference (oh-my-pi)

- One `lsp` tool (`lsp/tool.ts`) with 14 actions: `diagnostics`, `definition`, `type_definition`, `implementation`, `references`, `hover`, `symbols`, `rename`, `rename_file`, `code_actions`, `status`, `reload`, `capabilities`, `request`.
- Params `action`, `file` (glob / `"*"`), `line` 1-indexed, `symbol` (text → column, `name#N`), `query`, `new_name`, `apply` (rename applies unless `false`; code actions list unless `true`), `timeout` 5–300 s, `payload`.
- Custom Content-Length JSON-RPC (`jsonrpc/message-framing.ts`); per-identity client cache; `initialize`; `$/cancelRequest` on abort.
- `lsp/defaults.json` (~55 servers: command, args, fileTypes, rootMarkers, isLinter); requires root marker + resolvable executable.
- Unopened files are opened; externally changed files reconciled with `didChange`; symbol required for project-aware servers.
- Workspace edits validated with rollback safety; `rename_file` edits then moves and sends `workspace/didRenameFiles`.
- Post-write diagnostics: inline 500 ms budget (`lsp/writethrough.ts`), late results deferred (`deferred-diagnostics.ts`).
- Approval: read-only actions read; `rename`, `rename_file`, `code_actions`, `reload`, `request` write regardless of `apply`.

### Spectra current state

- No LSP client or tool; `tree-sitter` is for parsing/highlighting only.

### Steps

1. `lsp/framing.ts`: Content-Length reader/writer with abort-safe streams.
2. `lsp/client.ts`: spawn, initialize/initialized, request map, timeout, `$/cancelRequest`, diagnostics cache, crash detection, `applyWorkspaceEdit` request handling.
3. `lsp/config.ts` + `lsp/defaults.json`: merge project/user overrides; filter by root markers and executable presence; file→server routing.
4. `lsp/manager.ts`: per workspace+server clients, lazy start, idle stop 10 min, max 4, shutdown hook.
5. `lsp/positions.ts` + `lsp/symbols.ts`: 1↔0 indexing, `name#N` resolution, URI↔path.
6. `lsp/edits.ts`: WorkspaceEdit → validated text edits; workspace boundary enforced through `SecurityManager`; rename-file ordering.
7. `tools/lsp.ts`: all 14 actions; `apply` semantics; approval classes; `details.success`/`serverName`.
8. `lsp/diagnostics.ts`: inline 500 ms wait + deferred queue; wire `write`/`edit` results.
9. Shutdown integration; `docs/features/lsp.md`.

**Adaptation:** private process per server only — no broker mux/`lspmux`, no plugin-contributed servers, no custom linter adapters, no format-on-write. Diagnostics only.

### Verification

- `bun run test` — fake stdio server (initialize/didOpen/definition/diagnostics), `name#N`, edit rejection outside workspace, rename preview/apply, deferred handoff.
- Manual on this repo: diagnostics on a TS file; references for an exported symbol; rename preview diff.

**Acceptance**

- Real compiler diagnostics for TS.
- Cross-file references.
- Rename previews then applies; `rename_file` moves and updates imports.
- Missing server → named binary error, no hang.
- Diagnostics after `write`/`edit` appear inline or next turn.

**Non-goals:** DAP, formatting, broker sharing, workspace-wide diagnostics fan-out.

---

## Phase 3.5 — Permission approval model

**Goal:** replace tool-name prompts with capability tiers and modes.

**Delivered:** `read`/`write`/`exec`/`network` tiers, `always-ask`/`write`/`yolo` modes with **default `write`**, tool policy overrides (`tools.approval`), all-target rule evaluation (any deny wins), external-path prompts independent of mode, scoped “always” grants (file/dir/command/host/action), immediate failure without an interactive UI, actionable denial reasons, `bash` no longer auto-allowed, `lsp`/`lsp_write` action classes, `shell`/`bash` policy aliasing, live config reload (1 s cache), and `permissions` rule-array support.

---

## Phase 4 — Subagent lifecycle, jobs, auto-background

**Goal:** children and long-running tools are first-class jobs the parent can start, inspect, steer, pause, resume, restart, cancel, and wait on — including promoting a foreground process to the background when the user sends a new message mid-run.

### Reference (oh-my-pi)

- Batch `{ context, tasks[] }`: one spawn per item; unique names; per-item agent/output schema.
- `AsyncJobManager` one job per spawn; status `running|completed|failed|cancelled` plus a `queued` flag; per-owner delivery sink.
- `wait` has an empty schema, returns on the first settled owned job or message, 30-minute cap, consumes delivery.
- Live steering and inspection ride `agent://` and `proc://`; idle agents park and revive from JSONL.
- `auto-background.ts`: long-running bash is promoted on an incoming message; the tool result becomes `Backgrounded as job <id>; result will be delivered automatically.` and the process keeps running.
- Failed spawn → `failed`; agent remains interrogable.

### Spectra current state

- `backgroundTasks` registry: `running|completed|error|cancelled`, no persistence, no delivery ledger, no pause/resume.
- `task` merges `tasks[]` into one prompt and one child; `background` returns a `task_id`; `task_id` replay starts a new agent; `result.error` is recorded as completed.
- No `job`/`irc` tools; `/background-tasks` only promotes/cancels.
- `submitPrompt` while streaming queues steering; a long foreground tool still blocks the next step until it finishes.

### Concurrency model (the part that must be boring)

**Single-writer rule.** Only `JobRegistry` mutates job state. Tool execution code never writes status directly; it calls `transition(jobId, expected, next, patch)`.

**Ownership.** Every job carries `ownerSessionId`. Delivery, pause, resume, restart, and probe are scoped to the owner. A session switch does not redirect deliveries.

**Generations.** Each run attempt has `generation` (monotonic). Callbacks from an older generation (`complete`, `error`, `progress`, deferred diagnostics) are ignored after `restart` or `resume`. The abort controller is per generation.

**Exactly-once delivery.** A job has `deliveredAt`. Completion marks `settledAt`; the delivery engine claims with a CAS (`deliveredAt IS NULL`), then injects. `wait` consumes by setting `consumedAt`; a job cannot be both consumed and delivered.

**Promotion token.** A foreground execution races `executionPromise` against `promotionSignal`. First to settle sets `outcome` (`inline` or `promoted`) via a token object; the loser is a no-op. Promotion never aborts the underlying work.

**Serialized persistence.** All SQLite writes go through one async queue per store; no interleaved transactions.

**No cross-await state reads.** Transition decisions read state from the registry, not from a stale local copy captured before an await.

### Auto-background semantics

Triggers (config `tasks.autoBackground`):

```jsonc
{
  "tasks": {
    "autoBackground": {
      "onUserMessage": true,      // default
      "afterMs": 0,               // 0 = off
      "outputThresholdBytes": 65536
    }
  }
}
```

- **Incoming message while a foreground tool runs:** the session submits a *promotion request* for the active tool call before queueing steering. If the tool has not already produced a result, its job is registered and the tool returns `Backgrounded as job <id>; result will be delivered automatically.` Steering still applies at the next step boundary.
- **Threshold promotion:** `afterMs`/`outputThresholdBytes` promote without a message; disabled by default.
- Promotion does not apply to tools marked non-backgroundable (`read`, `edit`, `write`, `lsp`, permission dialogs). Only `shell`, `task`, `browser` (later), and background-capable tools.
- If the tool settles at the same moment as promotion, execution wins: promotion is discarded, no job, no duplicate result.
- If the user cancels the turn after promotion, the job keeps running unless the cancel reason is `user-abort`; then it is cancelled.

### Job state machine

```
queued -> running -> paused -> running -> completed
             |          |
             +-> failed |-> cancelled
completed|failed|cancelled|paused -> queued (restart)
```

`transition(jobId, allowedFrom[], next, patch)` is single-shot. `pause` sets `pauseRequested`; the runner applies it at the next step boundary after the active tool call finishes, persists messages, then transitions to `paused`.

### Job tool (`tools/job.ts`)

| Op | Contract |
| --- | --- |
| `list` | Owned jobs with status, elapsed, agent, description. |
| `status` | One job: state, activity, attempts, usage, timestamps. |
| `probe` | Read-only live detail: current turn/tool, retry attempts, last 8 KB output. Never consumes delivery. |
| `transcript` | Paged messages from memory while running, from the session file after settle. Bounded 500 KB / 5 000 lines. |
| `wait` | `ids?`, `mode: first|all` (default `all`), `timeoutMs` 30 s / max 300 s. Returns a snapshot; timeout never cancels. Marks returned terminal jobs consumed. |
| `send` | Queue a message: running → next step boundary; paused/idle → revive; completed → reject. |
| `pause` | Queued → paused immediately. Running → finish current tool, abort turn with `paused`, persist, transition. |
| `resume` | New generation from persisted messages, optional instruction. |
| `restart` | `from: start|checkpoint`; new generation; `start` clears transcript and reuses original prompt. |
| `cancel` | Terminal; abort current generation; remove from queue. |

### Race table (must have tests)

| Race | Resolution |
| --- | --- |
| Tool completes as promotion fires | Execution wins by token; no job. |
| Promotion fires after tool returned | Promotion request rejected (no active tool). |
| New message while already promoted | Steering only; no second promotion. |
| `wait` returns job while completion delivery is in flight | Delivery claim is CAS; exactly one path wins. |
| `cancel` vs completion | Terminal CAS; loser ignored. |
| Pause during tool execution | `pauseRequested`; transition after tool settles. |
| `restart` while running | Abort generation N, await settle, start N+1; stale callbacks ignored. |
| Resume while previous generation still cleaning up | `settling` guard; resume waits or returns “still pausing”. |
| Process exits with running jobs | Startup marks orphans `paused` with reason `interrupted by exit`. |
| Duplicate completion after resume | Generation check rejects. |
| Probe during transcript write | Snapshot copy; never blocks the runner. |
| Session switch | Delivery only to `ownerSessionId`; no cross-session injection. |
| Two `job wait` calls | Both get snapshots; consumption is idempotent. |
| Child settles before registry insert | Insert-then-attach; runner started only after insert. |

### Persistence

`jobs` table: `id`, `parent_session_id`, `child_session_id`, `agent`, `description`, `prompt`, `state`, `pause_requested`, `queued_at`, `started_at`, `finished_at`, `settled_at`, `delivered_at`, `consumed_at`, `generation`, `result`, `error`, `retry_attempts`, `last_checkpoint_at`.

### Failure handling

Carried from the earlier plan: classification (retryable vs permanent), replay-safety veto, wall clock, soft request budget, stall timeout, missing-report reminders, interrupted-turn repair, crash → `failed`, parent Esc → cancel, parent exit → pause.

### UI

- `/background-tasks`: status, elapsed, pause/resume/restart/cancel, probe.
- Transcript card for `task`/`job`: one row per child, status color, click to probe.
- Footer: count of running jobs for the session.

### Tests

- Registry transition matrix, including illegal transitions.
- Promotion at completion, promotion after completion, promotion while already promoted.
- New message during long tool: steering delivered, job created, result delivered once.
- `wait` first/all/timeout; consumption prevents duplicate delivery.
- Pause/resume/restart with generation isolation; stale completion ignored.
- Orphan recovery on startup.
- Probe/transcript without consumption.
- Failure: retry, failure after committed output, wall clock, stall, crash.
- Load: 3 children, one paused, one cancelled, one completed; delivery ordering by settlement.

### Steps

1. Schema + `JobRegistry` with transitions, generations, delivery fields, serialized SQLite queue.
2. Delivery engine (claim → inject → mark) and consumption integration.
3. `task` fan-out: one child per item, insert-then-run, per-child abort controller.
4. `job` tool with all operations and bounded outputs.
5. Auto-background: promotion request hook in `submitPrompt`, race in the tool wrapper, config.
6. Pause at step boundary; resume/restart with generation guards.
7. `irc` tool for steering.
8. Failure handling module (classification, replay safety, budgets, repair).
9. UI: `/background-tasks`, transcript cards, footer count.
10. Tests above.

**Non-goals:** worktree isolation, cross-process job daemon, pausing inside a single tool call.

## Phase 5 — Settings registry, tabbed UI, config CLI

**Goal:** one schema registry drives UI, CLI, validation, and docs.

### Reference (oh-my-pi)

- Ten tabs (`settings-defs.ts` `SETTING_TABS`): appearance, model, interaction, context, memory, files, shell, tools, tasks, providers; sections; fuzzy cross-tab search; changed badges; muted non-matches.
- `config/registry.ts` validates/normalizes; `settings.ts` stages writes with 100 ms debounce, file lock, atomic write, re-read to preserve disjoint edits.
- Precedence defaults ← global ← project ← CLI overlays ← runtime ← env; env values shown as overrides, never persisted.
- CLI `config list|get|set|reset|path` with typed parsing and `--json`; credentials masked in `list`.
- Live reload with debounce; invalid layer keeps last-good values.
- Project settings scoped to `<cwd>/.omp/`, no ancestor walk.

### Spectra current state

- `tui/ui/settings-dialog.tsx` single list; separate model/providers/MCP/permissions/thinking/usage dialogs.
- `SpectraConfig` is hand-written in `services/config.ts`; recursive merge with name-keyed merge; no schema metadata, no config CLI, no global/project distinction in UI.

### Steps

1. `config/registry.ts`: entries `{ path, type, tab, section, description, default, validator?, apply, scope, secret? }`; derive `SpectraConfig` from the registry.
2. Enumerate existing config keys into entries (model, provider, theme, shell, logLevel, permissions, security, providers, memory, skills, commands, references, mcp, plugins). New phase keys added as they land.
3. Atomic writes: temp file + rename, 100 ms debounce, re-read under lock, preserve disjoint changes.
4. Live reload watch on global/project files; last-good on parse failure.
5. CLI `spectra config list|get|set|reset|path` with typed parsing and `--json`; mask secrets in `list`.
6. `tui/ui/settings/`: tab rail (10 tabs), sections, fuzzy search, changed badges, Enter edit, Esc close, scope badge, `restart` pending badge.
7. Move model/provider/MCP/permission/thinking/theme controls into tabs; keep deep-link commands that open the right tab.
8. `docs/features/settings.md` + update `config.md`.

**Adaptation:** JSON/JSONC instead of YAML (existing format, no migration). No profiles, no XDG relocation, no external-harness settings discovery. Debounce + atomic locked writes adopted directly.

### Verification

- `bun run test` — registry round-trip; validator rejection leaves file untouched; scope routing; debounce coalescing; component navigation/search.
- Manual: change model + permission, restart, verify; `spectra config get model` matches the UI.

**Acceptance**

- Ten tabs, keyboard-only navigation, fuzzy search.
- Changes persist; project scope writes `.spectra/spectra.json` with badge.
- Invalid values never write.
- CLI and UI agree; secrets masked.
- No setting remains only in a legacy dialog.

**Non-goals:** YAML migration, profiles, importing other harnesses' settings.

---

## Phase 6 — Browser automation

**Goal:** agent-driven browser control with explicit lifecycle and host policy.

### Reference (oh-my-pi)

- Not an AgentTool: host facade + Eval prelude `browser` (`tools/browser.ts`, `browser/prelude.{js,py}`), `browser.enabled`, approval `exec`; host actions `open`, `close`, `run`, `call`, `tabs`, `targets`.
- `tab.observe/ariaSnapshot/click/type/extract/screenshot/waitFor*/run`; numeric `observe()` ids (CDP `backendNodeId`+`loaderId`) and `[ref=eN]` ARIA refs; stale refs need a new observe.
- Modes: managed Chromium, spawned `app.path`, attached `app.cdp_url`, relay, Tern, cmux.
- Per-tab `allowed_domains`, downloads dir, `persist`, `headed`, `ignore_https_errors`.
- Screenshots to `browser.screenshotDir`; model images capped 1024×1024/150 KiB.
- Owned tabs freeze at turn settle; idle close 1800 s; relay/attached/spawned not auto-closed.
- Safety: approval tier + hostname allowlist; **no SSRF**.

### Spectra current state

- No browser tooling or Chromium dependency.

### Steps

1. Add `puppeteer-core`; resolve binary: `SPECTRA_CHROME_PATH` → config channel → OS paths; actionable error otherwise.
2. `browser/manager.ts`: managed/spawn/attach modes, per-session tab registry, single-flight opens, freeze at turn end, idle close, crash recycle.
3. `browser/tab.ts`: `observe()` (numeric ids), click/type/extract/wait/screenshot, ref invalidation on navigation.
4. `browser/network.ts`: per-tab `allowedDomains`; request abort for other hosts.
5. `tools/browser.ts` (8 tools): open/observe/click/type/extract/screenshot/wait/close; arg validation; `ref` or selector.
6. Permission `browser` (pattern hostname) + SSRF before navigation (Spectra divergence).
7. Screenshots to `<configDir>/artifacts/<sessionId>/<uuid>.png`, returned as attachments.
8. Shutdown integration; `docs/features/browser.md`.

**Adaptation:** discrete tools instead of an Eval prelude (Spectra has no JS eval surface); if eval lands later, collapse them into a facade over the same manager. SSRF added. Relay, Tern, cmux, downloads, and PDF are out of scope.

### Verification

- `bun run test` — arg validation, permission/SSRF gating, manager lifecycle with mocked CDP, ref invalidation.
- Manual: local fixture page → open/observe/click/type/extract/screenshot; refused host prompt; idle close.

**Acceptance**

- Extract reflects typed/clicked state; screenshot renders inline.
- Non-whitelisted navigation refused with a prompt.
- Stale ref → re-observe, never a wrong click.
- Session close closes owned tabs only.

**Non-goals:** relay, Tern/cmux, desktop computer-use, downloads, PDF.

---

## Phase 7 — Plugin system

**Goal:** third-party extensions without editing central composition files.

### Reference (oh-my-pi)

- `docs/extensions.md`, `docs/extension-loading.md`, `docs/hooks.md`, `docs/task-agent-discovery.md`; implementation under `packages/coding-agent/src/extensibility/`; plugin roots participate in settings and LSP discovery.
- Same invariants Spectra's plan adopts: capability ownership, dependency activation, reversible effects, diagnostics.

### Spectra current state

- `PluginConfig { name, path?, enabled? }` exists but is unused; custom tools loader adds tools only; `docs/plans/plugin-system-plan.md` (885 lines) defines the architecture.

### Steps

1. Implement the plan document's contract layer: `Plugin`, `Scope`, `Effect`, `ServiceRegistry`, diagnostics snapshot.
2. Loader: discovery from `plugins[]` and `.spectra/plugins/*/plugin.json`; dependency activation/deactivation; reverse-order disposal.
3. Contributions: tools, commands, prompt sections, message handlers, UI slots, settings entries.
4. Pipelines: ordered middleware for tool calls, provider requests, message transforms.
5. Permissions: every privileged contribution under `plugin:<name>`; plugin tools in the permission UI.
6. Failure isolation: activation timeout 10 s; throw/hang disables the plugin and reports once.
7. `docs/features/plugins.md`; sample plugin under `docs/plans/` fixtures.

**Adaptation:** no marketplace, remote install, or Rust parity. Plugin settings entries must register through the Phase 5 registry; plugin tools must appear in the permission UI.

### Verification

- `bun run test` — sample plugin tool+command; unload removes both; dependency reactivation; throwing plugin isolation; permission enforcement; settings contribution.
- Manual: enable/disable the sample plugin from the TUI.

**Acceptance**

- Sample plugin tool and command work from the TUI.
- Unload removes contributions without restart where the plan allows.
- Throwing plugin is disabled without failing the turn.
- Plugin tools appear under the plugin name in permissions/settings.

**Non-goals:** marketplace, remote install, Rust parity, sandboxing beyond the documented trust model.

---

## Explicitly out of scope

| Item | Why |
|---|---|
| Session branching, fork trees, worktree isolation | Deferred by decision. `session-store.fork` stays a whole-session copy; no worktrees. |
| Rewind picker / message-level rewind | Depends on branching; not planned. Snapshot revert remains the file-state mechanism. |
| DAP/debugger | Not requested; LSP client is the prerequisite. |
| Model catalog phases 2–5 | `TODO.md` §15. |
| Multimodal input | `TODO.md` §12. |
| Auth gateway / subscription proxying | `TODO.md` §11. |
| TTSR mid-turn rules | `TODO.md` §13; depends on plugin pipelines. |
| Browser relay / Tern / cmux | Phase 6b, consent UI required. |

## Cross-phase risks

| Risk | Mitigation |
|---|---|
| Scope drift | Acceptance criteria are the contract; anything else is a new `TODO.md` entry. |
| Docs after the fact | Page update is part of done. |
| Network tools bypassing policy (already true for `web_fetch`) | Phase 2 introduces `safeFetch`; no tool calls `fetch` directly afterwards. |
| LSP/browser availability varies | Explicit missing-binary errors; fake-server tests; no silent fallback. |
| Plugin failure taking down a turn | Activation timeout + per-plugin isolation. |
| Reference drift | Re-verify cited files before implementing; update this file if they moved. |
