/**
 * Snowflake Cortex browser OAuth + PKCE authentication.
 *
 * Sourced from reference implementation in:
 *   opencode/packages/opencode/src/plugin/snowflake-cortex.ts
 *
 * Exports:
 *   loginSnowflakeCortex(callbacks, account, role?) — browser OAuth + PKCE flow
 *   refreshSnowflakeCortexToken(account, refreshToken, signal?) — refresh_token grant
 *   snowflakeOAuthScope(role?) — build the Snowflake OAuth scope string
 */

import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import type { ProviderAuthCallbacks } from './provider-auth.js';
import type { OauthCredential } from './auth-store.js';

// ── Constants sourced from reference ─────────────────────────────────────

const OAUTH_CLIENT_ID = 'LOCAL_APPLICATION';
const OAUTH_CALLBACK_HOST = '127.0.0.1';
const OAUTH_CALLBACK_PATH = '/';
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

// ── Interfaces ──────────────────────────────────────────────────────────

interface PkceCodes {
	verifier: string;
	challenge: string;
}

interface SnowflakeTokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizeAccount(input: string): string {
	return input
		.trim()
		.replace(/^https?:\/\//, '')
		.replace(/\.snowflakecomputing\.com\/?$/, '')
		.replace(/\/+$/, '');
}

function generateRandomString(length: number): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
	return Array.from(randomBytes(length))
		.map((b) => chars[b % chars.length])
		.join('');
}

async function generatePKCE(): Promise<PkceCodes> {
	const verifier = generateRandomString(64);
	const challenge = createHash('sha256').update(verifier).digest().toString('base64url');
	return { verifier, challenge };
}

/**
 * Build the OAuth scope string for Snowflake.
 * When a role is provided and contains only safe characters, it's embedded directly;
 * otherwise it's URL-encoded as `session:role-encoded:…`.
 */
export function snowflakeOAuthScope(role: string | undefined): string {
	if (!role) return 'refresh_token';
	return /^[-_A-Za-z0-9]+$/.test(role)
		? `refresh_token session:role:${role}`
		: `refresh_token session:role-encoded:${encodeURIComponent(role)}`;
}

function buildAuthorizeUrl(
	account: string,
	role: string | undefined,
	state: string,
	pkce: PkceCodes,
	callbackUri: string,
): string {
	const params = new URLSearchParams({
		client_id: OAUTH_CLIENT_ID,
		response_type: 'code',
		redirect_uri: callbackUri,
		scope: snowflakeOAuthScope(role),
		state,
		code_challenge: pkce.challenge,
		code_challenge_method: 'S256',
	});
	return `https://${account}.snowflakecomputing.com/oauth/authorize?${params.toString()}`;
}

function snowflakeTokenToCredential(
	payload: SnowflakeTokenResponse,
	account: string,
	refreshFallback?: string,
): OauthCredential {
	if (!payload.access_token) {
		throw new Error('Snowflake token response missing access token');
	}
	const refresh = payload.refresh_token ?? refreshFallback;
	if (!refresh) {
		throw new Error('Snowflake token response missing refresh token');
	}
	return {
		type: 'oauth',
		access: payload.access_token,
		refresh,
		expires: Date.now() + (payload.expires_in ?? 600) * 1000,
		accountId: account,
	};
}

// ── Local OAuth callback server ─────────────────────────────────────────

const HTML_SUCCESS = `<!doctype html>
<html>
  <head><title>Spectra - Snowflake Authorization Successful</title></head>
  <body style="font-family: system-ui; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#111; color:#eee;">
    <div style="text-align:center; max-width:36rem; padding:2rem;">
      <h1 style="color:#7ee787;">Authorization Successful</h1>
      <p>You can close this window and return to Spectra.</p>
    </div>
    <script>setTimeout(() => window.close(), 1500)</script>
  </body>
</html>`;

const htmlError = (message: string) => `<!doctype html>
<html>
  <head><title>Spectra - Snowflake Authorization Failed</title></head>
  <body style="font-family: system-ui; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#111; color:#eee;">
    <div style="text-align:center; max-width:48rem; padding:2rem;">
      <h1 style="color:#ff7b72;">Authorization Failed</h1>
      <pre style="white-space:pre-wrap; color:#ffb3ad; background:#2a1210; padding:1rem; border-radius:.5rem;">${message}</pre>
    </div>
  </body>
</html>`;

/**
 * Start a local HTTP server that captures the Snowflake OAuth redirect.
 * State is validated inside the handler; the returned promise resolves
 * with the authorization code once the browser redirects back.
 */
function startSnowflakeCallbackServer(state: string): {
	listening: Promise<number>;
	waitForCode: (signal?: AbortSignal) => Promise<string>;
	close: () => void;
} {
	let resolveCode: (code: string) => void;
	let rejectCode: (error: Error) => void;
	const code = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});

	const server = createServer((req, res) => {
		const url = new URL(req.url || '/', `http://${req.headers.host || `${OAUTH_CALLBACK_HOST}:0`}`);

		if (url.pathname !== OAUTH_CALLBACK_PATH) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}

		const cbState = url.searchParams.get('state');
		const cbCode = url.searchParams.get('code');
		const error = url.searchParams.get('error');
		const errorDescription = url.searchParams.get('error_description');

		if (cbState !== state) {
			const msg = 'Invalid state — potential CSRF attack';
			res.writeHead(400, { 'Content-Type': 'text/html' });
			res.end(htmlError(msg));
			rejectCode(new Error(msg));
			return;
		}

		if (error) {
			const msg = errorDescription || error;
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(htmlError(msg));
			rejectCode(new Error(`Snowflake authorization failed: ${msg}`));
			return;
		}

		if (!cbCode) {
			const msg = 'Missing authorization code';
			res.writeHead(400, { 'Content-Type': 'text/html' });
			res.end(htmlError(msg));
			rejectCode(new Error(msg));
			return;
		}

		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(HTML_SUCCESS);
		resolveCode(cbCode);
	});

	const listening = new Promise<number>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, OAUTH_CALLBACK_HOST, () => {
			server.off('error', reject);
			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				reject(new Error('Unable to resolve Snowflake OAuth callback port'));
				return;
			}
			resolve(addr.port);
		});
	});

	return {
		listening,
		waitForCode: (signal?: AbortSignal) =>
			new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('Snowflake OAuth callback timeout — authorization took too long')), OAUTH_TIMEOUT_MS);
				const abort = () => reject(new Error('Login cancelled'));
				signal?.addEventListener('abort', abort, { once: true });
				code.then(resolve, reject).finally(() => {
					clearTimeout(timer);
					signal?.removeEventListener('abort', abort);
				});
			}),
		close: () => {
			if (server.listening) server.close();
		},
	};
}

// ── Token exchange ──────────────────────────────────────────────────────

async function exchangeCodeForToken(
	account: string,
	code: string,
	pkce: PkceCodes,
	callbackUri: string,
): Promise<SnowflakeTokenResponse> {
	const response = await fetch(`https://${account}.snowflakecomputing.com/oauth/token-request`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
			Authorization: `Basic ${Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_ID}`).toString('base64')}`,
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: callbackUri,
			client_id: OAUTH_CLIENT_ID,
			code_verifier: pkce.verifier,
		}),
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(`Snowflake token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
	}

	const token = (await response.json()) as SnowflakeTokenResponse;
	if (!token.access_token) throw new Error('Snowflake token response did not include access_token');
	if (!token.refresh_token) {
		throw new Error(
			'Snowflake token response did not include refresh_token. Ensure the integration is configured to issue refresh tokens and scope includes refresh_token.',
		);
	}
	return token;
}

// ── Login (browser OAuth + PKCE) ────────────────────────────────────────

export async function loginSnowflakeCortex(
	callbacks: ProviderAuthCallbacks,
	accountInput: string,
	role?: string,
): Promise<OauthCredential> {
	const account = normalizeAccount(accountInput);
	if (!account) throw new Error('Snowflake account is required');

	callbacks.onProgress('Starting Snowflake OAuth callback server...');

	const pkce = await generatePKCE();
	const state = generateRandomString(64);
	const cbServer = startSnowflakeCallbackServer(state);

	try {
		const port = await cbServer.listening;
		const callbackUri = `http://${OAUTH_CALLBACK_HOST}:${port}${OAUTH_CALLBACK_PATH}`;
		const authorizeUrl = buildAuthorizeUrl(account, role, state, pkce, callbackUri);

		callbacks.onAuth({
			url: authorizeUrl,
			instructions:
				'Complete Snowflake sign-in in your browser. Spectra will capture the OAuth callback and store the bearer token automatically.',
		});
		callbacks.onProgress('Waiting for Snowflake browser authorization...');

		const code = await cbServer.waitForCode(callbacks.signal);

		callbacks.onProgress('Exchanging authorization code for tokens...');

		const tokens = await exchangeCodeForToken(account, code, pkce, callbackUri);

		return snowflakeTokenToCredential(tokens, account);
	} finally {
		cbServer.close();
	}
}

// ── Refresh ─────────────────────────────────────────────────────────────

export async function refreshSnowflakeCortexToken(
	account: string,
	refreshToken: string,
	signal?: AbortSignal,
): Promise<OauthCredential> {
	const response = await fetch(`https://${account}.snowflakecomputing.com/oauth/token-request`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
			Authorization: `Basic ${Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_ID}`).toString('base64')}`,
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: OAUTH_CLIENT_ID,
		}),
		signal,
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(`Snowflake token refresh failed (${response.status})${detail ? `: ${detail}` : ''}`);
	}

	const token = (await response.json()) as SnowflakeTokenResponse;
	if (!token.access_token) throw new Error('Snowflake refresh response did not include access_token');
	return snowflakeTokenToCredential(token, account, refreshToken);
}
