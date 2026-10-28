# Web search

> Runs one query through a configured provider chain and returns ranked sources with titles, URLs, snippets, and an error summary when every provider fails.

## Source

- Entry: `packages/code/src/tools/web-search/index.ts` — `createWebSearchTool(guard)`, provider chain, failure aggregation.
- Providers:
  - `providers/brave.ts` — Brave Search API.
  - `providers/tavily.ts` — Tavily search API.
  - `providers/base.ts` — limits, snippet truncation, HTTP error mapping.
- Query: `query.ts` — directive parsing and lenient post-filtering.
- Output: `format.ts` — numbered source list.
- Egress: `packages/code/src/tools/network.ts` — `safeFetch()`.
- Types: `types.ts` — `SearchResult`, `SearchDetails`, provider contract, defaults.

## Registration / gating

- Registered by `createBuiltinTools` in `tools/index.ts`.
- Enabled by: `BRAVE_SEARCH_API_KEY` and/or `TAVILY_API_KEY`; optional `tools.webSearch` config selects providers and defaults.
- Permission: `web_search`, pattern `*` (no per-query host), default action `ask`.
- Missing credentials do not remove the tool; the call returns an actionable error.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | `string` | yes | Query text. Supports quoted phrases, `-term`, `site:`, `-site:`, `filetype:`, `OR`. |
| `recency` | `day \| week \| month \| year` | no | Passed to the provider as its native freshness window. |
| `limit` | `number` | no | 1–10; defaults to `tools.webSearch.maxResults` or 5. |

Config:

```jsonc
{
  "tools": {
    "webSearch": {
      "providers": ["brave", "tavily"],
      "maxResults": 5,
      "timeoutMs": 60000
    }
  }
}
```

`timeoutMs` is clamped to 1 000–300 000 per provider.

## Outputs

- Text block: optional `Note:` lines, then `N. Title (age)`, the URL, and a snippet truncated to 240 characters. No results → `No results for "<query>".`
- `details`: `{ provider, query, results, notes?, elapsedMs?, error? }`, where `results[]` is `{ title, url, snippet, publishedAt? }`.
- Failures are returned as an error text block with `details.provider = "none"` and `details.error`; the tool does not throw.
- TUI: a bordered card with the query, result count, up to three sources, click-to-expand, notes, and a provider/elapsed footer.

## Flow

1. Load `tools.webSearch`; resolve provider ids (default brave, tavily), `limit`, and `timeoutMs`.
2. `parseQuery` extracts supported directives and the text sent to providers.
3. Build providers and keep those whose key is present. None → `No web search provider configured` naming both env vars and the config path.
4. For each provider in order:
   - call `search()` with query, limit, recency, timeout, and the abort signal;
   - `safeFetch` applies SSRF, redirect, byte-cap, and timeout rules to the provider endpoint;
   - `applyConstraints` post-filters by site, excluded site, filetype, and excluded terms;
   - a dimension that would remove every result is relaxed with a note.
5. First non-empty result set wins: format, return with `details`.
6. Zero results from a provider continues to the next; only when every provider returned zero is `No results` returned.
7. Provider errors accumulate as `<provider>: <message>`; more than one becomes `All web search providers failed: …`.

## State / persistence

- Stateless. No cache, no quota tracking, no persisted history.

## Security

- Permission-gated like any other tool (`web_search`, pattern `*`).
- Provider endpoints are fixed HTTPS hosts; `safeFetch` still SSRF-checks them and every redirect.
- API keys come from environment variables only and are never written to config, logs, or tool output.
- Provider error text is normalized: 401/403 → authorization failure, 429 → rate limited, 5xx → provider error.

## Errors

| Condition | Result |
| --- | --- |
| No provider key | `No web search provider configured. Set BRAVE_SEARCH_API_KEY or TAVILY_API_KEY, or configure tools.webSearch.providers in spectra.json.` |
| Key rejected | `brave: authorization failed; check the API key`, next provider tried |
| Rate limited | `… rate limited; try again later`, next provider tried |
| Timeout | `… Request timed out after 60s.`, next provider tried |
| Invalid JSON | `… invalid JSON response`, next provider tried |
| Aborted turn | `Search aborted`, no fallback continues |
| All providers empty | `No results for "<query>".` — not an error |

## Limitations

- Two providers only; no scrapers, model-grounded search, or self-hosted engines.
- Directive parsing covers quoted phrases, `-term`, `site:`, `filetype:`, and `OR`; other operators are sent through unchanged and only post-filtered where implemented.
- `publishedAt` is provider-formatted (for example `2 days ago` or an ISO date) and is not normalized.
- Sequential fallback means a slow first provider delays the second until its timeout.
- No caching, result pagination, or per-provider quotas.

## Tests

- `packages/code/src/__tests__/web-search.test.ts` — directive parsing, site filtering and relaxation notes, Brave/Tavily parsing, authorization mapping, provider fallback, missing-key error, redirect SSRF, byte cap, formatting.
- `packages/code/src/__tests__/permissions.test.ts` — tool construction and malformed-URL behavior.
- Fetch is mocked; no live provider test runs in CI.

## Related

- [web-fetch.md](web-fetch.md), [permissions.md](permissions.md), [config.md](config.md), [tool-registry.md](tool-registry.md)
