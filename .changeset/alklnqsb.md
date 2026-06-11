---
'@mohanscodex/spectra-ai': patch
'@mohanscodex/spectra-agent': patch
'@mohanscodex/spectra-app': patch
'@mohanscodex/spectra-code': patch
---

TUI improvements and bug fixes

- Fix git branch path flash on Windows — use execFileSync with stdio ignore instead of bash redirect
- Add update check dialog on startup — checks npm registry, 24h cache, shows version and install command
- Add prompt badge mode — pastes >500 chars collapse into compact badge, enter to send, esc to edit
- Fix shell tool console bleed on Windows — always route through PowerShell to avoid cmd.exe output leaks
- Fix shell tool display — always show block view with "No output" indicator when empty
- Fix edit tool block — add blank line after heading for visual separation
- Move toast notifications to top-right corner
- Update Rust feature matrix — Provenance feature added
- Clean release workflow — remove automated body generation, delete per-package tags
- Remove graphify extension
