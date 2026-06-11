# @mohanscodex/spectra-code

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
