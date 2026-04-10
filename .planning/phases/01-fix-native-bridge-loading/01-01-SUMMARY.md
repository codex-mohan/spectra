---
phase: 01-fix-native-bridge-loading
plan: 01
subsystem: native-bridge
tags: [napi-rs, build, native-addon, typescript, windows]
dependency_graph:
  requires: [cargo-build, node-js]
  provides: [native-bridge-loading, copy-native-script]
  affects: [spectra-ts, spectra-napi]
tech_stack:
  added: [napi-rs-cli, vitest]
  patterns: [platform-aware-native-loading, throw-on-fallback]
key_files:
  created:
    - packages/spectra-ts/napi.json
    - packages/spectra-ts/src/native.test.ts
  modified:
    - crates/spectra-napi/Cargo.toml
    - packages/spectra-ts/package.json
    - packages/spectra-ts/scripts/copy-native.js
    - packages/spectra-ts/src/native.ts
decisions:
  - Fallback throws clear error instead of returning silent broken JSON
  - Always use .node extension regardless of platform (copy-native renames)
  - Two-step native dir lookup: sibling native/ then parent-level native/
  - Removed stale native/ root directory in favor of dist/native/ and src/native/
metrics:
  duration: 23m
  completed: 2026-04-10
  tasks: 2
  files: 6
---

# Phase 01 Plan 01: Fix Native Bridge Loading Summary

Native addon build pipeline fixed: cargo builds spectra_napi.dll on Windows, copy-native.js renames to .node, TypeScript SDK loads it successfully with all 6 exports.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Fix napi-rs build configuration and copy-native script | 9fc618d | Cargo.toml, napi.json, package.json, copy-native.js |
| 2 | Fix native.ts platform resolution and fallback behavior | 1abd59d | native.ts, native.test.ts |

## Task Details

### Task 1: Fix napi-rs build configuration and copy-native script

- Removed invalid `[target.'cfg(windows)'.lib]` section from Cargo.toml
- Added `name = "spectra_napi"` to `[lib]` section for consistent naming across platforms
- Created `napi.json` with crate root and version config for napi-rs CLI
- Added `napi` config section to package.json, removed stale `optionalDependencies`
- Rewrote `copy-native.js` to find cargo output (.dll/.so/.dylib) and copy as `.node`
- Cleaned stale `.dll` files from `dist/native/`, `src/native/`, and root `native/`

### Task 2: Fix native.ts platform resolution and fallback behavior

- Replaced platform-dependent extension logic (`.dll` on Windows) with always-`.node` resolution
- Added two-step native dir lookup: first `sibling/native/` then `parent/native/`
- Changed fallback from silent broken JSON returns to throwing clear errors with build instructions
- Added `isNativeLoaded()` export for consumers to check native state
- Added `native.test.ts` with 7 vitest tests covering EventStream and native bridge

## Verification Results

- `cargo build --release --package spectra-napi` ✓
- `pnpm build` (tsc + copy-native.js) ✓
- `require('./dist/native/spectra_napi.node').getVersion()` returns "0.2.0" ✓
- All 6 exports accessible: createAgent, deleteAgent, getAgents, getVersion, runAgent, runAgentWithInput ✓
- `npx vitest run` passes all 7 tests ✓
- No stale `.dll` files in native directories ✓

## Key Decisions

1. **Throw on fallback** — The old fallback returned `JSON.stringify({ error: "native_not_loaded" })` which agent.ts parsed but couldn't handle properly. Now throws with a clear message including build instructions.
2. **Always .node extension** — Since copy-native.js always renames to `.node`, the loader doesn't need platform-specific extension logic.
3. **Removed stale native/ root** — The old `packages/spectra-ts/native/` directory was a legacy copy target. Canonical locations are now `dist/native/` (production) and `src/native/` (development).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed stale native/ root directory**
- **Found during:** Task 1
- **Issue:** Old `packages/spectra-ts/native/` directory contained stale `.dll` and `.node` files; copy-native.js was previously targeting this directory
- **Fix:** Removed entire stale `native/` root directory; copy-native.js now targets `dist/native/` and `src/native/` only
- **Files modified:** Removed `packages/spectra-ts/native/spectra_napi.dll` and `packages/spectra-ts/native/spectra_napi.node`
- **Commit:** 9fc618d

## Threat Flags

No new threat surface introduced beyond what was already in the threat model. The native.ts path resolution uses fixed relative paths (not user-controlled), consistent with T-01-01 mitigation.

## Self-Check: PASSED

- All 7 key files exist on disk
- Both task commits (9fc618d, 1abd59d) found in git log
- All verification criteria met
