---
"@mohanscodex/spectra-ai": patch
"@mohanscodex/spectra-code": patch
---

Model discovery now reports an outcome instead of throwing: either a roster (an empty roster means the provider authoritatively lists nothing) or a failure carrying the HTTP status. Providers normalize rows through one shared helper that understands the envelope shapes gateways use, context/output limits, modalities, and tool support. `ModelInfo` gained `api`, `baseUrl`, `maxTokens`, `reasoning`, and `cost`, and the duplicate OpenAI-compatible wrapper was removed.

The catalog keeps bundled rows when discovery fails and no longer pins authority in the cache for an empty successful roster.
