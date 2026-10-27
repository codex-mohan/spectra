# Web fetch

> Fetches a single HTTP(S) URL and returns its body as text, invoked by the agent as `web_fetch`.

## Source

- Entry: `packages/code/src/tools/web-fetch.ts` — URL validation, fetch, content-type dispatch, HTML-to-markdown conversion, character limit.
- Collaborators:
  - `packages/code/src/tools/index.ts:33-51` — `webFetchTool` is in `builtinTools`.
  - `packages/code/src/tools/index.ts:62` — `web_fetch` is in `SKIP_PERMISSION_CHECK`.
  - `packages/code/src/tools/index.ts:134-141` — SSRF guard check in `wrapExecute`.
  - `packages/code/src/security/ssrf-guard.ts` — hostname classification for loopback/private ranges.
  - `packages/code/src/services/app-version.ts:13-15` — `APP_USER_AGENT` (`spectra-code/<version>`).

## Registration / gating

- Registered by: `createBuiltinTools` (`tools/index.ts:46`), part of `builtinTools`.
- Enabled by: always; no config key disables it.
- Permission profile: none. `capabilities: { reads: false, writes: false }` (`web-fetch.ts:8`) and the tool name is in `SKIP_PERMISSION_CHECK`, so no permission dialog is shown for a fetch. `packages/code/src/__tests__/permissions.test.ts:41-64` asserts that an invalid URL produces an error without raising a permission request.
- SSRF gating runs inside `wrapExecute` (`tools/index.ts:134-141`) and only exists when tools are built with a `SecurityManager` (the TUI path, `createAllToolsWithSecurity`). The ACP server builds tools with `createAllToolsWithExtensions`, which applies no security wrapper.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | `string` | yes | Absolute URL; parsed with `new URL` before fetching. |
| `maxLength` | `number` | no | Character cap on the returned body; defaults to 10,000 (`web-fetch.ts:47`). |

## Outputs

- Tool result: one text block with the converted body, or an error text block with `isError: true`.
- No details object, no events, no files.
- HTML is converted to a rough markdown subset: `<h1>`-`<h4>` become `#`-`####`, `<li>` becomes `- `, `<br>` becomes a newline, `</p>` becomes a blank line, all other tags are stripped, six named/numeric entities are decoded, and runs of three or more newlines collapse to two (`web-fetch.ts:63-90`). `<script>`, `<style>`, `<nav>`, and `<footer>` blocks are removed first.
- `application/json` bodies are parsed and re-serialized with two-space indentation; every other content type is returned as raw text.
- When the body exceeds `maxLength`, it is cut at that many characters and `\n...(truncated)` is appended.

## Flow

1. Validate the URL with `new URL`; failure returns `Invalid URL: <url>` (`web-fetch.ts:19-23`).
2. Call global `fetch` with `User-Agent: APP_USER_AGENT` and `AbortSignal.timeout(15000)` (`web-fetch.ts:26-29`).
3. Non-2xx responses return `HTTP <status>: <statusText>`.
4. Dispatch on the `content-type` header: `text/html` → `htmlToMarkdown`, `application/json` → parse and pretty-print, otherwise `response.text()` (`web-fetch.ts:34-45`).
5. Apply the character limit and return the text.
6. Timeout errors are matched by `error.name === 'TimeoutError'`; all other failures return `Failed to fetch URL: <message>` (`web-fetch.ts:52-60`).

## State / persistence

- Stateless. No caching, no cookies persisted, no response stored on disk.

## Security

- No permission prompt: an agent can fetch any URL the SSRF guard allows without user confirmation.
- SSRF guard semantics (`security/ssrf-guard.ts:26-60`): the initial hostname is compared against `allowedHosts`; loopback (`localhost`, `::1`, `127.0.0.0/8`), RFC1918 ranges, link-local `169.254.0.0/16`, `0.0.0.0/8`, multicast/reserved `>=224`, and IPv6 `fe80:`/`fc`/`fd` prefixes are rejected by default. `security.ssrf.blockPrivate` and `blockLoopback` default to `true`.
- Only the initial URL is checked. Redirects are followed by `fetch` without re-validating the destination host, and `SsrfGuard.check` never consults its `followRedirects` field, so a public URL that redirects to a private address is not blocked by the guard.
- DNS rebinding and hostname resolution are not analyzed; the guard classifies literal IPs and known loopback names only.
- When tools are built without a `SecurityManager` (`createAllToolsWithExtensions` used by ACP, and `createAllToolsWithMcp`), no SSRF check occurs at all.
- The full response body is read into memory before truncation, so `maxLength` does not bound memory use.
- No authentication, cookies, or custom headers are supported; only the Spectra user agent is sent.

## Errors

| Condition | Result |
| --- | --- |
| Malformed URL | `Invalid URL: <url>`, `isError: true`. |
| HTTP status outside 2xx | `HTTP <status>: <statusText>`. |
| No response within 15 s | `Request timed out after 15 seconds.` |
| DNS/TLS/network failure | `Failed to fetch URL: <message>`. |
| SSRF guard rejection (security-wrapped path) | `SSRF guard: <reason>` from `wrapExecute`. |

## Limitations

- The tool description mentions PDF text extraction and image descriptions; the implementation handles only HTML, JSON, and text. PDFs and images are returned as raw bytes decoded with `response.text()`, which produces unusable output.
- HTML conversion is regex-based: nested lists, tables, code blocks, links, and images are not preserved.
- No redirect limit or redirect-host validation; redirects are whatever `fetch` does by default.
- No gzip/encoding controls, no robots.txt handling, no caching, no cookie jar.
- `maxLength` is applied after the whole body is downloaded and converted.
- ACP sessions have no permission check and no SSRF guard for this tool.

## Tests

- `packages/code/src/__tests__/permissions.test.ts:41-64` — proves an invalid URL is rejected without any permission request.
- No test performs an actual HTTP fetch or exercises HTML conversion, JSON formatting, truncation, or SSRF behavior.

## Related

- [permissions.md](permissions.md), [tool-registry.md](tool-registry.md)
- Settings keys: `security.ssrf.blockPrivate`, `security.ssrf.blockLoopback`, `security.ssrf.allowedHosts`
