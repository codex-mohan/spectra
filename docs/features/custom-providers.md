# Custom providers and auth

> User-declared OpenAI-compatible endpoints register as first-class providers through `registerAllCustomProviders`, while provider credentials are stored in `~/.spectra/auth.json` and converted into request headers for bundled OAuth-backed providers.

## Source

- Entry: `packages/code/src/services/custom-providers.ts` — `registerCustomProvider` (line 67), `registerAllCustomProviders` (line 327), `normalizeOpenAIBaseUrl` (line 23), `resolveApiKey` (line 16).
- Config shape: `packages/code/src/services/config.ts` — `CustomProviderConfig` (line 5), `SpectraConfig.providers` (line 26).
- Credential store: `packages/code/src/services/auth-store.ts` — `read`/`write`/`remove`/`readAll`/`listConnected`, credential union `ApiCredential | OauthCredential | WellKnownCredential`.
- Login flows:
  - `packages/code/src/services/provider-auth.ts` — Codex browser PKCE (`loginCodex`, line 552) and Kimi device flow (`loginKimiCode`, line 199); shared `ProviderAuthCallbacks`.
  - `packages/code/src/services/github-copilot-auth.ts` — device flow plus Copilot session-token exchange.
  - `packages/code/src/services/xai-auth.ts` — browser PKCE on fixed loopback port 56121.
  - `packages/code/src/services/digitalocean-auth.ts` — implicit grant on fixed loopback port 1456.
  - `packages/code/src/services/snowflake-cortex-auth.ts` — browser PKCE on an ephemeral port.
- Header derivation: `packages/code/src/services/model-service.ts` — `resolveProviderHeaders` (line 146), `buildDiscoveryContext` (line 55), `opencodeGatewayHeaders` (line 43).
- Connection test: `packages/code/src/services/provider-connection.ts` — `isCredentialConnected` (line 7).
- UI: `packages/code/src/tui/app.tsx:99-104` (registration at startup), `packages/code/src/tui/ui/manage-providers-dialog.tsx` (custom provider form, `saveProvidersToConfig`), `packages/code/src/tui/ui/provider-dialog.tsx` (login dispatch, `OAUTH_PROVIDER_IDS` line 227).
- Refresh: `packages/code/src/services/usage-store.ts:711-765` — `refreshedCredential`.

## Registration / gating

- `App` calls `loadConfig()` and `registerAllCustomProviders(cfg.providers)` in a `useState` initializer (`app.tsx:99-104`); entries with `enabled === false` are skipped (`custom-providers.ts:330`). Registration overwrites any provider already registered under the same id.
- `ManageProvidersDialog` calls `registerCustomProvider` immediately on save and writes the whole `providers` object to the global `spectra.json` (`manage-providers-dialog.tsx:14-25`, `92-94`).
- Bundled OAuth-backed providers are registered by `packages/ai/src/providers/register-builtins.ts` (`github-copilot`, `digitalocean`, `snowflake-cortex`, `openai-codex`).
- Enabled by: presence in `providers`; the runtime selects a provider only when `model.provider` matches its id. No separate enable flag beyond `enabled`.
- Permission profile: network. No permission check runs for provider calls.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `providers.<id>.name` | `string` | yes | Display name; `listModels` falls back to the model id. |
| `providers.<id>.baseUrl` | `string` | yes | OpenAI-compatible base URL; normalized by `normalizeOpenAIBaseUrl`. |
| `providers.<id>.apiKey` | `string` | no | Config-level key, second in resolution order. |
| `providers.<id>.headers` | `Record<string,string>` | no | Passed to the OpenAI client as `defaultHeaders`. |
| `providers.<id>.models` | `Record<string,{name?,contextWindow?,maxOutput?}>` | no | Sole source of `listModels`; `contextWindow` feeds compaction budgeting. |
| `providers.<id>.enabled` | `boolean` | no | `false` skips registration. |
| `options.apiKey` | `string` | no | Highest-priority key, supplied by `Agent.getApiKey`. |
| `loginSnowflakeCortex` `account` / `role` | `string` | account yes | Snowflake account identifier; optional role scope. |

## Outputs

- `Provider` object with `name`, `listModels()`, `stream(model, context, options)`.
- `stream` emits `start`, `text_*`, `thinking_*`, `toolcall_*`, then one terminal `done` or `error`, carrying a synthetic `AssistantMessage` (`custom-providers.ts:67-324`).
- `registerAllCustomProviders` returns the ids it registered.
- Login functions return `OauthCredential`; the caller writes it with `write(providerId, credential)` (`provider-dialog.tsx:401-402`).
- Files: `~/.spectra/auth.json` (mode `0o600`), `~/.spectra/kimi-device-id` (mode `0o600`).

## Flow

1. `resolveApiKey` resolves `options.apiKey` first, then `config.apiKey`, then an `api` credential from `auth.json` (`custom-providers.ts:16-21`, `95`).
2. A missing key short-circuits: `start` with `stopReason: 'error'`, `errorMessage: "No API key for provider: <id>"`, then `error` (`custom-providers.ts:96-103`).
3. The OpenAI client is built with `baseURL: normalizeOpenAIBaseUrl(config.baseUrl)`, `dangerouslyAllowBrowser: true`, and `defaultHeaders` when `config.headers` exists (`custom-providers.ts:109-113`).
4. Messages are lowered: system prompt, user text/image/file blocks, assistant text plus `tool_calls`, `toolResult` as `role: "tool"` text (`custom-providers.ts:134-180`).
5. Tool-result images are queued and flushed into a following user turn prefixed with `TOOL_RESULT_IMAGE_NOTE` (`custom-providers.ts:121-135`, `180`).
6. Streaming deltas update text, thinking (`reasoning_content`/`reasoning`/`reasoning_text`), and tool calls; partial JSON is re-parsed per chunk (`custom-providers.ts:207-308`).
7. Usage is normalized as `input = prompt_tokens - cached - cacheWrite` (`custom-providers.ts:210-221`).
8. Builtin providers get headers from `resolveProviderHeaders`: Bearer for API keys and unexpired OAuth, `ChatGPT-Account-Id` + `User-Agent` for `openai-codex`, `X-Snowflake-Authorization-Token-Type: OAUTH` for `snowflake-cortex`, VS Code integration headers for `github-copilot`, gateway headers for `opencode-go`/`opencode-zen` (`model-service.ts:146-195`).

## State / persistence

- `auth.json` is a flat JSON map `providerId -> Credential`; `write` rewrites the whole file with mode `0o600` (`auth-store.ts:53-58`). `getGlobalDataDir()` is `SPECTRA_HOME` when set, otherwise `~/.spectra` (`utils/paths.ts:5-8`).
- `OauthCredential` stores `access`, `refresh`, `expires` (epoch ms, minus a five-minute skew for Codex/Kimi/Copilot), and optional `accountId`.
- Custom provider definitions live in `spectra.json` under `providers`; `loadConfig` merges the global file first, then project layers from filesystem root to cwd (`services/config.ts:129-142`, `utils/paths.ts:51-62`).
- `isCredentialConnected` treats an API key as connected when non-empty, OAuth only while `expires > now`, and a custom provider as connected when `apiKey` is configured (`provider-connection.ts:7-15`).

## Security

- Secrets are stored as plaintext JSON gated only by filesystem mode `0o600`; `kimi-device-id` is written the same way.
- The PKCE flows bind loopback only and validate `state`; Codex also binds `::1` so the `localhost` redirect cannot be captured by another process (`provider-auth.ts:409-500`). DigitalOcean's server listens on port 1456 across interfaces and relies on the `state` match before accepting the relayed token (`digitalocean-auth.ts:165-238`).
- Codex PKCE uses `S256`; xAI adds a `nonce` and restricts CORS preflight to `accounts.x.ai` and `auth.x.ai` (`xai-auth.ts:28-30`, `330-349`).
- Callback HTML is escaped (`provider-auth.ts:248-256`) and self-contained; no remote assets.
- DigitalOcean receives the token from a browser script POSTing to `/auth/token`, then compares `state` before resolving (`digitalocean-auth.ts:165-238`).
- The custom-provider client sets `dangerouslyAllowBrowser: true`; it must only run in a trusted host process.

## Errors

| Condition | Result |
| --- | --- |
| No custom-provider key | `error` event with `No API key for provider: <id>` |
| Request failure | `error` event, `stopReason: 'error'`, message from the thrown error |
| Aborted signal | `stopReason: 'aborted'` |
| Codex callback port 1455 occupied | `OpenAI Codex needs localhost:1455 for its OAuth callback…` (`provider-auth.ts:53`) |
| Codex callback exceeds 5 minutes | `OpenAI authorization timed out` |
| Codex token exchange exceeds 15s twice | `OpenAI token exchange timed out after 15 seconds.` |
| Callback `state` mismatch | HTTP 400 page, error `Invalid OAuth state…` |
| Snowflake response without `refresh_token` | `Snowflake token response did not include refresh_token…` |
| Refresh failure during usage fetch | stored credential is reused (`usage-store.ts:714-720`) |

## Limitations

- Custom providers speak Chat Completions only; `listModels` never discovers remote models, and no OAuth credential is consulted for a custom id.
- The TUI form exposes only id, name, base URL, API key, and up to three model ids; headers and context windows are config-file only.
- OAuth refresh runs only while fetching usage reports, not before inference; an expired OAuth credential silently yields no `Authorization` header.
- DigitalOcean's implicit grant issues no refresh token, so its credential must be re-created by logging in again.
- GitHub Copilot login hardcodes `github.com`; `OauthCredential.enterpriseUrl` is declared but never written by any flow.
- Codex and DigitalOcean use fixed callback ports (1455, 1456) and fail when those ports are taken; xAI requires 56121 because its redirect URI is registered.
- Only `openai-codex` is treated as authoritative during model discovery (`model-service.ts:111`).

## Tests

- `packages/code/src/__tests__/custom-providers.test.ts` — `normalizeOpenAIBaseUrl` strips `/chat/completions`, `/responses`, and trailing slashes.
- `packages/code/src/__tests__/provider-auth.test.ts` — PKCE authorize URL, ChatGPT account-id extraction from JWT claims, cancellation before the callback server starts, callback-page escaping and self-containment, `getAuthKey` freshness rules.
- `packages/code/src/__tests__/provider-dialog.test.ts` — `isCredentialConnected` for API keys, OAuth expiry, custom keys, and well-known credentials.
- `packages/code/src/__tests__/model-service.test.ts` — discovery context and provider headers (Codex account header, gateway `User-Agent`, local no-auth).

## Related

- `docs/features/providers.md` — transport layer that these registrations plug into.
- `docs/features/config.md` — config discovery and merge order.
- `docs/features/model-service.md` — model catalog and header derivation.
- `docs/features/doctor.md` — credential readiness checks.
- `docs/features/permissions.md` — permission profiles (providers bypass them).
