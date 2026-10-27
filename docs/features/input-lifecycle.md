# Input lifecycle

> One owner for Escape and the exit keys: Escape never destroys a draft, Ctrl+C clears before it exits, and every exit path runs the same shutdown.

## Source

- `packages/code/src/tui/hooks/use-app-keyboard.ts` — editor key dispatch, menus and autocomplete take precedence.
- `packages/code/src/tui/input/escape-ladder.ts` — `resolveEscapeAction()`, the editor-level Escape decision.
- `packages/code/src/tui/input/exit.ts` — `createExitGate()`, the Ctrl+C clear/arm/exit state machine.
- `packages/code/src/services/draft-store.ts` — `saveDraft`, `consumeDraft`, `clearDraft`.
- `packages/code/src/tui/app.tsx` — `shutdown()`, draft save/restore wiring.
- `packages/code/src/tui/index.tsx` — `exitOnCtrlC: false`; Ctrl+C reaches the app.

## Registration / gating

- Always active while the Composer has focus in the TUI.
- No config key and no permission profile: the handlers only mutate editor state, the session, and process lifecycle.
- Keys are hardcoded in this phase: `Escape`, `Ctrl+C`, `Ctrl+D`.

## Inputs

| Key | Preconditions | Effect |
| --- | --- | --- |
| `Escape` | file @-mention open | dismisses nothing from this layer; the completion surface handles it |
| `Escape` | turn streaming | aborts the turn, marks the message `interrupted`, sets status `Interrupted` |
| `Escape` | draft non-empty, idle | no-op; the draft is preserved |
| `Escape` | empty, idle | no-op (double-Escape action is unbound) |
| `Ctrl+C` | draft non-empty | clears the draft and prompt bar, arms exit |
| `Ctrl+C` | draft empty, last clear ≤ 500 ms | exits |
| `Ctrl+C` | draft empty, no recent clear | arms exit |
| `Ctrl+D` | any | exits |

Menu precedence is unchanged: permission dialog, `ask`, shared dialog steps, update prompt, message controls, command palette, slash arguments, slash completion, and file completion consume the key before this layer.

## Outputs

- Escape → `abortSession(sessionId)`, message/turn metadata updated to `interrupted`, status `Interrupted`.
- Ctrl+C → `setDraftText('')`, `promptBarRef.setText('')`.
- Exit → `shutdown(reason)`.
- No files are written by keys; the draft sidecar is written only during shutdown.

## Flow

1. `useKeyboard` receives the key. Dialog and completion branches return before the editor ladder.
2. Ctrl+C/D call `exitGateRef.current.ctrlC()/ctrlD()`.
3. `resolveEscapeAction({ fileAtActive, isStreaming, hasDraft })` decides `ignore`, `interrupt`, `keep-draft`, or `none`.
4. On exit, `shutdown()` is idempotent (`shuttingDownRef`):
   1. `saveDraft(sessionId, draftText)` — empty text deletes the sidecar.
   2. Abort the active session if streaming.
   3. `shutdownAllServers()` for MCP.
   4. Close the SQLite session store.
   5. Cancel running background tasks owned by the session.
   6. `renderer.destroy()` — after those settle, or after a 2 s fallback timer.
5. On session load (session list) and child-view switch, `consumeDraft(id)` restores text into `draftText` and the prompt bar.

## State / persistence

- Draft sidecar: `<SPECTRA_HOME>/drafts/<encodeURIComponent(sessionId)>.txt`, created with mode `0600`.
- `saveDraft` writes non-empty text and deletes the file for whitespace-only text.
- `consumeDraft` reads then deletes the file, so a restored draft is never restored twice.
- `clearDraft` deletes without reading.
- Only the active session's draft is saved; child-session drafts are saved when that session is active.

## Security

- A draft can contain secrets, so it is stored under the user's Spectra home with mode `0600` and never logged.
- The draft path is derived from `encodeURIComponent(sessionId)`; path traversal through a crafted session id is not possible.
- Persistence failures never block shutdown.

## Errors

| Condition | Result |
| --- | --- |
| Draft directory missing | created on first save |
| Draft write fails (permissions, disk) | swallowed; exit continues |
| Draft file unreadable or corrupt | `consumeDraft` returns `null`; the session opens with an empty prompt |
| Second Ctrl+C after the 500 ms window | re-arms; no exit |
| Shutdown called twice | second call is a no-op |

## Limitations

- Cleared drafts are discarded; they are not recallable through prompt history.
- Key bindings are not configurable.
- There is no `--continue` flag; drafts are restored when a session is opened from the session list or when a child session is focused.
- The empty-editor double-Escape action is unbound because Spectra has no rewind or tree picker.

## Tests

- `packages/code/src/__tests__/exit-contract.test.ts` — Escape ladder table, Ctrl+C clear/arm/exit timing, Ctrl+D, draft round-trip, whitespace clearing, unwritable home, footer hint.
- `packages/code/src/__tests__/tui-input-lifecycle.test.ts` — dialog precedence and draft preservation across turn outcomes.
- `packages/code/src/__tests__/footer-status.test.ts` — streaming footer no longer advertises a second Escape.
- Manual smoke: idle Escape keeps the process alive; two Ctrl+C presses exit 0; Ctrl+D exits 0.

## Related

- `sessions.md` — session load path that triggers draft restore.
- `tui-shell.md` — prompt bar and footer surfaces.
- `commands-templates.md` — slash and mid-text command precedence above the ladder.
