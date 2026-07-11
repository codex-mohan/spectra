/**
 * DigitalOcean Browser OAuth — Implicit Grant Flow
 *
 * DigitalOcean uses an implicit-authorization flow that delivers the access
 * token directly in the redirect URI's hash fragment (`#access_token=…`).
 * A lightweight local HTTP server serves a callback page that extracts the
 * token from the fragment, validates the `state` parameter for CSRF
 * protection, and relays the token back to the waiting auth flow over a
 * local POST endpoint.
 *
 * Because implicit grant never issues a refresh token, this module exports
 * only `loginDigitalOcean`.  There is **no** `refreshDigitalOceanToken`
 * — the caller must re-authenticate when the access token expires.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { OauthCredential } from './auth-store.js';
import type { ProviderAuthCallbacks } from './provider-auth.js';

// ---------------------------------------------------------------------------
// Constants — sourced from the OpenCode DigitalOcean plugin reference
// ---------------------------------------------------------------------------

const DO_OAUTH_CLIENT_ID =
	'b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82';
const DO_AUTHORIZE_URL = 'https://cloud.digitalocean.com/v1/oauth/authorize';
const OAUTH_PORT = 1456;
const OAUTH_REDIRECT_PATH = '/auth/callback';
const OAUTH_TOKEN_PATH = '/auth/token';
const OAUTH_SCOPES = 'genai:read inference:query';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the implicit-grant payload relayed from the browser callback. */
interface ImplicitTokenPayload {
	access_token: string;
	expires_in: number;
	state: string;
}

/** Internal handle returned by the local OAuth server helpers. */
interface OAuthServerHandle {
	listening: Promise<void>;
	waitForCallback: (signal?: AbortSignal) => Promise<ImplicitTokenPayload>;
	close: () => void;
	pendingState: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function redirectUri(): string {
	return `http://localhost:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`;
}

function buildAuthorizeUrl(state: string): string {
	const params = new URLSearchParams({
		response_type: 'token',
		client_id: DO_OAUTH_CLIENT_ID,
		redirect_uri: redirectUri(),
		scope: OAUTH_SCOPES,
		state,
	});
	return `${DO_AUTHORIZE_URL}?${params}`;
}

// ---------------------------------------------------------------------------
// HTML served at the redirect callback — extracts hash-fragment tokens
// ---------------------------------------------------------------------------

const HTML_CALLBACK = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Spectra — DigitalOcean Authorization</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0b1220; color: #e8eef9; }
      .container { text-align: center; padding: 2rem; max-width: 32rem; }
      h1 { color: #e8eef9; margin-bottom: 1rem; }
      p { color: #9aa9c0; }
      .error { color: #ff917b; font-family: monospace; margin-top: 1rem; padding: 1rem; background: #3c140d; border-radius: 0.5rem; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1 id="title">Finishing sign-in...</h1>
      <p id="msg">You can close this window once it says you're signed in.</p>
    </div>
    <script>
      (async function() {
        var params = new URLSearchParams((window.location.hash || "").slice(1));
        var search = new URLSearchParams(window.location.search);
        var error = params.get("error") || search.get("error");
        var errorDescription = params.get("error_description") || search.get("error_description");
        var titleEl = document.getElementById("title");
        var msgEl = document.getElementById("msg");
        var tokenUrl = new URL(${JSON.stringify(OAUTH_TOKEN_PATH)}, window.location.origin).href;
        try {
          var body = error
            ? { error: error, error_description: errorDescription || "" }
            : { access_token: params.get("access_token") || "", expires_in: params.get("expires_in") || "0", state: params.get("state") || "" };
          var res = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            var detail = await res.text().catch(function() { return ""; });
            throw new Error(detail || ("callback failed (" + res.status + ")"));
          }
          if (error) {
            titleEl.textContent = "Authorization Failed";
            msgEl.textContent = errorDescription || error;
            msgEl.className = "error";
            return;
          }
          titleEl.textContent = "Authorization Successful";
          msgEl.textContent = "You can close this window and return to Spectra.";
          setTimeout(function() { window.close(); }, 2000);
        } catch (e) {
          titleEl.textContent = "Authorization Failed";
          msgEl.textContent = String(e && e.message ? e.message : e);
          msgEl.className = "error";
        }
      })()
    </script>
  </body>
</html>`;

// ---------------------------------------------------------------------------
// Local OAuth server
// ---------------------------------------------------------------------------

function startOAuthServer(): OAuthServerHandle {
	let pendingResolve: ((payload: ImplicitTokenPayload) => void) | undefined;
	let pendingReject: ((error: Error) => void) | undefined;

	const { promise: callbackPromise, resolve: resolveCallback, reject: rejectCallback } =
		Promise.withResolvers<ImplicitTokenPayload>();

	pendingResolve = resolveCallback;
	pendingReject = rejectCallback;

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? '/', `http://localhost:${OAUTH_PORT}`);

		// Browser redirect — serve the JS extraction page
		if (req.method === 'GET' && url.pathname === OAUTH_REDIRECT_PATH) {
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(HTML_CALLBACK);
			return;
		}

		// Token relay from the browser-side script
		if (req.method === 'POST' && url.pathname === OAUTH_TOKEN_PATH) {
			const chunks: Buffer[] = [];
			req.on('data', (chunk: Buffer) => chunks.push(chunk));
			req.on('end', () => {
				const raw = Buffer.concat(chunks).toString('utf8');
				let body: Record<string, string> = {};
				try {
					body = raw ? JSON.parse(raw) : {};
				} catch {
					body = {};
				}

				if (!pendingResolve || !pendingReject) {
					res.writeHead(409, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'no_pending_oauth' }));
					return;
				}

				// Propagate OAuth error from the provider
				if (body.error) {
					const message = body.error_description || body.error || 'OAuth error';
					pendingReject(new Error(String(message)));
					pendingResolve = undefined;
					pendingReject = undefined;
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ ok: true }));
					return;
				}

				if (!body.access_token) {
					pendingReject(new Error('Missing access_token in callback'));
					pendingResolve = undefined;
					pendingReject = undefined;
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'missing_access_token' }));
					return;
				}

				// CSRF state validation
				if (body.state !== pendingState) {
					pendingReject(new Error('Invalid state — potential CSRF attack'));
					pendingResolve = undefined;
					pendingReject = undefined;
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'invalid_state' }));
					return;
				}

				const expires = parseInt(body.expires_in || '0', 10);
				pendingResolve({
					access_token: body.access_token,
					expires_in: Number.isFinite(expires) && expires > 0 ? expires : 60 * 60 * 24 * 30,
					state: body.state,
				});
				pendingResolve = undefined;
				pendingReject = undefined;
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ok: true }));
			});
			return;
		}

		res.writeHead(404);
		res.end('Not found');
	});

	// Mutable state captured by the closure — set before the server starts
	let pendingState = '';

	const { promise: listening, resolve: listeningResolve, reject: listeningReject } = Promise.withResolvers<void>();
	server.once('error', listeningReject);
	server.listen(OAUTH_PORT, () => {
		server.off('error', listeningReject);
		listeningResolve();
	});

	return {
		listening,
		waitForCallback: (signal?: AbortSignal) => {
			const { promise, resolve, reject } = Promise.withResolvers<ImplicitTokenPayload>();
			const timer = setTimeout(() => reject(new Error('DigitalOcean OAuth callback timeout — authorization took too long')), CALLBACK_TIMEOUT_MS);
			const onAbort = () => reject(new Error('Login cancelled'));
			signal?.addEventListener('abort', onAbort, { once: true });
			callbackPromise.then(resolve, reject).finally(() => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
			});
			return promise;
		},
		close: () => {
			if (server.listening) server.close();
		},
		// Expose setter so loginDigitalOcean can stamp the expected state before
		// the server begins accepting requests.
		set pendingState(value: string) { pendingState = value; },
	};
}

// ---------------------------------------------------------------------------
// Exported login function
// ---------------------------------------------------------------------------

/**
 * Launch the DigitalOcean browser-based implicit OAuth flow.
 *
 * Opens the DO authorization page in the default browser and waits for the
 * user to approve access.  Returns an `OauthCredential` whose `refresh`
 * field is an empty string — implicit grant never issues refresh tokens.
 *
 * @throws On timeout, abort, or if the provider returns an error.
 */
export async function loginDigitalOcean(callbacks: ProviderAuthCallbacks): Promise<OauthCredential> {
	const state = generateState();
	const server = startOAuthServer();
	server.pendingState = state;
	try {
		await server.listening;
		const authorizeUrl = buildAuthorizeUrl(state);
		callbacks.onAuth({
			url: authorizeUrl,
			instructions:
				'Sign in to DigitalOcean in your browser. Spectra will use your DigitalOcean API token for GenAI inference.',
		});
		callbacks.onProgress('Waiting for DigitalOcean browser authorization...');
		const payload = await server.waitForCallback(callbacks.signal);
		callbacks.onProgress('DigitalOcean authorization complete.');
		return {
			type: 'oauth',
			access: payload.access_token,
			refresh: '', // implicit grant — no refresh token available
			expires: Date.now() + payload.expires_in * 1000,
		};
	} finally {
		server.close();
	}
}

// ---------------------------------------------------------------------------
// Refresh — NOT available
// ---------------------------------------------------------------------------

/**
 * DigitalOcean's implicit grant flow does not issue refresh tokens.
 * When the access token expires, the caller must re-invoke `loginDigitalOcean`
 * to obtain a fresh credential.
 *
 * This function is intentionally **not exported**.  A refresh attempt would
 * fail with: "DigitalOcean implicit grant does not support token refresh."
 */
