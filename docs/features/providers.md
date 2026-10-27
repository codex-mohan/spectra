# Providers

> The provider layer maps a `Model` plus a `Context` onto one vendor transport and returns a streaming `AssistantMessageEventStream`; the registry selects the transport by `model.provider`.

## Source

- Entry: `packages/ai/src/registry.ts` — provider map, `registerProvider`/`getProvider`/`listProviders`, model listing and discovery, `stream()` and `complete()`.
- Types: `packages/ai/src/types.ts` — `Model`, `Context`, `StreamOptions`, `AssistantMessage`, `AssistantMessageEvent`, `Usage`, `ProviderErrorDetails`.
- Built-ins: `packages/ai/src/providers/register-builtins.ts` — `initProviders()` registers every bundled provider at import time.
- Transports:
  - `packages/ai/src/providers/anthropic.ts` — Messages API, thinking budgets, PDF/document blocks.
  - `packages/ai/src/providers/openai-completions.ts` — Chat Completions transport, local runtimes, most OpenAI-compatible vendors.
  - `packages/ai/src/providers/openai-responses.ts` — Responses API transport.
  - `packages/ai/src/providers/openai-codex-responses.ts` — Codex Responses transport with OAuth token and account header.
  - `packages/ai/src/providers/openrouter.ts` — OpenRouter base URL plus live model discovery.
  - `packages/ai/src/providers/shared.ts` — tool-result folding, surrogate sanitizing, streaming JSON parsing, `normalizeProviderError`.
- Stream primitive: `packages/ai/src/event-stream.ts` — `EventStream<T,R>` queue + `result()` promise.

## Registration / gating

- `registerProvider(provider)` writes into a module-level `Map<string, Provider>` keyed by `provider.name`; re-registering the same name overwrites it.
- `initProviders()` is called at the bottom of `register-builtins.ts`, so importing the package registers: `anthropic`, `openai-completions`, `openai-responses`, `openrouter`, `openai-codex`, and OpenAI-compatible wrappers for `groq`, `xai`, `deepseek`, `mistral`, `cerebras`, `google`, `fireworks-ai`, `togetherai`, `perplexity`, `cohere`, `novita-ai`, `moonshotai`, `chutes`, `minimax`, `huggingface`, `nvidia`, `zai`, `github-copilot`, `digitalocean`, `snowflake-cortex`, coding-plan variants, `opencode-go`/`opencode-zen`, and local runtimes (`ollama`, `lm-studio`, `llama-cpp`, `vllm`, `sglang`) whose base URLs come from `OLLAMA_BASE_URL` and friends.
- Enabled by: the `provider` string on `Model`. There is no separate enable flag; a provider without a model is simply unused.
- Permission profile: network. The registry performs no authorization of its own.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `model` | `Model` | yes | Includes `provider`, `api`, `baseUrl`, `headers`, `maxTokens`, optional `cost`. |
| `context` | `Context` | yes | `systemPrompt`, canonical `messages`, tool definitions, optional developer `contextMessages`. |
| `options.apiKey` | `string` | no | Highest-priority credential; falls back to the transport's env lookup. |
| `options.headers` | `Record<string,string>` | no | Merged over model headers where the transport supports it. |
| `options.signal` | `AbortSignal` | no | Forwarded to the SDK request. |
| `options.maxTokens` / `temperature` / `thinkingEffort` | scalars | no | Transport-specific; Anthropic maps `low/medium/high/max` to thinking budgets. |
| `DiscoveryContext` | `{ apiKey?, headers?, baseUrl? }` | no | Input to `discoverModels()`. |

## Outputs

- `stream()` returns an `AssistantMessageEventStream` yielding `AssistantMessageEvent`: `start`, `text_*`, `thinking_*`, `toolcall_*` (`contentIndex`, cumulative `partial`), then exactly one terminal `done` or `error`.
- `result()` resolves the final `AssistantMessage` with `content`, `provider`, `model`, `usage` (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, optional `cost`), `stopReason`, `timestamp`, and optional `errorMessage`/`metadata.error`.
- `complete()` calls `stream()` and awaits `result()`, discarding intermediate events.
- Discovery returns `DiscoveryOutcome`: either `{ models, fetchedAt }` or `{ models: [], error }`; `undefined` from `discoverProviderModels()` means the provider has no discovery implementation.
- Files: none.

## Flow

1. Caller (usually `Agent.doStream`) calls `stream(model, context, options)`.
2. `registry.ts` looks up `model.provider`; a miss throws `No provider registered for: <name>. Available: …`.
3. The provider creates an `AssistantMessageEventStream`, then runs its transport asynchronously.
4. Credential resolution is `options?.apiKey ?? getEnvApiKey(model.provider)` inside the transport (`anthropic.ts:320`, `openai-completions.ts:129`, `openai-responses.ts:117`).
5. Without a key the transport emits a synthetic `start` carrying a `stopReason: 'error'` message and an `error` event, then ends; it does not throw (`anthropic.ts:322-338`).
6. Messages are lowered into the vendor shape (Anthropic blocks, Chat Completions messages, Responses input); tool results are folded to text and images are replayed in a follow-up user turn with `TOOL_RESULT_IMAGE_NOTE`.
7. SDK deltas update the partial `AssistantMessage` in place and push `text_delta`/`thinking_delta`/`toolcall_delta`; `toolcall_end` carries the assembled `ToolCall`.
8. On completion the transport computes usage cost via `calculateUsageCost`, pushes `done`/`error`, and `end()` settles the stream result.
9. Failures are passed through `normalizeProviderError`, producing a bounded `ProviderErrorDetails` with sanitized message, optional status code, safe response headers, and a truncated body.

## State / persistence

- The registry map is process-wide module state; the last registration for a name wins. There is no per-session provider state.
- Bundled model rosters come from the generated `packages/ai/src/models.ts` via `getProviderModels`; live rosters are fetched only through `discoverModels` and nothing is cached by the registry.
- No credentials are persisted here; API keys arrive per call through `StreamOptions` or environment variables.

## Security

- Keys are read from the environment in the transports only; the registry never stores them.
- `normalizeProviderError` caps response bodies at 32 KiB, keeps only a safe header allowlist, and redacts `bearer`/`basic`/API-key/authorization/cookie-shaped values before the details can be persisted.
- `sanitizeSurrogates` strips lone UTF-16 surrogates from outbound text; `parseStreamingJson` returns `{}` when tool-call JSON is not yet parseable.
- `openai-completions` sets `dangerouslyAllowBrowser: true` and therefore must only run in a trusted host process.

## Errors

| Condition | Result |
| --- | --- |
| Unknown `model.provider` | `Error: No provider registered for: <name>. Available: …` |
| Missing API key | message with `stopReason: 'error'` and `errorMessage` (`No API key for provider: <p>` or `ANTHROPIC_API_KEY not set`) |
| HTTP 4xx (not 429) | `ProviderErrorDetails.retryable = false`; `Agent` does not retry a thrown error of this shape |
| HTTP 429 / 5xx / transport reset / timeout | `retryable = true`; `Agent` backs off and retries up to 3 times |
| Aborted signal | `stopReason: 'aborted'` with sanitized details |
| Discovery failure | `{ models: [], error: { message, status? } }`; callers keep their previous roster |

## Limitations

- Only the providers named in `getEnvApiKey` have environment fallbacks (`openai`, `openaiCodex`, `openrouter`, `groq`, `azure`, `cerebras`, `xai`, local runtimes, Anthropic). Wrapped vendors such as `deepseek` or `mistral` need `options.apiKey` from the caller.
- Local runtimes substitute fixed placeholder tokens (`ollama-local`, etc.) rather than reading a required secret.
- `supportedMediaTypes` is declared metadata; the registry does not consult it when routing attachments.
- `openai-codex` requires an OAuth access token in `options.apiKey` and the account id in `options.headers`; without them discovery returns a 401 failure.
- Discovery requests use a fixed 5-second timeout and no retry.
- The Anthropic transport ignores `model.baseUrl`; only the SDK default endpoint is used.

## Tests

- `packages/ai/src/__tests__/provider.test.ts` — registry register/list/lookup, OAuth-backed OpenAI-compatible providers, Codex transport contract and discovery, Anthropic missing-key behavior.
- `packages/ai/src/__tests__/discovery.test.ts`, `discovery-normalize.test.ts` — discovery outcomes and row normalization.
- `packages/ai/src/__tests__/event-stream.test.ts` — event ordering and `result()` settlement.
- `packages/ai/src/__tests__/provider-error.test.ts` — sanitization and classification of provider failures.
- `packages/ai/src/__tests__/pricing.test.ts` — usage cost calculation.

## Related

- `docs/features/agent-loop.md` — consumes the stream and retries failures.
- `docs/features/custom-providers.md`, `docs/features/model-service.md`, `docs/features/config.md` — user-facing provider configuration.
