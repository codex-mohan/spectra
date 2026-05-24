---
"@mohanscodex/spectra-ai": patch
"@mohanscodex/spectra-agent": patch
"@mohanscodex/spectra-app": patch
---

feat: add thinking effort API parameter for reasoning model variants

- Add `thinkingEffort` field to `StreamOptions` for per-request reasoning control
- Anthropic: maps effort to extended thinking with budget tokens (low=2048, medium=8192, high=16000, max=31999)
- OpenAI Completions: maps effort to `reasoning_effort` param
- OpenAI Responses: maps effort to `reasoning.effort` param  
- Provider-specific defaults: thinking enabled for zai/zhipuai, `enable_thinking` for alibaba-cn
- TUI: variant cycle (ctrl+t) cycles through thinking effort levels per provider
