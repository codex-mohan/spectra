# Common Issues

Quick fixes for the most common Spectra problems.

## Agent Doesn't Call Tools

**Symptom:** The agent responds without using any tools, even though tools are registered.

**Causes and fixes:**

| Cause | Fix |
|---|---|
| Tool description is vague | Add specific "when to use" guidance in `description` |
| Tool name doesn't match LLM expectations | Use clear, descriptive names like `search_web` not `fn1` |
| System prompt doesn't mention tools | Add "Use the X tool when..." to the system prompt |
| LLM can answer directly | Make the question require external data |

## Agent Loops Forever

**Symptom:** The agent keeps calling tools without stopping.

**Fixes:**
- Set `maxTurns` to a reasonable limit (5-10)
- Make tool output clearer so the LLM knows it has enough info
- Add a tool that signals "I have enough information"

## Empty Response

**Symptom:** The agent returns an empty or near-empty response.

**Causes:**
- API key not set — check `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
- Model ID is wrong — verify the model exists for the provider
- Network issue — check connectivity to the API endpoint

## SSE Timeout

**Symptom:** Streaming connection times out before completing.

**Fixes:**
- Increase the HTTP client timeout
- Check for network instability
- Use `signal` (TypeScript) to implement client-side timeout with graceful fallback

## Tool Arguments Don't Match Schema

**Symptom:** Tool execution fails with validation errors.

**TypeScript:** Zod validation happens automatically — check the error message for the failing field.

**Rust:** You must validate manually in `execute()`:
```rust
let query = args["query"].as_str().ok_or("missing query field")?;
```

## "Unknown Provider" Error

**Symptom:** `Provider not found: my-provider`

**Fix:** Call `initProviders()` before creating the agent:
```typescript
import { initProviders } from "@singularity-ai/spectra-ai";
initProviders();
```

Or register your custom provider:
```typescript
registerProvider({ name: "my-provider", stream: ... });
```

## Next Steps

- [**Debugging Guide**](/troubleshooting/debugging) — Enable tracing, inspect events
- [**FAQ**](/troubleshooting/faq) — Frequently asked questions
