# Web fetch

> Fetches one HTTP(S) URL and returns its body as text, invoked by the agent as `web_fetch`.

## Source

- Entry: `packages/code/src/tools/web-fetch.ts` — `createWebFetchTool(guard)`, URL validation, content-type dispatch, HTML-to-markdown conversion, character limit.
- Egress: `packages/code/src/tools/network.ts` — `safeFetch()` owns redirects, SSRF checks, timeout, and the byte cap.
- Registration: `packages/code/src/tools/index.ts` — `createBuiltinTools` builds the tool with the security manager's `SsrfGuard`.
- Collaborators:
  - `packages/code/src/security/ssrf-guard.ts` — hostname classification.
  - `packages/code/src/services/app-version.ts` — `APP_USER_AGENT`.

## Registration / gating

- Registered by `createBuiltinTools`; present in `builtinTools` and in `createAllToolsWithSecurity`.
- Enabled by: always; no config key disables it.
- Permission: `web_fetch`, pattern = hostname (the security wrapper). `capabilities: { reads: false, writes: false }`.
- URL validation runs in the wrapper before the permission check, so a malformed URL returns `Invalid URL` without prompting.
- SSRF is checked by `safeFetch` for every fetch, including construction paths without a `SecurityManager` (which use a default `SsrfGuard`).

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | `string` | yes | Absolute HTTP(S) URL. |
| `maxLength` | `number` | no | Character cap on the returned body; defaults to 10,000. |

## Outputs

- One text block with the converted body, or an error text block with `isError: true`.
- No details object, no events, no files.
- HTML → rough markdown: headings, list items, paragraphs, line breaks, six named/numeric entities; `<script>`, `<style>`, `<nav>`, `<footer>` removed.
- `application/json` is parsed and re-serialized with two-space indentation; other content types return raw text.
- When the body exceeds `maxLength`, it is cut and `\n...(truncated)` is appended. A body truncated by the 2 MiB byte cap is marked `...(response truncated)`.

## Flow

1. `new URL(url)`; malformed input returns `Invalid URL: <url>`.
2. `safeFetch(url, guard, { timeoutMs: 15000, maxBytes: 2 MiB })`:
   - parse and SSRF-check each hop,
   - follow up to 5 redirects with a fresh check per hop,
   - stream at most 2 MiB,
   - apply a 15 s timeout.
3. `safeFetch` failure returns its message verbatim (`SSRF guard: …`, `Request timed out after 15s.`, `Fetch failed: …`, `Too many redirects`).
4. Non-2xx returns `HTTP <status>: <statusText>`.
5. Dispatch on `content-type`: HTML → markdown, JSON → pretty print, otherwise text.
6. Apply `maxLength` and return.

## State / persistence

- Stateless. No caching, cookies, or response files.

## Security

- Permission prompt by default (`ask`), pattern = hostname; denied calls never reach the network.
- SSRF checked on the initial URL and on every redirect target. Loopback, RFC1918, link-local, `0.0.0.0/8`, multicast, and IPv6 `fe80:`/`fc`/`fd` are rejected unless the host is in `security.ssrf.allowedHosts`.
- Response bodies are capped at 2 MiB while streaming, so a hostile endpoint cannot exhaust memory.
- DNS rebinding is not analyzed; the guard classifies literal IPs and known loopback names.
- Only the Spectra user agent is sent; no cookies or authentication headers.

## Errors

| Condition | Result |
| --- | --- |
| Malformed URL | `Invalid URL: <url>`, `isError: true`, no prompt. |
| HTTP status outside 2xx | `HTTP <status>: <statusText>`. |
| No response within 15 s | `Request timed out after 15s.` |
| Caller aborted | `Request aborted`. |
| SSRF guard rejection | `SSRF guard: <reason>`, `isError: true`. |
| More than 5 redirects | `Too many redirects`. |
| DNS/TLS/network failure | `Fetch failed: <message>`. |

## Limitations

- The tool description mentions PDFs and images, but only HTML, JSON, and text are converted; other bodies are returned as raw decoded text.
- HTML conversion is regex-based: tables, nested lists, code blocks, links, and images are not preserved.
- The byte cap can truncate a response before `maxLength` applies.
- No cookies, authentication, custom headers, robots.txt handling, or caching.
- DNS rebinding is out of scope.

## Tests

- `packages/code/src/__tests__/permissions.test.ts` — malformed URL is rejected without a permission request.
- `packages/code/src/__tests__/web-search.test.ts` — `safeFetch` re-checks SSRF on a redirect target and caps an oversized body.
- No live-network test; fetch is mocked.

## Related

- [web-search.md](web-search.md), [permissions.md](permissions.md), [tool-registry.md](tool-registry.md)
- Settings keys: `security.ssrf.blockPrivate`, `security.ssrf.blockLoopback`, `security.ssrf.allowedHosts`
