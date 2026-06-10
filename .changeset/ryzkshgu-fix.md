---
'@mohanscodex/spectra-ai': patch
'@mohanscodex/spectra-agent': patch
---

Fix security and reliability issues in TypeScript SDK

- Implement `sanitizeSurrogates` to properly remove unpaired Unicode surrogates
- Fix retry logic: remove orphaned partial messages from history before retry
- Replace brittle string-based error detection with status code checks and regex
- Add abort-aware sleep with jitter for retry backoff
- Add `onRetry` hook for consumer visibility and control over retry decisions
- Remove redundant Groq provider (now uses OpenAI-compatible wrapper)
- Fix `EventStream.result()` hanging forever if stream ends without completion event
- Add `res.ok` check to OpenRouter `fetchLiveModels`
