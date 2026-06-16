---
"@mohanscodex/spectra-ai": patch
"@mohanscodex/spectra-agent": patch
"@mohanscodex/spectra-app": patch
"@mohanscodex/spectra-code": patch
---

## Spectra v0.5.1

### Parallel Sessions
- Multi-session agent history with persistence and compaction
- Per-session state isolation — messages, loading states, and streaming don't leak across sessions
- Per-session streaming guard so new sessions aren't blocked by running ones
- Session status bar showing background session activity
- SwitchSession wired into handleSubmit for immediate message rendering

### Provider Integrations
- Coding plan provider integrations with live model fetching
- Configurable cache retention for Anthropic client
- Prompt caching hints for Anthropic and OpenRouter

### Reliability & Edge Cases
- Propagate abort signal to subagents and fix interrupted indicator ordering
- Handle interrupt edge cases for DeepSeek and other strict providers
- Preserve thinking-only messages on interrupt, only pop truly empty ones
- Doom loop detector only triggers on 5+ continuous identical calls
- Increase shell tool timeout to 30 min default, 60 min max

### TUI & UX
- Tool display overlap fix, shell title dimness, and agent maxTurns optional
- Clearer tool display labels
- Toast feedback for auto-copy on selection and manual copy actions
- Correct bundled skills count from 185+ to 60+

### Testing & CI
- Fix ACP test to include 'general' agent definition
- Use bun:sqlite with better-sqlite3 fallback for tests
- Move better-sqlite3 to runtime dependencies
- Fix flaky session store test with timing delay
- CI: matrix build with native runners, build-binaries workflow with smoke test
- Platform-native release binaries: Windows .msi, macOS .dmg, Linux .tar.gz
