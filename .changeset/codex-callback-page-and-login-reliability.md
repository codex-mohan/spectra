---
"@mohanscodex/spectra-code": minor
---

Redesign the OAuth loopback callback page as an animated pixel field over Spectra's palette — drifting chunky pixels on canvas, stepped dither and grid layers, pixel-corner status card, with `prefers-reduced-motion` respected.

Fix first-attempt ChatGPT Codex login failures. The OAuth dialog cancelled its own login: the `registerHandler` prop is a fresh closure on every app re-render, so the key-handler effect's cleanup aborted the in-flight `loginCodex` and the rejection was swallowed — the dialog parked on "Starting login..." and never produced an authorization URL, on every attempt. Re-registering no longer cancels (only unmounting does), and non-cancel failures now surface instead of staying silent. Also: bind the callback server on both loopback families (`localhost` resolves to `::1` first and the code landed on the wrong listener), cancel the pending callback and free port 1455 on abort (a cancelled login leaked the port for minutes, failing the retry), remove the callback-server startup timeout race, and retry the token exchange once on transport failure.
