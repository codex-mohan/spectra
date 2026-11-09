---
"@mohanscodex/spectra-code": patch
---

Upgrade OpenTUI to 0.8.1 to stop the Windows native segfault when the slash menu mounts text nodes. Native syntax styles now use the renderer-owned scene, and slash rows are memoized with explicit widths to reduce per-keystroke native text churn.
