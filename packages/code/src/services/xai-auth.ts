import { createHash, randomBytes } from 'crypto';
import { createServer } from 'http';
import type { OauthCredential } from './auth-store.js';
import type { ProviderAuthCallbacks } from './provider-auth.js';

// Public Grok-CLI OAuth client. xAI's auth server rejects loopback OAuth from
// non-allowlisted clients, so we reuse the Grok-CLI client_id that xAI ships
// for desktop OAuth flows. Source of truth: hermes-agent PR #26534.
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const AUTHORIZE_URL = 'https://auth.x.ai/oauth2/authorize';
const TOKEN_URL = 'https://auth.x.ai/oauth2/token';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';

// xAI rejects redirect_uris that don't match what was registered for the
// Grok-CLI client. The host:port pair is part of the registration, so we
// must bind the loopback server to this exact port.
const OAUTH_HOST = '127.0.0.1';
const OAUTH_PORT = 56121;
const OAUTH_REDIRECT_PATH = '/callback';
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`;

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// CORS allowlist for the loopback callback. The redirect_uri itself is
// already bound to 127.0.0.1 and gated by PKCE+state, so we only accept
// xAI's own auth origins for additional defense-in-depth on the OPTIONS
// preflight.
const CORS_ALLOWED_ORIGINS = new Set(['https://accounts.x.ai', 'https://auth.x.ai']);

// ── PKCE & state helpers ──────────────────────────────────────────────

interface PkceCodes {
	verifier: string;
	challenge: string;
}

function base64UrlEncode(value: Buffer): string {
	return value.toString('base64url');
}

function generateRandomString(length: number): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
	return Array.from(randomBytes(length))
		.map((b) => chars[b % chars.length])
		.join('');
}

function generatePkce(): PkceCodes {
	const verifier = generateRandomString(64);
	const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

function generateState(): string {
	return base64UrlEncode(randomBytes(32));
}

// ── Token response shape ──────────────────────────────────────────────

interface XaiTokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
	error?: string;
	error_description?: string;
	interval?: number;
}

// ── HTML pages served by the local callback ───────────────────────────

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>Spectra - xAI Authorization Successful</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #131010; color: #f1ecec; }
      .container { text-align: center; padding: 2rem; }
      h1 { color: #f1ecec; margin-bottom: 1rem; }
      p { color: #b7b1b1; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to Spectra.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`;

function htmlError(error: string): string {
	return `<!doctype html>
<html>
  <head>
    <title>Spectra - xAI Authorization Failed</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #131010; color: #f1ecec; }
      .container { text-align: center; padding: 2rem; }
      h1 { color: #fc533a; margin-bottom: 1rem; }
      p { color: #b7b1b1; }
      .error { color: #ff917b; font-family: monospace; margin-top: 1rem; padding: 1rem; background: #3c140d; border-radius: 0.5rem; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${escapeHtml(error)}</div>
    </div>
  </body>
</html>`;
}

// ── Callback server ───────────────────────────────────────────────────

interface PendingXaiAuth {
	pkce: PkceCodes;
	state: string;
	resolve: (code: string) => void;
	reject: (error: Error) => void;
}

function startXaiCallbackServer(): {
	listen: Promise<void>;
	waitForCode: (pkce: PkceCodes, state: string, signal?: AbortSignal) => Promise<string>;
	close: () => void;
} {
	let pending: PendingXaiAuth | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const server = createServer((req, res) => {
		const reqUrl = req.url || '/';
		const url = new URL(reqUrl, `http://${OAUTH_HOST}:${OAUTH_PORT}`);

		// CORS — defense-in-depth; redirect_uri is already bound to 127.0.0.1
		const origin = req.headers['origin'];
		const allowOrigin = typeof origin === 'string' && CORS_ALLOWED_ORIGINS.has(origin) ? origin : '';
		if (allowOrigin) {
			res.setHeader('Access-Control-Allow-Origin', allowOrigin);
			res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
			res.setHeader('Access-Control-Allow-Private-Network', 'true');
			res.setHeader('Vary', 'Origin');
		}
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		if (url.pathname === OAUTH_REDIRECT_PATH) {
			const code = url.searchParams.get('code');
			const state = url.searchParams.get('state');
			const error = url.searchParams.get('error');
			const errorDescription = url.searchParams.get('error_description');

			if (error) {
				const errorMsg = errorDescription || error;
				pending?.reject(new Error(errorMsg));
				pending = undefined;
				res.writeHead(200, { 'Content-Type': 'text/html' });
				res.end(htmlError(errorMsg));
				return;
			}

			if (!code) {
				const errorMsg = 'Missing authorization code';
				pending?.reject(new Error(errorMsg));
				pending = undefined;
				res.writeHead(400, { 'Content-Type': 'text/html' });
				res.end(htmlError(errorMsg));
				return;
			}

			if (!pending || state !== pending.state) {
				const errorMsg = 'Invalid state — potential CSRF attack';
				pending?.reject(new Error(errorMsg));
				pending = undefined;
				res.writeHead(400, { 'Content-Type': 'text/html' });
				res.end(htmlError(errorMsg));
				return;
			}

			const current = pending;
			pending = undefined;
			if (timer) { clearTimeout(timer); timer = undefined; }

			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(HTML_SUCCESS);
			current.resolve(code);
			return;
		}

		if (url.pathname === '/cancel') {
			pending?.reject(new Error('Login cancelled'));
			pending = undefined;
			if (timer) { clearTimeout(timer); timer = undefined; }
			res.writeHead(200);
			res.end('Login cancelled');
			return;
		}

		res.writeHead(404);
		res.end('Not found');
	});

	const listen = new Promise<void>((resolve, reject) => {
		const onError = (err: Error) => {
			reject(err);
		};
		server.once('error', onError);
		server.listen(OAUTH_PORT, OAUTH_HOST, () => {
			server.removeListener('error', onError);
			// Install a log-only handler so subsequent accept/socket errors
			// don't crash the process.
			server.on('error', (err) => {
				console.error('xAI callback server error:', err.message);
			});
			resolve();
		});
	});

	function waitForCode(pkce: PkceCodes, state: string, signal?: AbortSignal): Promise<string> {
		// Reject any stale in-flight authorize
		if (pending) {
			pending.reject(new Error('Superseded by a newer xAI authorize request'));
			pending = undefined;
		}
		if (timer) { clearTimeout(timer); timer = undefined; }

		return new Promise<string>((resolve, reject) => {
			timer = setTimeout(() => {
				pending = undefined;
				timer = undefined;
				reject(new Error('xAI OAuth callback timeout — authorization took too long'));
			}, CALLBACK_TIMEOUT_MS);

			const onAbort = () => {
				if (timer) { clearTimeout(timer); timer = undefined; }
				pending = undefined;
				reject(new Error('Login cancelled'));
			};
			signal?.addEventListener('abort', onAbort, { once: true });

			pending = {
				pkce,
				state,
				resolve: (code) => {
					if (timer) { clearTimeout(timer); timer = undefined; }
					signal?.removeEventListener('abort', onAbort);
					resolve(code);
				},
				reject: (error) => {
					if (timer) { clearTimeout(timer); timer = undefined; }
					signal?.removeEventListener('abort', onAbort);
					reject(error);
				},
			};
		});
	}

	function close() {
		if (timer) { clearTimeout(timer); timer = undefined; }
		if (server.listening) server.close();
	}

	return { listen, waitForCode, close };
}

// ── Token exchange & refresh ──────────────────────────────────────────

function xaiTokenToCredential(payload: XaiTokenResponse, refreshFallback?: string): OauthCredential {
	if (!payload.access_token) {
		throw new Error('xAI token response missing access token');
	}
	const refresh = payload.refresh_token ?? refreshFallback;
	if (!refresh) {
		throw new Error('xAI token response missing refresh token');
	}
	return {
		type: 'oauth',
		access: payload.access_token,
		refresh,
		expires: Date.now() + (payload.expires_in ?? 3600) * 1000,
	};
}

async function exchangeCodeForTokens(
	code: string,
	pkce: PkceCodes,
	signal?: AbortSignal,
): Promise<XaiTokenResponse> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: REDIRECT_URI,
			client_id: CLIENT_ID,
			code_verifier: pkce.verifier,
		}),
		signal,
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(`xAI token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
	}
	return response.json() as Promise<XaiTokenResponse>;
}

// ── Authorize URL ─────────────────────────────────────────────────────

function buildAuthorizeUrl(pkce: PkceCodes, state: string, nonce: string): string {
	// `plan=generic` opts the consent screen into xAI's generic OAuth plan tier;
	// without it, accounts.x.ai rejects loopback OAuth from non-allowlisted
	// clients. `referrer=spectra` lets xAI attribute Spectra-originated logins
	// in their OAuth server logs (best-effort attribution while we reuse the
	// Grok-CLI client_id).
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		scope: SCOPE,
		code_challenge: pkce.challenge,
		code_challenge_method: 'S256',
		state,
		nonce,
		plan: 'generic',
		referrer: 'spectra',
	});
	return `${AUTHORIZE_URL}?${params}`;
}

// ── Public API ────────────────────────────────────────────────────────

export async function loginXai(callbacks: ProviderAuthCallbacks): Promise<OauthCredential> {
	const pkce = generatePkce();
	const state = generateState();
	const nonce = generateState();
	const authUrl = buildAuthorizeUrl(pkce, state, nonce);

	const callbackServer = startXaiCallbackServer();
	try {
		await callbackServer.listen;
		callbacks.onAuth({ url: authUrl, instructions: 'Open this URL to authorize Spectra with xAI (SuperGrok).' });
		callbacks.onProgress('Waiting for xAI browser authorization...');
		const code = await callbackServer.waitForCode(pkce, state, callbacks.signal);
		callbacks.onProgress('Exchanging authorization code for tokens...');
		const payload = await exchangeCodeForTokens(code, pkce, callbacks.signal);
		return xaiTokenToCredential(payload);
	} finally {
		callbackServer.close();
	}
}

export async function refreshXaiToken(refreshToken: string, signal?: AbortSignal): Promise<OauthCredential> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
		signal,
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(`xAI token refresh failed (${response.status})${detail ? `: ${detail}` : ''}`);
	}
	return xaiTokenToCredential(await response.json() as XaiTokenResponse, refreshToken);
}
