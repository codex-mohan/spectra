# v0.2.0: Production Ready - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Make Spectra actually usable: real LLM calls, native bindings work, CI/CD in place.
</domain>

<decisions>
## Implementation Decisions

### D-01: LLM Client Architecture
- **Decision:** Single `spectra-http` crate with modules per provider
- **Rationale:** Modular but unified - avoids fragmentation while keeping concerns separated
- **Structure:** `spectra-http/src/anthropic.rs`, `spectra-http/src/openai.rs`, `spectra-http/src/lib.rs`
- **Reference:** pi-mono's `packages/ai/src/providers/` pattern

### D-02: API Key Handling
- **Decision:** Env vars with runtime override (both + override)
- **Priority:** Env vars `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- **Override:** Passed via `LlmClient::new(api_key: Option<String>)` - env fallback if None
- **Security:** Keys never logged, only read from env at runtime

### D-03: Native Build Strategy
- **Decision:** napi-rs CLI for local + custom CI with matrix
- **Local:** `npx @napi-rs/cli build` generates `.node` addon
- **CI:** GitHub Actions with matrix for win/mac/linux + multiple node versions
- **Python:** `maturin develop` local, `maturin build --release` for wheels in CI
- **Reference:** pi-mono uses `@anthropic-ai/sdk`, `openai` SDKs - we use reqwest

### D-04: Test Infrastructure
- **Decision:** wiremock for mock HTTP responses
- **Strategy:** Mock LLM responses to test agent loop without real API calls
- **Isolation:** Tests run offline, no API key required
- **Coverage:** Test streaming, tool calls, error handling, message history

### D-05: CI/CD Scope
- **Decision:** All language builds (Rust + TypeScript + Python)
- **Rust CI:** `cargo build`, `cargo test`, `cargo clippy`, `cargo audit`
- **TypeScript CI:** `pnpm build` (npm package)
- **Python CI:** `maturin build --release` (wheels)
- **Native builds:** Built on release tags, not every PR (save CI time)

### D-06: Native Build Trigger
- **Decision:** CI builds native bindings on release, not every PR
- **Rationale:** Native builds are slow (~10 min), release tags are infrequent
- **Local dev:** Developers use `npx @napi-rs/cli build` / `maturin develop`
- **Release CI:** Builds .node, .pyd, wheels for all platforms on tag push

### Agent Discretion
- Retry/backoff implementation details
- Error message formatting
- CI caching strategies
- wiremock configuration format

</decisions>

<canonical_refs>
## Canonical References

### Reference Implementation
- `~/pi-mono-ref/packages/ai/src/providers/anthropic.ts` — Streaming pattern
- `~/pi-mono-ref/packages/ai/src/providers/openai-completions.ts` — OpenAI streaming
- `~/pi-mono-ref/packages/ai/src/utils/event-stream.ts` — EventStream class
- `~/pi-mono-ref/packages/ai/src/types.ts` — StreamOptions structure

### Project Context
- `.planning/ROADMAP.md` — v0.2.0 requirements (LLM-01 to LLM-03, BUILD-05/06, CI-01 to CI-04, TEST-01/02)
- `packages/core/src/llm.rs` — LlmClient trait to implement

</canonical_refs>

<codebase_context>
## Existing Code Insights

### Integration Points
- `spectra-core` defines `LlmClient` trait - HTTP clients implement this
- `spectra-core` defines `Agent::run()` - needs to call LLM client
- Current agent loop is stub - needs real implementation

### Available Crates
- `reqwest` already in Cargo.toml for HTTP
- `tokio` for async runtime
- `rustls` for TLS (no OpenSSL)

</codebase_context>

<specifics>
## Specific Ideas

- Follow pi-mono's pattern: create stream, push start event, iterate chunks, push done/error
- Wiremock for Rust: `wiremock` crate (already in dev dependencies)
- napi-rs CLI: `npx @napi-rs/cli generate` to scaffold build config

</specifics>

<deferred>
## Deferred Ideas

- Groq provider (v0.3.0)
- Google Vertex (v0.3.0)
- Ollama support (v0.3.0)
- Token usage tracking (v0.3.0)

</deferred>

---

*Phase: v0.2.0-production*
*Context gathered: 2026-04-09*