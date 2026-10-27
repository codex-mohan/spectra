# Model service

> Credential-aware model discovery and provider request-header derivation used by the TUI, backed by a SQLite catalog cache under the Spectra home directory.

## Source

- Entry: `packages/code/src/services/model-service.ts` — `buildDiscoveryContext`, `resolveModelsForProvider`, `resolveProviderHeaders`, `opencodeGatewayHeaders`.
- Entry: `packages/code/src/services/model-catalog.ts` — scope keys, `model-cache.db` store, bundled/cached/discovered merge, authoritative filtering, cache-only resolution.
- Collaborators:
  - `packages/code/src/services/auth-store.ts` — `read(providerId)` supplies the credential; no credential means a local/no-auth provider.
  - `packages/code/src/services/app-version.ts` — `APP_USER_AGENT` for Codex and gateway requests.
  - `packages/code/src/tui/ui/model-switcher.tsx:63` — model list for a connected builtin.
  - `packages/code/src/tui/ui/provider-dialog.tsx:685,702,722` — model list after connecting a provider.
  - `packages/code/src/tui/hooks/use-agent.ts:111,452` — resolves headers for the agent model config.
  - `packages/code/src/integrations/acp/server.ts:153` — same header derivation for the ACP server.
  - `packages/code/src/tui/utils/model-config.ts:76` — lookup of a model's context window for compaction and UI.

## Registration / gating

- Registered by: no registry; functions are imported by the UI, the agent hook, and ACP.
- Enabled by: always available. `resolveModelsForProvider` performs network discovery when a provider is selected or a provider connection is confirmed; `resolveCachedModelCatalog` never performs I/O beyond SQLite.
- Cache location: `join(getGlobalDataDir(), 'model-cache.db')` with `PRAGMA journal_mode = WAL` (`model-catalog.ts:115-131`).
- Permission profile: network (provider discovery) and write (cache database).

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `providerId` | `string` | yes | Registry provider id, e.g. `anthropic`, `openai-codex`, `opencode-go`. |
| `credential` | `Credential` | no | From `auth-store`; `api`, `oauth`, or `wellknown`. |
| `credentialContext` | `DiscoveryContext` | no | `{ apiKey, headers }` built from the credential. |
| `accountId` | `string` | no | OAuth account identity; part of the cache scope. |
| `baseUrl` | `string` | no | Custom endpoint; part of the cache scope after normalization. |
| `dataDir` | `string` | no | Overrides the cache directory (tests). |
| `authoritative` | `boolean` | no | Hide models absent from a successful discovery result. |
| `discoverModels` | `DiscoverModelsFn` | no | Injection point replacing the SDK discovery call. |
| `existingHeaders` | `Record<string,string>` | no | Custom-provider headers preserved when deriving request headers. |
| `sessionId` | `string` | no | Conversation id used for gateway routing headers. |

## Outputs

- `resolveModelsForProvider` → `{ id, name }[]` for UI lists.
- `resolveModelCatalog` → `{ models, discoveryUsed, authoritative, scopeKey, cacheEntry }`.
- `resolveCachedModelCatalog` → `ModelInfo[]` from bundled plus cache, no discovery.
- `resolveProviderHeaders` → header object, or `undefined` when nothing would be sent.
- Files: `model-cache.db` and its WAL sidecars; no credential material is written.

## Flow

1. `resolveModelsForProvider` reads the credential, builds a discovery context, and passes `authoritative: providerId === 'openai-codex'` (`model-service.ts:96-121`).
2. `buildDiscoveryContext` returns `undefined` for missing credentials or `type: 'wellknown'` (local providers). For API credentials it sends `{ apiKey: key }`; for OAuth it sends the access token. Codex OAuth adds `ChatGPT-Account-Id`; OpenCode gateway providers add the client `User-Agent` without a session id (`:55-77`).
3. `resolveModelCatalog` computes `scopeKey = sha256(providerId + '\0' + accountId + '\0' + normalizedBaseUrl).slice(0, 16)`; provider id is lowercased, account id lowercased, and the base URL has trailing slashes and host/protocol case normalized (`model-catalog.ts:71-78,510-519`).
4. Models are merged by id in the order bundled (`getProviderModels`) → cached entry → fresh discovery; fresh wins, cache fills gaps, bundled is the baseline (`:440-468`).
5. When `authoritative` is true **and** discovery returned at least one model, only ids present in the fresh result survive. A successful but empty roster does not hide anything and is not persisted as authoritative (`:469-482`).
6. The merged list is written back with `fetchedAt = now` and an `authoritative` flag only when fresh models existed (`:484-497`). Cache entries are read regardless of age; there is no TTL check.
7. If discovery throws, the merge still runs with bundled plus cached rows and the cache is rewritten with the current timestamp while retaining the cached model data (`:453-458`).
8. `resolveModelsForProvider` catches any catalog failure and falls back to `getModels(providerId)` from the SDK (`model-service.ts:118-120`).
9. `resolveProviderHeaders` starts from `existingHeaders`, adds `Authorization: Bearer` for API keys and for unexpired OAuth access tokens, then adds provider-specific headers: Codex account id and user agent, Snowflake token-type, OpenCode gateway identity/session, and the GitHub Copilot integration block (`:146-207`).
10. Empty header objects collapse to `undefined` so callers do not send an empty auth header (`:209-210`).

## State / persistence

- `model_cache_entries` (scope, provider, account, base URL, `fetched_at`, `authoritative`, version) and `model_cache_models` (id, name, context window, tool support, supported inputs, `updated_at`) with a foreign key and cascade delete (`model-catalog.ts:131-157`).
- `upsertEntry` replaces the entry and all of its models inside one transaction (`:281-327`).
- Cache scopes are isolated by provider, account id, and base URL, so switching accounts or endpoints does not mix model lists (`model-catalog.test.ts:52-120`).
- Secrets are never part of the scope key or the persisted rows; the key is a truncated hash and the tests assert that API keys are not written (`:399-426`).

## Security

- Discovery credentials stay in memory; only model metadata is persisted.
- Expired OAuth credentials receive no auth header from `resolveProviderHeaders` (they are not refreshed here), which can turn a request into an unauthenticated one instead of failing fast.
- Provider-specific headers mirror the upstream clients: Copilot sends `Copilot-Integration-Id`, editor and plugin versions, `X-GitHub-Api-Version`, and `Openai-Intent`; Codex sends `ChatGPT-Account-Id`.
- The cache lives inside the user's Spectra home; file permissions follow the process umask.
- `opencodeGatewayHeaders` requires a client-specific `User-Agent`; conversation traffic adds `x-opencode-session`, while discovery omits it.

## Errors

| Condition | Result |
| --- | --- |
| Discovery throws | Outcome treated as failure; `discoveryUsed: false`; bundled+cached returned. |
| Discovery returns a failure outcome | Same as a throw: cached and bundled rows retained. |
| Authoritative discovery fails | Falls back to non-authoritative merge; no models hidden. |
| Catalog resolution throws in `resolveModelsForProvider` | Falls back to `getModels(providerId)`. |
| No credential and provider is local | `buildDiscoveryContext` → `undefined`; no auth header. |
| OAuth credential expired | No `Authorization` header added. |
| Invalid `baseUrl` passed to normalization | Trimmed/lowercased string used as-is for the scope key. |
| Corrupt model cache rows | No catch inside the store; the SQLite call surfaces the error to the caller. |

## Limitations

- Only `openai-codex` is treated as authoritative; every other provider always shows bundled and cached rows alongside live ones.
- Cache entries never expire; a stale entry is reused on every resolution until a successful discovery overwrites it.
- There is no refresh of expired OAuth tokens in this service; refresh lives in the usage/auth services, so headers silently drop auth when a token has expired.
- `getProviderModels` supplies the bundled baseline, so providers with no bundled catalog and no credential resolve to an empty list.
- Alias handling is split across modules: `resolveMetaKey` maps `openai-completions`/`openai-responses` → `openai` for metadata, and `MODEL_CATALOG_PROVIDER_ALIASES` maps `opencode-zen` → `opencode` for context-window lookup; neither is applied to catalog resolution itself.
- `resolveModelsForProvider` discards context window, tool support, and input MIME metadata, returning only `{ id, name }`.

## Tests

- `packages/code/src/__tests__/model-service.test.ts` — discovery context per credential type, Codex account/OpenCode client headers, all header-derivation branches, merging with custom headers, no leakage of the session header to other providers.
- `packages/code/src/__tests__/model-catalog.test.ts` — scope-key isolation and stability, merge precedence, authoritative hiding, failed-refresh retention, cache-only resolution, no persisted secrets.
- `packages/code/src/__tests__/provider-auth.test.ts:43-49` — context-window aliases for `opencode-zen` and `opencode-go`.

## Related

- [custom-providers.md](custom-providers.md) — credential storage and login flows that feed this service.
- [config.md](config.md) — `model`/`provider` defaults.
- [providers.md](providers.md) — SDK-level provider registry.
- [context-compaction.md](context-compaction.md) — consumes context-window lookups and usage accounting.
