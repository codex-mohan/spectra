# Context compaction

> Compaction keeps a session inside its model's context window by summarizing the older message prefix into one synthetic user message, triggered automatically before a model call or manually with `/compress`.

## Source

- Entry: `packages/code/src/services/compaction.ts` — token estimation (`estimateTokens` line 55, `estimateMessageTokens` line 78), provider usage normalization (`promptTokensFromUsage` line 128), budgeting (`resolveCompactionBudget` line 151, `needsCompaction` line 194), cut-point selection (`findCompactionCutPoint` line 230), summary construction (`buildCompactionPrompt` line 269), application (`compactMessages` line 273), and the automatic hook (`createTransformContextFn` line 294).
- Context assembly: `packages/code/src/services/context.ts` — `composeContext` (line 62) builds the system prompt sections and instruction files that count as non-message tokens.
- Accounting: `packages/code/src/services/context-usage.ts` — `createPreparedContextSnapshot` (line 124), `completeContextSnapshot` (line 162), `restoreLatestContextSnapshot` (line 197), `createContextBreakdown` (line 266).
- Automatic wiring: `packages/code/src/tui/hooks/use-agent.ts:278-289` (agent creation) and `:292-316` (`beforeModelCall` snapshot); a second wiring path exists at `:518-537`.
- Manual command: `packages/code/src/tui/commands.ts:614-676` — `/compress`.
- Surfaces: `packages/code/src/tui/commands.ts:906-913` (`/context`), `packages/code/src/tui/ui/context-usage-dialog.tsx`, `packages/code/src/tui/ui/session-stats-dialog.tsx:124-127`.

## Registration / gating

- Automatic compaction is enabled by passing `transformContext` to `new Agent(...)`; the TUI always does so with `createTransformContextFn(() => compactionModelsRef.current.get(key), getAuthKey, {}, { onCompacted })` (`use-agent.ts:278-289`).
- It runs only when a model info entry exists for the session and `resolveCompactionBudget(contextWindow)` returns a budget, so an unknown or non-positive context window disables it entirely.
- Manual compaction is the `/compress` palette entry (label "Compress Context", category Conversation). No `/compact` slash name exists.
- Permission profile: none for the local estimation path; network for the summarization request, which uses the session provider's credential.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `contextWindow` | `number` | yes | Model window; from `customCfg.models[id].contextWindow` or `lookupContextWindow` (`use-agent.ts:156`). |
| `threshold` | `number` | no | Fraction of the window that becomes the threshold. |
| `thresholdTokens` | `number` | no | Absolute threshold; wins over `threshold`. |
| `reserveTokens` | `number` | no | Reserve floor, default 16,384. |
| `keepRecentTokens` | `number` | no | Retained tail budget, default 20,000. |
| `nonMessageTokens` | `number` | no | System prompt, tools, context messages, skills; supplied by the prepared snapshot. |
| `messages` | `readonly Message[]` | yes | Canonical session transcript. |
| `getModel()` | `() => CompactionModelInfo \| null` | yes | `{ model, provider, contextWindow?, nonMessageTokens?, headers? }`. |
| `getApiKey(provider)` | `(p: string) => string \| undefined` | yes | Resolved via `getAuthKey` from `auth.json`. |

## Outputs

- `compactMessages` returns a new array: one user message `[Context Compaction]\n\n<summary>` with `metadata.compactedMessageCount`, followed by the untouched tail (`compaction.ts:282-290`).
- `createTransformContextFn` returns `Message[]`; the agent sees the compacted transcript for that call and every later call it caches.
- `onCompacted(messages)` fires after a successful compaction so the caller can persist; the TUI assigns `session.messages` and calls `sessionStore.save` (`use-agent.ts:283-288`).
- `needsCompaction` returns a boolean; `resolveCompactionBudget` returns `CompactionBudget | undefined`.
- No files are written by this service; persistence is the session store's job.

## Flow

1. `beforeModelCall` builds a prepared snapshot and writes `nonMessageTokens` into the session's `CompactionModelInfo` (`use-agent.ts:292-316`).
2. `createTransformContextFn` reuses its cached compaction when the source transcript still extends it, otherwise recomputes (`compaction.ts:303-309`).
3. Context size is `max(latestProviderPromptTokens, local estimate excluding opaque reasoning + nonMessageTokens)` (`compaction.ts:185-192`).
4. If that is `<= thresholdTokens`, messages pass through unchanged (`compaction.ts:316`).
5. `findCompactionCutPoint` walks backwards accumulating `estimateMessageTokens` until `keepRecentTokens` is reached, then `safeTailStart` refuses to split a tool call from its results (`compaction.ts:209-240`).
6. A missing API key or an aborted signal returns the original messages (`compaction.ts:321-322`).
7. `buildCompactionPrompt` serializes the prefix under `SUMMARY_PROMPT` (goal, decisions, files, tool results, next steps; "Do not invent facts") and streams it with `maxTokens = summaryMaxTokens` (`compaction.ts:9-20`, `332-341`).
8. Only `text_delta` chunks are accumulated; an empty or aborted summary aborts the compaction (`compaction.ts:341-342`).
9. `compactMessages` applies the summary only if the estimated total strictly shrinks; otherwise the original array is returned (`compaction.ts:291`).
10. `/compress` requires at least four messages, an active session, a selected model and provider, and a non-empty `getAuthKey`; it summarizes the entire transcript, requires a trimmed summary of at least 50 characters, then compacts with default settings and saves the session (`commands.ts:620-671`).

## State / persistence

- The compacted array replaces `session.messages` in the session store and is written to disk there; the summary text is a normal user message, so it survives restarts and reloads.
- `createTransformContextFn` holds a one-entry cache keyed by `sourceLength` plus the identity of the last source message (`compaction.ts:300`, `348-352`).
- `ContextUsageSnapshot` is attached to each persisted assistant message under `metadata.contextUsage` (`use-chat-submit.ts:556-566`) and restored with `restoreLatestContextSnapshot` when a session is loaded (`app.tsx:647`, `1143`, `1441`).
- `context-usage.ts` caches tool-token estimates by serialized-tool hash, capped at 32 entries (`context-usage.ts:75-76`).

## Security

- The summary request goes through the normal provider transport with the session provider's key; no additional network endpoints are contacted.
- Serialized prefix content includes tool results, file paths, and thinking blocks, so it is sent to the same provider that already saw those messages.
- Abort signals are checked before the request and between stream chunks (`compaction.ts:321`, `339`).
- The service never logs message content and performs no file access of its own.

## Errors

| Condition | Result |
| --- | --- |
| Unknown/zero context window | No budget; messages pass through unchanged |
| Fewer than two messages | `needsCompaction` false; `compactMessages` returns a copy |
| No API key for the provider | Unchanged messages, no error surfaced |
| Aborted before or during streaming | Unchanged messages |
| Empty summary | Unchanged messages |
| Summary does not reduce estimated size | `compactMessages` returns the original array |
| Provider throws during summarization | Caught; unchanged messages |
| `onCompacted` throws | Swallowed; the in-memory compaction is kept (`compaction.ts:353-357`) |
| `/compress` with fewer than four messages | Toast `Not enough messages to compact` |
| `/compress` summary shorter than 50 chars | Toast `Compaction produced no useful summary` |
| `/compress` failure | Toast `Compaction failed: <message>` |

## Limitations

- Token counts are heuristic: UTF-8 bytes divided by four, plus 1,200 per image and four framing tokens per message (`compaction.ts:4-7`, `55-58`); they are not provider tokenizers.
- The provider anchor comes from the most recent successful assistant message and can overstate or understate the current prefix.
- Cuts are message-granular; a single oversized message cannot be split.
- Automatic compaction needs `getAuthKey(provider)` to return a key, which reads only `auth.json`; a custom provider configured solely with `apiKey` in `spectra.json` therefore never auto-compacts.
- Manual `/compress` ignores the context-window budget, does not cap summary tokens, and summarizes messages that it will also retain.
- The automatic path supplies no `maxTokens` override beyond `summaryMaxTokens` and no temperature, so summary style is provider-default.
- `/compress` is the only manual entry point; there is no `/compact` alias.
- `context.ts` contributes only system-prompt text and reference/instruction blocks to the accounting; its instruction-file discovery is capped at depth 5 and 1,000,000 characters per file.

## Tests

- `packages/code/src/__tests__/context-usage.test.ts` — default budget for a 100k window (reserve 16,384, threshold 83,616), unknown window yields no budget, cut point keeps a tool call with its result, cache-usage normalization across Anthropic/OpenAI/unknown providers, prepared-estimate fallback when usage is absent, and exactly 200 grid cells with tiny categories retained.
- No test exercises `createTransformContextFn` streaming or `/compress` end to end; that path is unverified by tests.

## Related

- `docs/features/providers.md` — transport used for the summary request.
- `docs/features/model-service.md` — context-window lookup and headers.
- `docs/features/sessions.md` — persistence of compacted transcripts.
- `docs/features/agent-loop.md` — where `transformContext` runs.
- `docs/features/config.md` — custom-provider `contextWindow` values.
