---
"@mohanscodex/spectra-code": minor
---

Redesign the OAuth loopback callback page as an animated pixel field over Spectra's palette — drifting chunky pixels on canvas, stepped dither and grid layers, pixel-corner status card, with `prefers-reduced-motion` respected.

Fix first-attempt ChatGPT Codex login failures: bind the callback server on both loopback families (`localhost` resolves to `::1` first and the code landed on the wrong listener), cancel the pending callback and free port 1455 on abort (a cancelled login leaked the port for minutes, failing the retry), remove the callback-server startup timeout race, and retry the token exchange once on transport failure.
