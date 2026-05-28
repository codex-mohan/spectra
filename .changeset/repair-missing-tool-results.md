---
"@mohanscodex/spectra-ai": patch
---

Inject synthetic error tool results in convertMessages when tool calls lack matching toolResult messages, preventing strict providers (DeepSeek, Anthropic) from rejecting requests with unmatched tool_call_ids.
