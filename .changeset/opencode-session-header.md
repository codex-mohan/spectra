---
'@mohanscodex/spectra-code': patch
---

Send OpenCode Zen gateway routing headers (`x-opencode-session` plus a client `User-Agent`) on OpenCode Go/Zen requests. The gateway rejects conversation traffic without a stable session id (`400 … missing x-opencode-session`), which broke every chat, compaction, and ACP run on those providers.
