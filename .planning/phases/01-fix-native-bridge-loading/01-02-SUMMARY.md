---
phase: 01-fix-native-bridge-loading
plan: 02
subsystem: build
tags: [pyo3, maturin, python, rust, native-bridge]

requires:
  - phase: none
    provides: n/a
provides:
  - Working PyO3/maturin build pipeline for Python SDK
  - Python native bridge that imports and uses compiled Rust extension
  - Correct Agent class wrapping PySpectraAgent via PyO3
affects: [spectra-py, spectra-pyo3]

tech-stack:
  added: []
  patterns:
    - "PyO3 class import alias: from ._native import PySpectraAgent as _NativeAgent"
    - "run_streaming() returns Vec<String> of direct StreamEvent JSON — no double-wrapping"

key-files:
  created: []
  modified:
    - crates/spectra-pyo3/Cargo.toml
    - packages/spectra-py/pyproject.toml
    - packages/spectra-py/spectra/__init__.py

key-decisions:
  - "Used run_streaming() instead of run() to avoid double-wrapped event format"
  - "Kept async prompt() signature despite synchronous underlying call — future PyO3 async support"

patterns-established:
  - "run_streaming() for event iteration: Vec<String> of direct JSON, parsed per-event"
  - "ImportError fallback in __init__.py: _NATIVE_AVAILABLE flag + None sentinel pattern"

requirements-completed: [BUILD-06, TEST-02]

duration: 26min
completed: 2026-04-10
---

# Phase 1 Plan 2: Fix PyO3/Maturin Build and Python Native Bridge Summary

**PyO3/maturin build pipeline fixed with manifest-path, lib name, and Python SDK using run_streaming() for direct StreamEvent parsing**

## Performance

- **Duration:** 26 min
- **Started:** 2026-04-10T12:49:19Z
- **Completed:** 2026-04-10T13:15:34Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- maturin develop --release produces loadable _native.cp313-win_amd64.pyd
- All 6 PyO3 exports accessible from Python (PySpectraAgent, create_agent, run_agent, get_agents, delete_agent, get_version)
- Python SDK Agent class correctly wraps PySpectraAgent with proper event parsing via run_streaming()
- ImportError fallback provides clear "run maturin develop" message when native not built

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix PyO3/maturin build configuration** - `f3d9828` (fix)
2. **Task 2: Fix Python SDK API to match Rust PyO3 exports** - `9fd3b5a` (fix)

## Files Created/Modified
- `crates/spectra-pyo3/Cargo.toml` - Added `name = "spectra_pyo3"` to [lib] section
- `packages/spectra-py/pyproject.toml` - Added manifest-path, updated version to 0.2.0
- `packages/spectra-py/spectra/__init__.py` - Fixed PySpectraAgent import, switched to run_streaming(), fixed event parsing

## Decisions Made
- **Used run_streaming() instead of run():** The `run()` method returns double-wrapped JSON (`[{"type":"event","data":"<json>"}]`), while `run_streaming()` returns `Vec<String>` of direct StreamEvent JSON — simpler to parse, no unwrapping needed
- **Kept async prompt() signature:** Although `run_streaming()` is synchronous, keeping `async def prompt()` preserves the async API contract for when proper PyO3 async support is added

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worked around mise shim incompatibility with maturin**
- **Found during:** Task 1 (maturin develop verification)
- **Issue:** Maturin couldn't find rustc/cargo because mise provides `.CMD` shims that Python subprocess can't execute directly on Windows
- **Fix:** Created a temporary venv and used explicit PATH with actual Rust installation directory (`mise/installs/rust/1.91.1`) for build verification
- **Files modified:** None (build-time workaround only)
- **Verification:** maturin develop --release succeeded, all Python imports work

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Workaround was needed for build verification on this Windows/mise setup. The code changes themselves match the plan exactly.

## Issues Encountered
- Maturin couldn't find rustc via mise .CMD shims on Windows — resolved by setting PATH to the actual Rust installation directory and using a venv
- The `PYO3_USE_ABI3_FORWARD_COMPATIBILITY` env key in Cargo.toml generates an "unused manifest key" warning — cosmetic, not blocking

## Next Phase Readiness
- Python SDK native bridge fully functional — Agent class creates PySpectraAgent, prompt() yields parsed StreamEvent dicts
- Build pipeline works end-to-end: `cargo build -p spectra-pyo3` + `maturin develop --release`
- Ready for integration testing with actual LLM providers (requires API keys)

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 01-fix-native-bridge-loading*
*Completed: 2026-04-10*
