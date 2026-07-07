# @mohanscodex/spectra-code

## 0.6.1

### Patch Changes

- [`a258557`](https://github.com/codex-mohan/spectra/commit/a25855716665c6486ad116682894a16b6f47c622) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Fix the update dialog to copy `bun add -g @mohanscodex/spectra-code@latest` so users can cross `0.x` minor version boundaries.

- Updated dependencies []:
  - @mohanscodex/spectra-ai@0.6.1
  - @mohanscodex/spectra-agent@0.6.1

## 0.6.0

### Minor Changes

- [`559df82`](https://github.com/codex-mohan/spectra/commit/559df8208f6e8e376ab5513ecc235ac57619a035) Thanks [@codex-mohan](https://github.com/codex-mohan)! - ## Spectra v0.6.0

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

### Patch Changes

- Updated dependencies [[`559df82`](https://github.com/codex-mohan/spectra/commit/559df8208f6e8e376ab5513ecc235ac57619a035)]:
  - @mohanscodex/spectra-ai@0.6.0
  - @mohanscodex/spectra-agent@0.6.0

## 0.5.1

### Patch Changes

- [`8f79d92`](https://github.com/codex-mohan/spectra/commit/8f79d92fb2049cfc55c836e9e6f8a28230eb5f74) Thanks [@codex-mohan](https://github.com/codex-mohan)! - ## Spectra v0.5.1

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

- Updated dependencies [[`8f79d92`](https://github.com/codex-mohan/spectra/commit/8f79d92fb2049cfc55c836e9e6f8a28230eb5f74)]:
  - @mohanscodex/spectra-ai@0.5.1
  - @mohanscodex/spectra-agent@0.5.1

## 0.5.0

### Minor Changes

- [`7d54df0`](https://github.com/codex-mohan/spectra/commit/7d54df0) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Integrate skills into agent with bundled skills loading — agents can now discover and use specialized skill files

- [`792e648`](https://github.com/codex-mohan/spectra/commit/792e648) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Add slash commands with real data integration for quick access to sessions, agents, and settings

- [`030637f`](https://github.com/codex-mohan/spectra/commit/030637f) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Terminal title and LLM-powered session naming via hidden title agent — sessions auto-name based on first message

- [`9c52a51`](https://github.com/codex-mohan/spectra/commit/9c52a51) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Git-based snapshots, atomic revert, cursor-aware history, and Anthropic cache fixes

- [`712a1a5`](https://github.com/codex-mohan/spectra/commit/712a1a5) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Render unified diff with line numbers and syntax highlighting for edit/write tools

### Patch Changes

- [`f5ea9fb`](https://github.com/codex-mohan/spectra/commit/f5ea9fb) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Add cost dialog and improve prompt bar token colors

- [`f9a3b6e`](https://github.com/codex-mohan/spectra/commit/f9a3b6e) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Refactor agent definitions into per-agent files with blacklist approach

- [`6561239`](https://github.com/codex-mohan/spectra/commit/6561239) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Upgrade OpenTUI to 0.3.3+ for BindingError fix, clear prompt on submit

- [`459936d`](https://github.com/codex-mohan/spectra/commit/459936d) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Cursor-aware history with two-press boundary detection

- [`86ba7ae`](https://github.com/codex-mohan/spectra/commit/86ba7ae) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Scope session listing to current working directory

- [`3a08c87`](https://github.com/codex-mohan/spectra/commit/3a08c87) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Add right padding to chat scrollbox to clear scrollbar

- [`7043acf`](https://github.com/codex-mohan/spectra/commit/7043acf) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Replace stub setStatus calls with toast notifications

- [`a5242d2`](https://github.com/codex-mohan/spectra/commit/a5242d2) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Pipe stdio in glob/grep execSync to prevent stderr bleed into TUI

- [`cbfe112`](https://github.com/codex-mohan/spectra/commit/cbfe112) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Fix version resolution and update dialog keyboard focus

- Updated dependencies []:
  - @mohanscodex/spectra-ai@0.5.0
  - @mohanscodex/spectra-agent@0.5.0

## 0.4.9

### Patch Changes

- [`2e73e41`](https://github.com/codex-mohan/spectra/commit/2e73e41d4bebe734c387792d0225878bcbc54e9f) Thanks [@codex-mohan](https://github.com/codex-mohan)! - TUI improvements and bug fixes

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

- Updated dependencies [[`2e73e41`](https://github.com/codex-mohan/spectra/commit/2e73e41d4bebe734c387792d0225878bcbc54e9f)]:
  - @mohanscodex/spectra-ai@0.4.9
  - @mohanscodex/spectra-agent@0.4.9

## 0.4.8

### Patch Changes

- [`107574b`](https://github.com/codex-mohan/spectra/commit/107574b9478d1c93a8fd4697d730f03551ce2c98) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Fix TUI bugs and improve experience

  - Fix git branch path flash on Windows (use execFileSync with stdio ignore)
  - Add update check dialog (npm registry, 24h cache, clipboard copy)
  - Add prompt badge mode for large text pastes (>500 chars)
  - Fix shell tool console bleed on Windows (always use PowerShell)
  - Fix shell tool display — always show block with "No output" when empty
  - Fix edit tool block spacing — add blank line after heading

## 0.4.7

### Patch Changes

- Updated dependencies [[`3665fe5`](https://github.com/codex-mohan/spectra/commit/3665fe5cb9940d5f852f6ee7c674947cf274548b)]:
  - @mohanscodex/spectra-ai@0.4.7
  - @mohanscodex/spectra-agent@0.4.7

## 0.4.6

### Patch Changes

- [`911eb91`](https://github.com/codex-mohan/spectra/commit/911eb912b11a9ec5d6c69bbbc64110050ceedbd8) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Replace hardcoded version strings in about-dialog and debug-dialog with auto-resolved import from package.json.

- Updated dependencies []:
  - @mohanscodex/spectra-ai@0.4.6
  - @mohanscodex/spectra-agent@0.4.6

## 0.4.5

### Patch Changes

- [`b416ed2`](https://github.com/codex-mohan/spectra/commit/b416ed222371ef778949b6eedf6c9832b456b291) Thanks [@codex-mohan](https://github.com/codex-mohan)! - Expand agent system prompt from 6-line stubs to full coding agent personas. Wire dead getSystemPrompt() into agent, ACP adapter, and sub-agent task tool. Modularize app.tsx into hooks/utils.

- Updated dependencies []:
  - @mohanscodex/spectra-ai@0.4.5
  - @mohanscodex/spectra-agent@0.4.5

## 0.1.5

### Patch Changes

- Updated dependencies [[`bacb73d`](https://github.com/codex-mohan/spectra/commit/bacb73ddad81495d3ec5cc0c150bd1b67ab0d5ad)]:
  - @mohanscodex/spectra-ai@0.4.4
  - @mohanscodex/spectra-agent@0.4.4

## 0.1.4

### Patch Changes

- Updated dependencies [[`e29e755`](https://github.com/codex-mohan/spectra/commit/e29e7556a9a11909fbf169498a3fb69f6606d1f0)]:
  - @mohanscodex/spectra-ai@0.4.3
  - @mohanscodex/spectra-agent@0.4.3

## 0.1.3

### Patch Changes

- Updated dependencies [[`0929072`](https://github.com/codex-mohan/spectra/commit/0929072f56da4e92aada06d8e681b0113792a13b)]:
  - @mohanscodex/spectra-ai@0.4.2
  - @mohanscodex/spectra-agent@0.4.2

## 0.1.2

### Patch Changes

- Updated dependencies [[`a714a31`](https://github.com/codex-mohan/spectra/commit/a714a318ba36806d561b788af083b04936a9139e)]:
  - @mohanscodex/spectra-ai@0.4.1
  - @mohanscodex/spectra-agent@0.4.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`c39eedd`](https://github.com/codex-mohan/spectra/commit/c39eedd31f87c184c0036517a368d46a151d8ef4)]:
  - @mohanscodex/spectra-ai@0.4.0
  - @mohanscodex/spectra-agent@0.4.0
