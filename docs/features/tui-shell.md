# TUI shell

> `launchTui()` mounts an OpenTUI React root and `App` owns the terminal interface: home and chat routes, the prompt bar, the streaming transcript, the overlay/dialog set, and per-session view state.

## Source

- Entry: `packages/code/src/tui/index.tsx` — `launchTui()` creates the renderer, registers tree-sitter parsers, renders `App`, and waits for the renderer's `destroy` event.
- Shell: `packages/code/src/tui/app.tsx` — `App`, route state, overlay conditionals, child-session view switching, command registry construction, streaming render loop.
- Prompt: `packages/code/src/tui/prompt-bar.tsx` — `PromptBar`, attachment extmarks, paste handling, submit lifecycle.
- Hooks: `packages/code/src/tui/hooks/use-agent.ts` — per-session `Agent` construction/configuration/restore/abort; `packages/code/src/tui/hooks/use-chat-submit.ts` — submit, steering, `agent.run()` event projection.
- Chrome: `packages/code/src/tui/footer-status.ts` — pure footer status precedence and width budget; `packages/code/src/tui/ui/modal-frame.tsx` — absolute overlay frame.
- Home footer: `packages/code/src/tui/components/git-status.tsx` — `GitStatusSegment`; `packages/code/src/tui/utils/git-status-layout.ts` — pure layout/priority rules; `packages/code/src/tui/hooks/use-git-status.ts` — polling and dedupe; `packages/code/src/services/git-status.ts` — porcelain v2 reader.
- Collaborators:
  - `packages/code/src/tui/hooks/use-session-state.ts` — per-session UI state store (messages, loading, tokens, cost, pending queues).
  - `packages/code/src/tui/hooks/use-app-keyboard.ts` — key routing, including `dialogKeyHandler` ownership.
  - `packages/code/src/tui/hooks/use-permission-queue.ts` — serializes permission dialogs.
  - `packages/code/src/services/session-store.ts`, `session-manager.ts`, `snapshot-manager.ts` — transcript persistence, session lifecycle, pre-edit snapshots.
  - `packages/code/src/tui/commands.ts`, `command-types.ts` — palette items and slash registry.

## Registration / gating

- Launched by the CLI's default `$0` command: `packages/code/src/cli.ts:22-31` imports `./tui/index.js` and awaits `launchTui({})`.
- Renderer options are fixed at launch: `exitOnCtrlC: false`, `targetFps: 30`, `useMouse: true`, `screenMode: 'alternate-screen'` (`tui/index.tsx:30-35`).
- `TuiOptions.sessionId` exists but `launchTui(_options)` never reads it; every launch starts at the home route (`tui/index.tsx:8-11`, `app.tsx:94`).
- No config key gates the shell itself. Mount reads `loadConfig()` for custom providers, permission/security config, and `commands.shellExecution`, and `loadSavedConfig()` for the last model/provider.
- Permission profile: the shell performs no policy enforcement; tool calls are gated by the wrapper in `packages/code/src/tools/index.ts` (see [permissions.md](permissions.md)).

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `launchTui.sessionId` | `string` | no | Declared in `TuiOptions`; unused by the implementation. |
| `App.renderer` | `CliRenderer` | yes | Renderer created in `launchTui`; also used for `requestLive`/`dropLive` while streaming. |
| `PromptBar.onSubmit` | `(payload: { text, attachments }) => void` | yes | Receives trimmed prompt text plus attachment records; `App` passes `handleSubmit`. |
| `PromptBar.onSubmitIntercept` | `(text) => boolean` | no | Returning `true` consumes the submit without sending (mid-text skill completion). |
| `PromptBar.inputKey` | `string \| number` | yes | Textarea remount key; includes `submitKey` and `navKey` and differs between home and chat, so submitting or changing routes resets the input. |
| `PromptBar.width` | `number \| 'auto'` | no | Home uses `min(68, termWidth - 8)`; chat uses `termWidth - 4`. |
| `GitStatusSegment.maxWidth` | `number` | yes | Space left of the version label; the segment drops sync, counts, branch, then truncates the path to fit. |
| `ModalFrame.width` / `height` / `top` | `number` / `number` / `'center' \| 'upper'` | yes | Overlay size and vertical placement; width is clamped to `termWidth - 4`. |

## Outputs

- Render tree: OpenTUI `box`/`text`/`textarea`/`scrollbox` nodes; the shell writes UI through the renderer rather than stdout.
- Overlays emitted in JSX order after the route body: command palette, slash/arg/file autocomplete, one `dialogStep` dialog, update dialog, message controls, permission dialog, ask menu, toast container (`app.tsx:1069-1492`).
- `MessageView` is memoized; only the message whose object changed re-renders. The transcript's scrollbox uses viewport culling.
- Transcript messages are persisted through `SessionStore.addMessage`/`save`; assistant metadata gains `turnDurationMs`, `turnTokens`, `patch`, `contextUsage`, `turnStatus` (`use-chat-submit.ts:540-590`).
- Terminal title is set at mount and on session load/switch (`setTerminalTitle`, `formatSessionTitle`).
- Home footer left segment: folder glyph + path (home shortened to `~`, separator-normalized), `›`, branch glyph + branch, ahead/behind, then `!conflicts`, `*changed`, `?untracked`. Refresh runs on mount, every 5 s, and when a turn finishes; it is asynchronous and never blocks the render loop. Transient git failures keep the last good status and only clear after three consecutive misses.
- Clipboard writes occur on terminal selection and when installing an update copies `UPDATE_COMMAND`.

## Flow

1. `launchTui()` prefixes `console.error` output with `[spectra]`, installs rejection/exception loggers, registers parsers, creates the renderer, renders `App`, and resolves only when the renderer is destroyed (`tui/index.tsx:12-44`).
2. `App` reads `useTerminalDimensions()` for width/height and is state-driven: `route` is `'home' | 'chat'`; `home` renders `HomeTitle`, a centered `PromptBar`, hints, a stats row, `Tips`, and a git-aware footer; `chat` renders `ChatArea`, `PendingQueue`, the prompt (or `SubagentNav` in a child view), and `ActivityFooter` (`app.tsx:95`, `:902-1065`).
3. Prompt typing updates `draftText`/`draftCursor`; front-of-prompt slash input drives `SlashAutocomplete`, argument input drives `ArgAutocomplete` after `argCompleter`, and `@` drives `FileAutocomplete` (`app.tsx:755-805`).
4. `PromptBar.handleSubmit` strips attachment badge text, trims, syncs extmarks, runs the intercept hook, clears extmarks, then calls `onSubmit` (`prompt-bar.tsx:265-279`).
5. `handleSubmit` first tries slash dispatch when the text starts with `/` and has no attachments; unresolved heads produce a warning toast; otherwise it forwards to `submitPrompt` (`use-chat-submit.ts:781-810`).
6. `submitPrompt` snapshots the turn configuration from refs, creates a session on first send, persists the user message, marks the session loading, routes to chat, and resolves the per-session agent (`use-chat-submit.ts:234-450`).
7. Streaming projects `agent.run()` events into UI messages: assistant placeholder on `message_start`, text/blocks and partial tool arguments on `message_update`, final usage/duration/cost on assistant `message_end`, tool rows on `tool_execution_start|update|end`, and `Ready`/`Error` on `agent_end` (`use-chat-submit.ts:451-680`).
8. While `isLoading`, an 80 ms spinner interval advances `SPINNER` and calls `renderer.requestLive()`; cleanup calls `renderer.dropLive()` (`app.tsx:382-391`). Streaming deltas are coalesced into one state commit per animation frame; the transcript renders streamed text as plain wrapped text until the message settles, then switches to `<markdown>`.
9. Overlays are gated by state: `showCmd`, `dialogStep`, `updateVersion`, `msgControls`, `permissionRequest`, `askRequest`; the prompt is unfocused while `showCmd`, `dialogStep`, `msgControls`, `permissionRequest`, or `askRequest` is set, and `updateVersion` does not affect focus (`app.tsx:922`, `:1039`).
10. Child view: `ChatArea.onTaskClick` calls `handleViewChildSession`, which records the parent id and `switchToChildSession` loads the child transcript/state, restores its agent history, resets read/doom-loop trackers, and retitles the terminal (`app.tsx:637-696`).
11. Child-view keys are handled before the main keyboard hook: `Esc` exits (ignored while streaming), `p` moves to the parent, `[`/`]` cycle siblings; overlay states suppress child keys (`app.tsx:699-752`).
12. Exit runs one idempotent `shutdown()`: save the draft, abort the streaming turn, close MCP servers, close the SQLite session store, cancel owned background tasks, then destroy the renderer (2 s fallback). Ctrl+C clears a draft and exits on the second press within 500 ms; Ctrl+D exits. `/exit` remains renderer-driven (`tui/commands.ts:1025-1033`).

## Footer layout rules

- Repository: `folder path › branch-glow branch ahead behind !conflict *changed ?untracked`.
- Counts: `!` = conflicted, `*` = staged + modified, `?` = untracked.
- Detached HEAD shows the short oid plus `(detached)`; no branch segment outside a repository.
- Priority when narrow: version label, sync, untracked, changed, branch, path detail. Conflicts are never dropped.
- Glyphs come from `glyphFor()`; Nerd Font glyphs with plain fallbacks, never emoji.

## State / persistence

- Session transcripts live in `SessionStore`; `useSessionState` keeps UI-only per-session state (messages, loading, status, token usage, elapsed time, tokens/s, cost, pending steering/follow-up, selected model/provider/agent/effort, context usage).
- Streaming bookkeeping is in refs, not React state: `streamingSessionsRef`, `isStreamingRef`, `shownToolCalls`, `toolMsgMap`, `toolArgsMap`, `partialToolJson`, `preEditSnapshotRef` (`use-chat-submit.ts:130-150`).
- `useAgent` keeps one `Agent` per `sessionId:session` key plus compaction/attribution/fingerprint maps; `removeSessionAgent` resets and deletes all entries (`use-agent.ts:45-52`, `:375-395`).
- Template command definitions are loaded once at mount and stored in `templateDefinitions`; diagnostics are toasted once per unique `kind:path:message`.
- Restart restores transcripts through `SessionStore`; `dialogStep`, drafts, autocomplete selections, spinner frame, the viewed child session, and toast history are in-memory. The selected model/provider is re-read from saved config.

## Security

- The TUI does not authorize tools. Permission prompts, path safety, read-before-write tracking, SSRF blocking, and loop detection all run in `wrapExecute` (`tools/index.ts:64-230`).
- Permission requests are queued and shown one at a time; `PermissionDialog` offers Allow Once, Allow Always, and Deny, and `onClose` resolves as deny (`app.tsx:1456-1476`, `tui/ui/permission-dialog.tsx:27-29`).
- Ask requests resolve `undefined` when the turn's `AbortSignal` fires, so an interrupted run cannot hang on a question (`app.tsx:273-300`).
- Each turn calls `SnapshotManager.track()` before streaming and `patch()` at assistant completion, so revert metadata is attached per assistant message (`use-chat-submit.ts:409-415`, `:543-556`).
- Selecting terminal text copies it to the clipboard after a 2 s delay; failures are swallowed (`app.tsx:393-411`).
- Child view switching resets read/doom-loop tracking, so a child cannot inherit a parent's read-before-write credits (`app.tsx:669-670`, `:684-686`).

## Errors

| Condition | Result |
| --- | --- |
| Renderer creation or `root.render` throws | `console.error('TUI launch failed:', err)` then `process.exit(1)`. |
| Unhandled rejection / uncaught exception | Logged through the patched `console.error`; the UI keeps running. |
| Template load diagnostic | Warning toast per unique diagnostic; the offending template is not registered. |
| `agent.run()` throws | A synthetic assistant message `[error] <message>` is appended, status becomes `Error`, and the last assistant metadata gets `turnStatus: 'error'` (`use-chat-submit.ts:681-720`). |
| `agent_end` carries `errorMessage` | Status `Error` and `turnStatus: 'error'`; otherwise `Ready`/`completed`. |
| Slash head does not resolve | Toast: "Select a slash command with tab or enter before submitting". |
| Command dispatch rejects | Not caught by `handleSubmit`; the promise rejects and the global `unhandledRejection` logger reports it. No toast is shown. |
| Provider/model not selected | Toast "Connect a provider to send prompts"; submission stops before session creation. |

## Limitations

- `TuiOptions.sessionId` is accepted but ignored; there is no startup flag to open a specific session.
- The home stats row hardcodes the tool count (`'7 tools'`), so it does not track the actual registry (`app.tsx:958`).
- Only one session is visible. Background sessions continue streaming but their events are applied to that session's state, not the visible one.
- Exactly one `dialogStep` can be set at a time; the update dialog, message controls, permission dialog, and ask menu are independent booleans/objects and can render alongside a `dialogStep`.
- Overlay ordering is implicit JSX order; there is no explicit z-index or focus stack.
- The prompt textarea is capped at six lines; longer pasted text stays inline unless it resolves to a file or image attachment.
- Command execution errors are not converted into UI errors; they surface through the unhandled-rejection logger.
- Home-route `ActivityFooter` is only rendered for `Error`/`Interrupted`, with `runningTools={0}` and empty metrics.

## Tests

- `packages/code/src/__tests__/footer-status.test.ts` — status precedence (permission/question waits over tools), stale-notification suppression, tone selection, label truncation, and width-budget invariants for 0-240 columns.
- `packages/code/src/__tests__/prompt-bar-layout.test.ts` — explicit width keeps `rootWidth`/`bodyWidth`; omitted width stays `'auto'`.
- `packages/code/src/__tests__/prompt-submit-lifecycle.test.tsx` — extmarks are cleared before synchronous teardown, and the submitted payload is `{ text, attachments }`.
- `packages/code/src/__tests__/tui-input-lifecycle.test.ts` — permission dialogs own navigation keys ahead of stale message-control handlers; drafts typed during a stream survive completed, errored, and interrupted outcomes.

## Related

- [commands-templates.md](commands-templates.md) — palette and slash dispatch consumed by `App`.
- [permissions.md](permissions.md) — dialog requests, path safety, loop detection.
- [doctor.md](doctor.md) — `/doctor` dialog content.
- [sessions.md](sessions.md), [snapshots.md](snapshots.md), `settings.md` — persistence, revert, and planned settings surface.
