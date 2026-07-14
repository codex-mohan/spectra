# Provider Authentication and Model Catalog Plan

## Status

Approved architecture plan for Spectra Code provider connections, credential handling, model discovery, model persistence, and inference transport.

## Goals

- Keep the existing generated `models.ts` catalog as the fast, offline baseline.
- Automatically discover account-available models after OAuth or API-key authentication where the provider supports discovery.
- Persist successful discovery results without modifying `models.ts`.
- Use the correct inference protocol for every selected model.
- Provide one consistent connection lifecycle for OAuth subscriptions, API-key providers, local runtimes, and custom providers.
- Keep `packages/ai` independent from Spectra Code's filesystem, browser login, and credential persistence.

## Non-goals

- Replace the generated catalog with a network-only catalog.
- Adopt OpenCode's model filtering architecture.
- Store credentials or authorization headers in the model cache.
- Require manual model names for managed OAuth or subscription providers.

## Source Resolution

Models resolve in this order:

```text
models.ts bundled baseline
→ last-good persisted discovery cache
→ fresh authenticated/provider-native discovery
→ explicitly configured custom-provider models
```

Later sources override earlier metadata by `(provider, model ID)`. A successful account-specific discovery may be marked authoritative and hide bundled models unavailable to that account. If discovery fails, Spectra retains the last-good cache and then the bundled baseline.

## Package Boundaries

### `packages/ai`

Owns:

- Canonical provider runtime definitions
- API protocol adapters
- Static catalog access
- Provider-native model discovery functions
- Model normalization and source merging
- Streaming transports

It receives credentials through request context but does not persist them or implement TUI/browser login.

### `packages/agent`

Owns:

- Awaiting asynchronous provider authentication resolution before inference
- Passing resolved provider context to the AI provider layer
- Preserving complete selected-model metadata

### `packages/code`

Owns:

- OAuth and device login UX
- Credential storage and refresh
- Model cache persistence
- Connection status
- Provider/model selection UI
- Project and global configuration

## Canonical Provider and API Identity

Provider identity and API protocol are separate:

| Service | Provider | API protocol |
|---|---|---|
| OpenAI API | `openai` | `openai-responses` or `openai-chat` |
| ChatGPT Codex subscription | `openai-codex` | `openai-codex-responses` |
| Anthropic | `anthropic` | `anthropic-messages` |
| GitHub Copilot | `github-copilot` | Copilot-specific adapter |
| Ollama | `ollama` | `openai-chat` |

`Model.api` must select meaningful transport behavior. The OpenAI UI must use the canonical `openai` provider rather than hiding separate `openai-completions` and `openai-responses` provider IDs behind a metadata alias.

## Provider Runtime Definition

Each managed provider declares:

- Canonical ID and display name
- Supported authentication methods
- Environment variable names
- Default base URL
- Supported API protocols
- Model discovery implementation
- Bundled fallback source
- Whether successful discovery is authoritative
- Required request headers and compatibility behavior
- Supported media and model capabilities

Spectra Code augments runtime definitions with login and credential-refresh handlers. UI provider lists are derived from these definitions rather than hardcoded OAuth and local-provider maps.

## Normalized Model Format

Every bundled or remotely discovered model is normalized to:

```ts
interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  api: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  reasoningEfforts?: string[];
  input?: Array<'text' | 'image' | 'file'>;
  tools?: boolean;
}
```

Provider-specific payloads are parsed into this shape before merging or persistence. The selected model retains this metadata through agent construction and inference.

## Persisted Model Cache

Fresh discovery is stored separately from `models.ts`:

```ts
interface ModelCacheRecord {
  schemaVersion: 1;
  providerId: string;
  scopeKey: string;
  fetchedAt: number;
  expiresAt: number;
  etag?: string;
  authoritative: boolean;
  models: DiscoveredModel[];
}
```

`scopeKey` is a stable hash of the non-secret discovery scope, including account identity and base URL where relevant. The cache never stores access tokens, refresh tokens, API keys, raw account IDs, or authorization headers.

Spectra Code should persist these records in its existing SQLite infrastructure. Cache writes are atomic. The cache is invalidated when provider account, credential scope, or base URL changes. Successful refresh replaces the previous record; failed refresh retains the last-good record.

## Credential Storage and Resolution

All persisted secrets belong in `auth.json`, keyed by canonical provider or explicit shared credential key:

```ts
type Credential =
  | { type: 'api'; key: string; metadata?: Record<string, string> }
  | { type: 'oauth'; access: string; refresh: string; expires: number; accountId?: string }
  | { type: 'wellknown'; key: string; token: string };
```

Custom-provider configuration contains non-secret fields only: name, base URL, headers, enabled state, and optional configured models. Existing custom-provider keys in configuration must migrate to `auth.json`.

A single asynchronous credential manager resolves credentials before model discovery, inference, compaction, title generation, subagents, and usage requests. It:

1. Reads the credential.
2. Refreshes OAuth credentials before expiry using a safety window.
3. Atomically persists the replacement.
4. Returns access token/API key plus account metadata.
5. Reports `reauthentication-required` when refresh is unavailable or fails conclusively.

Connection state is explicit: `disconnected`, `configured`, `connected`, `refreshing`, `reauthentication-required`, or `error`. An expired credential with a usable refresh token is not treated as immediately disconnected.

## Provider Families

### OpenAI Codex

Implement a dedicated subscription provider:

```text
OAuth login
→ extract ChatGPT account ID
→ authenticated Codex model discovery
→ account-scoped model cache
→ Codex Responses inference transport
```

Remove the hardcoded `CODEX_MODELS` source and the generic `https://api.openai.com/v1` Chat Completions wrapper. Discovery uses the authenticated ChatGPT Codex backend and required account headers. Inference uses the Codex Responses backend.

### GitHub Copilot

Move editor, integration, and authorization headers into the provider implementation. Refresh its Copilot session token before discovery or inference. Use authenticated provider-native model discovery when supported, with bundled/cache fallback.

### Kimi Subscription Providers

Pass the OAuth access token to model discovery. If multiple provider variants intentionally share credentials, declare an explicit credential key rather than relying on duplicated storage or UI logic.

### xAI, DigitalOcean, and Snowflake

Each receives an explicit contract covering authentication methods, refresh behavior, model discovery, base URL, required headers, and inference transport. DigitalOcean transitions to `reauthentication-required` when its non-refreshable token expires.

### Native API-key Providers

Anthropic and OpenAI retain native implementations. OpenAI is exposed as one provider whose models select the appropriate Chat or Responses protocol.

### OpenAI-compatible API-key and Coding-plan Providers

Replace wrapper proliferation with declarative runtime definitions. Use authenticated `/models` discovery only when the provider supports it; otherwise use bundled provider metadata. Provider-specific reasoning parameters are declared compatibility behavior rather than inferred from provider-name substring checks.

### Local Providers

Ollama, LM Studio, llama.cpp, vLLM, and SGLang declare `auth: none`. They discover models from their configured endpoint and never send fake bearer tokens.

### Custom Providers

Resolution order:

1. Authenticated `/models` discovery when available
2. Models declared in configuration
3. Manual model entry

Manual entry remains available only because arbitrary custom servers cannot be cataloged reliably. Managed OAuth/subscription providers never fall back to free-form model entry.

## Provider Connection UI

The provider connection menu is derived from runtime and connection definitions. It shows explicit connection state and supports:

- Select models
- Refresh models
- Update or reconnect
- Disconnect

After a successful connection Spectra:

1. Persists or replaces the credential.
2. Resolves/refreshes it.
3. Runs authenticated discovery.
4. Persists the normalized model result.
5. Opens the discovered model list.

On failure it shows the exact error, retry/reconnect actions, and last-good cached models when present. The styled OAuth callback page remains.

## Implementation Order

1. Introduce canonical provider IDs, meaningful API protocol IDs, full model metadata, and runtime definitions.
2. Add the asynchronous credential manager and migrate every credential consumer.
3. Add credential-aware discovery, normalization, merge rules, and persistent model cache.
4. Complete OpenAI Codex end to end: login, account extraction, discovery, cache, selection, and inference.
5. Migrate Copilot, Kimi, xAI, DigitalOcean, and Snowflake.
6. Migrate API-key, coding-plan, gateway, and local providers.
7. Migrate custom providers and provider UI to the shared services.
8. After end-to-end smoke verification, remove obsolete wrappers, aliases, maps, static Codex guesses, duplicated custom streaming code, and provider-specific agent-construction patches.

## Verification Contract

- Managed providers automatically show models after connection.
- Account-scoped OAuth catalogs never leak between accounts.
- Discovery failure preserves the last-good cache.
- OAuth refresh runs before discovery and inference.
- Codex discovery and inference use the ChatGPT Codex backend and account identity.
- Selected models retain protocol and capability metadata.
- Local providers send no authorization header.
- Reconnection replaces the existing credential.
- Custom-provider secrets are stored only in `auth.json`.
- Adding a provider requires a runtime definition and, only when necessary, an authentication handler—not changes across multiple UI switch statements.
