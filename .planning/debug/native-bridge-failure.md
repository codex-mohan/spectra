---
status: diagnosed
trigger: "Spectra TypeScript SDK fails with SpectraError: Failed to create agent: native_not_loaded when trying to create an agent. The native binary exists but cannot be loaded - ERR_DLOPEN_FAILED: not a valid Win32 application."
created: 2026-04-10T16:20:00Z
updated: 2026-04-10T16:45:00Z
---

## Current Focus

hypothesis: CONFIRMED - Multiple compounding bugs in the native bridge
test: Full investigation of Rust NAPI crate, copy-native script, and TS loader
expecting: Complete diagnosis of all issues
next_action: Write comprehensive diagnosis and recommend fix/remake path

## Symptoms

expected: Creating an Agent via TypeScript SDK loads the native Rust binary and successfully calls createAgent()
actual: SpectraError: Failed to create agent: native_not_loaded - native binary cannot be loaded
errors: ERR_DLOPEN_FAILED: "not a valid Win32 application", then swallowed by fallback stub as "native_not_loaded"
reproduction: `new Agent({ model: { provider: 'openai', id: 'gpt-4' } })` on Windows x64
started: Always broken on Windows (multiple fundamental issues)

## Eliminated

(none - all hypotheses confirmed)

## Evidence

- timestamp: 2026-04-10T16:22Z
  checked: packages/spectra-ts/native/ directory contents
  found: Both .node and .dll files are only 1030 bytes ASCII text files (dependency .d files), NOT real binaries
  implication: The copy-native.js script copied the WRONG file

- timestamp: 2026-04-10T16:24Z
  checked: copy-native.js findNativeBinary() function
  found: Uses `f.includes("spectra_napi")` filter on target/debug directory. The .d file (spectra_napi.d = dependency file, 1030 bytes ASCII) sorts before .dll alphabetically, so findNativeBinary() returns the .d file first
  implication: ROOT CAUSE #1 - copy-native.js picks up the wrong file (dependency .d file instead of .dll binary)

- timestamp: 2026-04-10T16:26Z
  checked: native.ts line 17 - file extension selection
  found: `const ext = process.platform === "win32" ? ".dll" : ".node"` - Uses .dll extension on Windows
  implication: ROOT CAUSE #2 - Node.js require() does NOT support loading .dll extensions for native addons on Windows. Node.js native addons ALWAYS use .node extension regardless of platform. The .dll extension makes require() try to parse it as JavaScript.

- timestamp: 2026-04-10T16:28Z
  checked: native.ts catch block (lines 22-29)
  found: Fallback stub silently replaces real native module with dummy that returns { error: "native_not_loaded" }. No logging, no re-throw, no way to diagnose the actual error.
  implication: ROOT CAUSE #3 - The fallback stub completely masks the real error (ERR_DLOPEN_FAILED), making debugging nearly impossible. Users see "native_not_loaded" instead of the actual load failure reason.

- timestamp: 2026-04-10T16:30Z
  checked: target/debug/ cargo output
  found: Cargo produces spectra_napi.dll (8.2MB PE32+ DLL, x86-64) as the cdylib output. This is correct - Rust produces .dll on Windows for cdylib crate type.
  implication: The Rust build is correct. The problem is entirely in how the TS SDK copies and loads the output.

- timestamp: 2026-04-10T16:32Z
  checked: Loading the real binary from src/native/spectra_napi.node
  found: Successfully loads! `require('./packages/spectra-ts/src/native/spectra_napi.node')` works and exports getVersion, createAgent, runAgent, getAgents
  implication: The binary format itself is fine. Node.js CAN load .dll files if they have .node extension. The issue is purely in the TS loading/copying infrastructure.

- timestamp: 2026-04-10T16:34Z
  checked: Native module exports vs Rust code
  found: Module exports [getVersion, createAgent, runAgent, getAgents] but Rust code also registers runAgentWithInput and deleteAgent. The src/native/ binary is STALE - compiled from an older version.
  implication: ROOT CAUSE #4 - The src/native/ binary is outdated. Even if loading worked, runAgentWithInput and deleteAgent would be missing, causing runtime failures.

- timestamp: 2026-04-10T16:36Z
  checked: Cargo.toml napi crate configuration
  found: crate-type = ["cdylib"], uses napi/napi-derive v2, napi-build v1 for build script. Has unused manifest key: target.cfg(windows).lib (Cargo warning).
  implication: The [target.'cfg(windows)'.lib] section with name = "spectra_napi" is invalid/ignored by Cargo. The lib name is derived from the [lib] crate-type = ["cdylib"]. This is harmless but indicates Cargo.toml confusion.

- timestamp: 2026-04-10T16:38Z
  checked: copy-native.js line 38
  found: Hardcodes `const ext = ".node"` for the destination file, which is correct. But it copies the WRONG source file (the .d dependency file instead of .dll).
  implication: The destination extension logic is correct, but the source file selection is broken.

- timestamp: 2026-04-10T16:40Z
  checked: package.json optionalDependencies
  found: "@spectra/sdk-win32-x64": "0.1.0" as optional dependency - this is an napi-rs platform package pattern, but the package likely doesn't exist in npm registry
  implication: This was set up for prebuilt binary distribution but is incomplete/non-functional

- timestamp: 2026-04-10T16:42Z
  checked: Two separate native binary locations
  found: packages/spectra-ts/native/ (broken, text files) and packages/spectra-ts/src/native/ (working, real binaries from older build). native.ts resolves to ../native relative to itself, which is packages/spectra-ts/native/ (the broken one).
  implication: The working binary in src/native/ is unreachable from the normal loading path. The native.ts loader always tries native/ (broken), never src/native/ (working).

## Resolution

root_cause: |
  FIVE compounding bugs in the native bridge:

  1. **copy-native.js picks wrong file**: The `findNativeBinary()` function uses `f.includes("spectra_napi")` to filter files in target/debug/. The dependency file `spectra_napi.d` (1030-byte ASCII text listing source paths) matches this filter and sorts alphabetically before `spectra_napi.dll` (8.2MB real binary). The function returns the .d file first, which gets copied as spectra_napi.node - a text file masquerading as a native addon.

  2. **native.ts uses .dll extension on Windows**: Line 17 uses `.dll` extension for Windows, but Node.js `require()` only supports `.node` extension for native addons on ALL platforms. The `.dll` extension causes require() to attempt parsing the file as JavaScript, which fails with "Invalid or unexpected token".

  3. **Fallback stub swallows real error**: The catch block (lines 22-29) silently replaces the native module with a stub that returns `{ error: "native_not_loaded" }`. This completely masks the real ERR_DLOPEN_FAILED error, making diagnosis extremely difficult. No console.warn, no re-throw option.

  4. **Stale binary in src/native/**: The working binary in src/native/ is from an older build and is missing `runAgentWithInput` and `deleteAgent` exports that the current Rust code registers. Even if the loading path found this binary, it would fail at runtime.

  5. **Confusing dual-location**: Both `native/` and `src/native/` contain binary files, creating confusion about which is the canonical location. The TS loader resolves to `native/` which always has the broken copied file.

fix: |
  RECOMMENDED: Full rewrite of the native loading infrastructure. The current implementation has too many compounding issues for a surgical fix. Recommended remake path:

  A. **Replace copy-native.js** with a proper build script that:
     - Explicitly looks for `spectra_napi.dll` on Windows, `spectra_napi.so` on Linux, `spectra_napi.dylib` on macOS
     - Does NOT use a generic `.includes()` filter
     - Copies to `native/spectra_napi.node` (always .node extension) in the package root
     - Verifies the copied file is a valid binary (check file size > 1KB, or use magic bytes)
     - Fails loudly if the binary is not found

  B. **Rewrite native.ts** to:
     - Always use `.node` extension regardless of platform
     - Remove the silent fallback stub entirely (or make it opt-in with a flag)
     - Throw a descriptive error on load failure that includes the real error message and the path attempted
     - Add `process.dlopen` as a fallback loading mechanism (how @napi-rs/cli does it)
     - Support proper error reporting for debugging

  C. **Remove src/native/ directory** - single canonical location at packages/spectra-ts/native/
     - Add it to .gitignore (binaries shouldn't be committed)
     - The copy-native.js script (or a new build step) populates it

  D. **Fix Cargo.toml** - Remove invalid `[target.'cfg(windows)'.lib]` section

  E. **Consider switching to @napi-rs/cli** for the build pipeline instead of manual copy scripts, since it's already a devDependency. The napi-rs CLI handles cross-compilation, platform-specific binary naming, and proper .node output natively.

verification: |
  1. cargo build --package spectra-napi succeeds (verified ✓)
  2. Real binary at target/debug/spectra_napi.dll is valid PE32+ x86-64 (verified ✓)
  3. require() with .node extension loads the real binary successfully (verified ✓)
  4. The .dll extension fails with require() on Windows (verified ✓)
  5. The copy-native.js copies the .d file instead of .dll (verified ✓)
  6. native/ directory contains broken text files, not binaries (verified ✓)

files_changed: []
