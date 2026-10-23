---
"@mohanscodex/spectra-ai": patch
"@mohanscodex/spectra-code": patch
---

Price each assistant turn once, at provider finalization, and store it on the message so the status bar sums what was actually billed instead of recomputing a guess.

Pricing is now provider-scoped: the same model id on different providers no longer shares one card, `openai-codex` resolves through the `openai` rate card, and fuzzy id matching is gone. Cache reads and writes are priced, and OpenAI prompts bill only the uncached portion at input rates while Anthropic keeps reporting cache tokens separately. Unknown models report `unknown` instead of `Free`, and observed usage entries record cache tokens.

API note: `calculateCost`/`isFreeModel` are replaced by `calculateUsageCost`/`getPricingStatus`; `Usage` gains `inputUncached` and a named `UsageCost`; `Model` gains `cost`.
