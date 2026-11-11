---
"@mohanscodex/spectra-code": patch
---

Fix LSP server lifecycle and discovery: treat mux clients as running instead of respawning the server on every call, resolve server binaries from project-local bins before `PATH`, report configured-vs-running servers, wait through cold starts and ignore pre-analysis empty publishes, run project toolchain checkers for workspace diagnostics, back off repeated init failures, make workspace sweeps settle once instead of per file, honor aborts while waiting, stop daemon-owned servers (including child processes) on reload/shutdown, expand the built-in server catalog to 44 languages (including Zig, Clojure, Erlang, Gleam, Deno, TOML, SQL, LaTeX and Python alternatives), select the first matching server whose root markers and binary resolve, and remove the implicit five-second tool deadline.
