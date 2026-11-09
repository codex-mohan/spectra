# Browser automation

> Eight agent tools drive a managed Chromium process: open, observe, click, type, extract, wait, screenshot, and close.

## Source

- Entry: `packages/code/src/tools/browser.ts` — tool schemas, permission/SSRF gating, screenshot artifact and image shaping.
- Entry: `packages/code/src/browser/manager.ts` — singleton Chromium process, per-session browser contexts, tab registry, idle close, crash recycle, shutdown.
- Entry: `packages/code/src/browser/tab.ts` — observe refs, navigation invalidation, click/type/extract/wait/screenshot/freeze.
- Entry: `packages/code/src/browser/network.ts` — host allowlist and request blocking.
- Entry: `packages/code/src/browser/executable.ts` — Chrome/Edge resolution order.
- Collaborators:
  - `puppeteer-core@25` — CDP transport and process launch.
  - `packages/code/src/security/ssrf-guard.ts` — private/loopback blocking.
  - `packages/code/src/tui/components/message.tsx` — inline tool images.
  - `packages/code/src/config/registry.ts` — `browser.*` settings.

## Registration / gating

- Registered by: `createAllToolsWithSecurity` (TUI), `createAllToolsWithExtensions` (ACP), and `createAllTools`.
- Enabled by: `browser.enabled`, default `true`.
- Permission: every navigation requests the `browser` permission with the hostname as the target, approval tier `network`. Non-navigation actions reuse the open tab authorization.
- SSRF: `checkRequestUrl` runs before navigation and on every intercepted request.

## Inputs

| Tool | Fields |
| --- | --- |
| `browser_open` | `name?`, `url?`, `viewport?`, `allowed_domains?`, `headed?`, `timeout?`, `persist?` |
| `browser_observe` | `tab?`, `includeAll?`, `viewportOnly?`, `selector?` |
| `browser_click` | `tab?`, `ref?`, `selector?`, `button?`, `count?` |
| `browser_type` | `tab?`, `ref?`, `selector?`, `text`, `clear?`, `submit?` |
| `browser_extract` | `tab?`, `selector?`, `format?` (`text\|html\|value\|attr`), `attr?` |
| `browser_wait` | `tab?`, `selector?`, `text?`, `url?`, `timeout?` |
| `browser_screenshot` | `tab?`, `full_page?`, `selector?` |
| `browser_close` | `tab?`, `all?` |

All tools require `ctx.sessionId`. Tab names default to `main`.

## Outputs

- Text summaries plus structured `details` for TUI cards.
- `browser_observe` → `{ url, title, elements: [{ id, role, name, tag, value? }] }`.
- `browser_screenshot` → text with the full-resolution path + an `image` content block capped for the model.
- Files: full PNG under `browser.screenshotDir`, else `<SPECTRA_HOME>/artifacts/<sessionId>/`.
- Events: ordinary tool execution events; screenshots render through the tool message's image list.

## Flow

1. Resolve Chromium: `SPECTRA_CHROME_PATH` → `browser.executablePath` → Chrome → Edge → OS paths. Attach instead when `browser.cdpUrl` is set.
2. `BrowserManager` launches one Chromium, creates a browser context per session, and opens a page per named tab.
3. Request interception enforces `allowedDomains` and SSRF before any navigation or subresource loads.
4. `browser_observe` collects visible interactive elements, stores the ordered list on the page, and returns refs `e1…eN`.
5. Actions resolve refs by index. `framenavigated` clears the ref list; a stale ref errors and requires a new observe.
6. Screenshots save full resolution first, then return a JPEG/PNG under 1024 px and 150 KiB when needed.
7. Turn end freezes owned tabs; idle tabs close after `browser.idleCloseSec`. Session close closes its context; app shutdown closes the browser and temporary profile.

## State / persistence

- One managed Chromium per process. Session contexts isolate cookies/storage.
- Tabs survive across turns until idle close, explicit close, session removal, or app shutdown.
- Non-persistent launches use a temporary profile deleted on shutdown; `browser.persistProfile` keeps `<home>/browser/profile`.
- Ref maps live in page JS and are invalidated on navigation; nothing is written to disk.
- CDP-attached browsers are disconnected, never closed.

## Security

- Hostname allowlist (`example.com`, `*.example.com`) aborts other HTTP(S)/WS(S) requests.
- SSRF blocks loopback/private hosts unless the host is explicitly allowlisted or in `security.ssrf.allowedHosts`.
- `file:`, `javascript:`, and other non-web protocols are blocked.
- Permission is requested on navigation with the hostname as the pattern.
- Screenshot files are written under the artifacts directory; full-resolution files stay local.
- Attached/real browser sessions are the user's; closing a session disconnects rather than kills.

## Errors

| Condition | Result |
| --- | --- |
| Chromium missing | actionable error naming `SPECTRA_CHROME_PATH` and tried paths |
| Browser disabled | `Browser automation is disabled by browser.enabled=false` |
| Permission denied | `Permission denied: …` |
| Host not allowlisted / SSRF | request aborted; navigation returns the reason |
| Unknown tab | `Call browser_open first` |
| Stale ref | `Element references are stale after navigation. Call browser_observe again.` |
| Missing selector | `Selector not found` / wait timeout |
| Browser crash | manager resets; next call relaunches lazily |

## Limitations

- Managed Chromium and CDP attach only; relay, Tern/cmux, downloads, and PDF are intentionally absent.
- `allowedDomains` is request filtering, not an OS sandbox.
- Screenshot shaping uses JPEG quality/viewport scaling rather than a pixel-perfect image pipeline.
- Browser actions are not streamed; each tool returns after the action settles.
- Full-page screenshots can still be large on disk even though the model image is capped.

## Tests

- `packages/code/src/__tests__/browser-network.test.ts` — host matching, protocols, SSRF/allowlist precedence.
- `packages/code/src/__tests__/browser-manager.test.ts` — tab reuse, session isolation, crash recycle, disabled mode, idle close.
- `packages/code/src/__tests__/browser-tab.test.ts` — observe refs, navigation invalidation, click/type.
- `packages/code/src/__tests__/browser-tools.test.ts` — session requirement, permission/SSRF gates, output formatting, session close.
- Local Chromium smoke: form fill → click → extract → screenshot verified against a fixture server.
