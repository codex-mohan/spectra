---
"@mohanscodex/spectra-ai": minor
"@mohanscodex/spectra-agent": minor
"@mohanscodex/spectra-app": minor
"@mohanscodex/spectra-code": minor
---

## Spectra v0.6.0

### Core packages

- `@mohanscodex/spectra-ai`, `@mohanscodex/spectra-agent`, and `@mohanscodex/spectra-app` remain the unified core SDK packages.
- `@mohanscodex/spectra-code` is the terminal TUI app built on the core packages with OpenTUI. The archived `@mohanscodex/spectra-tui` package is not part of the release train.

### Provider and model layer

- Added file content blocks with filename, path, MIME, size, and data fields so prompts can carry local file attachments through provider serialization.
- Expanded built-in provider coverage for OpenAI-compatible cloud providers, coding-plan endpoints, and local runtimes including Ollama, LM Studio, llama.cpp, vLLM, and SGLang.
- Added OAuth/device-login support for Kimi Code and OpenAI Codex style coding providers.
- Added provider usage recording and reporting, including live usage fetches for supported coding plans and cache-aware token accounting.
- Refreshed generated model metadata for newer provider models.

### Agent and orchestration

- Added the `runSubagent` primitive for bounded child-agent execution with model overrides, budgets, event forwarding, abort propagation, and error reporting.
- Improved steering and follow-up queue semantics so queued messages drain reliably during active streams without duplicate submissions.
- Surfaced loop-end reasons and kept loop warnings in UI status/toasts instead of injecting them into tool messages.
- Added structured task reporting for background and foreground subagent work.

### Spectra App infrastructure

- Added layer-2 orchestration that wires `AgentRegistry` delegation through `runSubagent`.
- Improved session provenance and parity behavior across session stores.
- Kept the fixed-version core package release unified across `ai`, `agent`, `app`, and the `code` app.

### Spectra Code TUI app

- Added multi-agent collaboration with foreground subagents, background task mode, child-session navigation, and subagent status rendering.
- Added local file attachments: `@` fuzzy file autocomplete, MIME detection, file visuals, prompt badges, transcript persistence, and provider handoff.
- Added the phased todo tool and `/todo` command with inline hierarchical rendering, validation errors, import/export/edit/copy flows, and command palette integration.
- Added memory tool rendering with scope-aware theming and skipped unnecessary permission prompts for non-file utility tools.
- Added prompt-anchored autocomplete for slash command arguments and file paths, plus command/menu selection-window refinements.
- Added shell timing metadata, timeout footers, syntax highlighting parser registration, source-aware code block styles, and improved file-icon/color visuals.
- Improved provider, skills, memory, usage, cost, settings, update, doctor, and modal dialog polish.
- Moved steering message display to render immediately and fixed duplicated or delayed steering submissions.
- Fixed child-session filtering, subagent view layout, bottom navigation controls, tool status icons, shell metadata display, edit diff spacing, inline tool titles, and redundant icons.

### Release and CI/CD

- Updated release automation to delete package-scoped tags/releases, create or update one unified `vX.Y.Z` GitHub release, and trigger platform binary builds for that unified tag.
- Expanded published-package smoke testing to include `@mohanscodex/spectra-code` alongside the core packages.
- Fixed Windows binary packaging by dynamically generating WiX components, installing WiX v4 through the dotnet toolchain, and correcting variable usage.
- Updated READMEs to reflect the current core package split, OpenTUI-based Spectra Code app, feature matrix, providers, attachments, todos, and release packaging.
