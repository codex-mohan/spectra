---
'@singularity-ai/spectra-ai': patch
'@singularity-ai/spectra-agent': patch
'@singularity-ai/spectra-app': patch
---

fix: resolve workspace:* protocol before publishing to npm - prevents workspace:* from leaking into tarballs and breaking consumers
