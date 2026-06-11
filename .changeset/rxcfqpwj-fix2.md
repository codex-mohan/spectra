---
'@mohanscodex/spectra-code': patch
---

Fix TUI bugs and improve experience

- Fix git branch path flash on Windows (use execFileSync with stdio ignore)
- Add update check dialog (npm registry, 24h cache, clipboard copy)
- Add prompt badge mode for large text pastes (>500 chars)
- Fix shell tool console bleed on Windows (always use PowerShell)
- Fix shell tool display — always show block with "No output" when empty
- Fix edit tool block spacing — add blank line after heading
