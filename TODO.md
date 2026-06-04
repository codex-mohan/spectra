# Spectra Roadmap

## 1. Publish `@mohanscodex/spectra-code` to npm

Make the Spectra Code package installable via npm (or other package managers) so users can add it as a dependency rather than needing the full monorepo.

- [ ] Ensure `packages/code/package.json` has correct `name`, `version`, `exports`, `files`, `bin` entries
- [ ] Verify `@mohanscodex/spectra-code` resolves and imports correctly in an isolated project (extend `test:import` to include it)
- [ ] Set up changeset release workflow to include the code package
- [ ] Document install + usage instructions for npm consumers

## 2. Custom states from tool calls (generative UI support)

Tool calls should be capable of emitting custom states during execution. This enables generative UI patterns where the tool can surface intermediate progress, status changes, or arbitrary state updates to the caller — useful for showing loading states, progress bars, or dynamic UI transitions.

- [ ] Define a `ToolState` / custom state event type in the SDK types
- [ ] Allow `execute()` to yield/push custom state events alongside the final `ToolResult`
- [ ] Surface these states through the agent event stream so callers can render them reactively
- [ ] Ensure both TypeScript (`packages/agent`) and Rust (`crates/spectra-rs`) support this

## 3. Real-time tool content streaming

Ability to stream a tool's content in real time as it is produced, rather than waiting for the full `ToolResult` before surfacing anything. This builds on the current tool call implementation to support progressive output.

- [ ] Design a streaming tool interface (e.g., `execute` returns an async iterable / stream of chunks)
- [ ] Integrate streaming tool output into the agent event loop so deltas are yielded as they arrive
- [ ] Ensure backward compatibility — non-streaming tools (current `execute` returning `ToolResult`) still work
- [ ] Implement in both TypeScript (`packages/agent`) and Rust (`crates/spectra-rs`)
