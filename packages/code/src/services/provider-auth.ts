import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer } from 'http';
import { scheduler } from 'timers/promises';
import { getGlobalDataDir } from '../utils/paths.js';
import type { OauthCredential } from './auth-store.js';
import { c } from '../tui/tokens.js';

export interface AuthInfo {
	url: string;
	instructions?: string;
}

export interface ProviderAuthCallbacks {
	onAuth: (info: AuthInfo) => void;
	onProgress: (message: string) => void;
	signal?: AbortSignal;
}

interface DeviceAuthorizationResponse {
	user_code?: string;
	device_code?: string;
	verification_uri?: string;
	verification_uri_complete?: string;
	expires_in?: number;
	interval?: number;
}

interface TokenResponse {
	access_token?: string;
	id_token?: string;
	refresh_token?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
	interval?: number;
}


const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_OAUTH_HOST = 'https://auth.openai.com';
const CODEX_AUTHORIZE_URL = `${CODEX_OAUTH_HOST}/oauth/authorize`;
const CODEX_TOKEN_URL = `${CODEX_OAUTH_HOST}/oauth/token`;
const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CODEX_SCOPE = 'openid profile email offline_access';
const CODEX_CALLBACK_START_TIMEOUT_MS = 10_000;
const CODEX_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const CODEX_TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const KIMI_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const KIMI_OAUTH_HOST = 'https://auth.kimi.com';
const OAUTH_EXPIRY_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_DEVICE_FLOW_TTL_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;

function deviceIdPath(): string {
	const dir = getGlobalDataDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, 'kimi-device-id');
}

function getKimiDeviceId(): string {
	const path = deviceIdPath();
	try {
		const existing = readFileSync(path, 'utf-8').trim();
		if (existing) return existing;
	} catch {}
	const deviceId = randomUUID().replace(/-/g, '');
	writeFileSync(path, `${deviceId}\n`, { mode: 0o600, encoding: 'utf-8' });
	return deviceId;
}

function kimiHeaders(): Record<string, string> {
	return {
		'User-Agent': 'SpectraCode/0.5',
		'X-Msh-Platform': 'spectra_code',
		'X-Msh-Version': '0.5',
		'X-Msh-Device-Id': getKimiDeviceId(),
	};
}

function tokenToCredential(payload: TokenResponse, refreshFallback?: string): OauthCredential {
	if (!payload.access_token || typeof payload.expires_in !== 'number') {
		throw new Error('Kimi token response missing access token or expiry');
	}
	const refresh = payload.refresh_token ?? refreshFallback;
	if (!refresh) throw new Error('Kimi token response missing refresh token');
	return {
		type: 'oauth',
		access: payload.access_token,
		refresh,
		expires: Date.now() + payload.expires_in * 1000 - OAUTH_EXPIRY_SKEW_MS,
	};
}

function parseJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
	if (!token) return undefined;
	const segments = token.split('.');
	if (segments.length !== 3) return undefined;
	try {
		const payload: unknown = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
		return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
			? payload as Record<string, unknown>
			: undefined;
	} catch {
		return undefined;
	}
}

/** Read the account identity OpenAI embeds in Codex OAuth JWT claims. */
export function extractCodexAccountId(...tokens: Array<string | undefined>): string | undefined {
	for (const token of tokens) {
		const claims = parseJwtPayload(token);
		const auth = claims?.['https://api.openai.com/auth'];
		if (auth !== null && typeof auth === 'object' && !Array.isArray(auth)) {
			const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
			if (typeof accountId === 'string' && accountId.length > 0) return accountId;
		}
	}
	return undefined;
}

function codexTokenToCredential(payload: TokenResponse, refreshFallback?: string): OauthCredential {
	if (!payload.access_token || typeof payload.expires_in !== 'number') {
		throw new Error('Codex token response missing access token or expiry');
	}
	const refresh = payload.refresh_token ?? refreshFallback;
	if (!refresh) throw new Error('Codex token response missing refresh token');
	return {
		type: 'oauth',
		access: payload.access_token,
		refresh,
		expires: Date.now() + payload.expires_in * 1000 - OAUTH_EXPIRY_SKEW_MS,
		accountId: extractCodexAccountId(payload.id_token, payload.access_token),
	};
}

async function requestKimiDeviceAuthorization(signal?: AbortSignal) {
	const response = await fetch(`${KIMI_OAUTH_HOST}/api/oauth/device_authorization`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...kimiHeaders() },
		body: new URLSearchParams({ client_id: KIMI_CLIENT_ID }),
		signal,
	});
	if (!response.ok) throw new Error(`Kimi device authorization failed: ${response.status} ${await response.text()}`);
	const payload = await response.json() as DeviceAuthorizationResponse;
	if (!payload.user_code || !payload.device_code || !payload.verification_uri) {
		throw new Error('Kimi device authorization response missing required fields');
	}
	return {
		userCode: payload.user_code,
		deviceCode: payload.device_code,
		verificationUri: payload.verification_uri_complete || payload.verification_uri,
		expiresInMs: typeof payload.expires_in === 'number' ? payload.expires_in * 1000 : DEFAULT_DEVICE_FLOW_TTL_MS,
		intervalMs: typeof payload.interval === 'number' && payload.interval > 0 ? payload.interval * 1000 : DEFAULT_POLL_INTERVAL_MS,
	};
}

async function pollKimiToken(deviceCode: string, intervalMs: number, expiresInMs: number, callbacks: ProviderAuthCallbacks): Promise<OauthCredential> {
	const deadline = Date.now() + expiresInMs;
	let waitMs = Math.max(1000, intervalMs);
	while (Date.now() < deadline) {
		if (callbacks.signal?.aborted) throw new Error('Login cancelled');
		const response = await fetch(`${KIMI_OAUTH_HOST}/api/oauth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...kimiHeaders() },
			body: new URLSearchParams({
				client_id: KIMI_CLIENT_ID,
				device_code: deviceCode,
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			}),
			signal: callbacks.signal,
		});
		const payload = await response.json() as TokenResponse;
		if (response.ok && payload.access_token) return tokenToCredential(payload);
		if (payload.error === 'authorization_pending') {
			callbacks.onProgress('Waiting for Kimi browser authorization...');
			await scheduler.wait(waitMs, { signal: callbacks.signal });
			continue;
		}
		if (payload.error === 'slow_down') {
			waitMs = Math.max(waitMs + 5000, typeof payload.interval === 'number' ? payload.interval * 1000 : waitMs);
			callbacks.onProgress('Kimi asked us to slow polling; still waiting...');
			await scheduler.wait(waitMs, { signal: callbacks.signal });
			continue;
		}
		const description = payload.error_description ? `: ${payload.error_description}` : '';
		throw new Error(`Kimi device flow failed: ${payload.error ?? response.status}${description}`);
	}
	throw new Error('Kimi device flow timed out');
}

export async function loginKimiCode(callbacks: ProviderAuthCallbacks): Promise<OauthCredential> {
	callbacks.onProgress('Requesting Kimi device authorization...');
	const device = await requestKimiDeviceAuthorization(callbacks.signal);
	callbacks.onAuth({ url: device.verificationUri, instructions: `Open this URL and enter code: ${device.userCode}` });
	callbacks.onProgress(`Waiting for Kimi authorization code ${device.userCode}...`);
	return pollKimiToken(device.deviceCode, device.intervalMs, device.expiresInMs, callbacks);
}

export async function refreshKimiCode(refreshToken: string, signal?: AbortSignal): Promise<OauthCredential> {
	const response = await fetch(`${KIMI_OAUTH_HOST}/api/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...kimiHeaders() },
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: KIMI_CLIENT_ID }),
		signal,
	});
	if (!response.ok) throw new Error(`Kimi token refresh failed: ${response.status}`);
	return tokenToCredential(await response.json() as TokenResponse, refreshToken);
}

interface CodexAuthorizationFlow {
	verifier: string;
	state: string;
	url: string;
}

function base64UrlEncode(value: Buffer): string {
	return value.toString('base64url');
}

export function createCodexAuthorizationFlow(): CodexAuthorizationFlow {
	const verifier = base64UrlEncode(randomBytes(32));
	const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
	const state = randomBytes(16).toString('hex');
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: CODEX_CLIENT_ID,
		redirect_uri: CODEX_REDIRECT_URI,
		scope: CODEX_SCOPE,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		state,
		id_token_add_organizations: 'true',
		codex_cli_simplified_flow: 'true',
		originator: 'spectra',
	});
	return { verifier, state, url: `${CODEX_AUTHORIZE_URL}?${params}` };
}

/** Escape text for safe insertion into HTML element content. */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Render a self-contained, styled callback page.
 * All CSS derives from Spectra token values via inline custom properties.
 * No remote assets, no external fonts — pure CLI/retro-console aesthetic.
 */
export function renderCallbackPage(
	heading: string,
	message: string,
	variant: 'success' | 'error' | 'info' = 'info',
): string {
	const palette = `--bg:${c.bg};--card:${c.bgCard};--border:${c.border};--text:${c.text};--subtext:${c.subtext};--dim:${c.dim};--accent:${c.accent};--glow:${c.accent}20;--success:${c.success};--error:${c.error};--warn:${c.warn}`;
	const statusColor =
		variant === 'success' ? c.success
		: variant === 'error' ? c.error
		: c.accent;
	const statusIcon =
		variant === 'success' ? '\u2713'
		: variant === 'error' ? '\u2717'
		: '\u2022';
	return [
		'<!doctype html>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<title>Spectra</title>',
		'<style>',
		`*{margin:0;padding:0;box-sizing:border-box}`,
		`:root{${palette};--status:${statusColor}}`,
		'body{background:radial-gradient(ellipse at top,var(--glow),transparent 52%),linear-gradient(135deg,var(--bg),var(--card));color:var(--text);font-family:"SF Mono","Cascadia Code","Fira Code",Consolas,"Courier New",monospace;',
		'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}',
		'.card{background:var(--card);border:1px solid var(--border);border-radius:6px;',
		'padding:2rem 2.5rem;max-width:32rem;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.4)}',
		'.status{color:var(--status);font-size:1.5rem;margin-bottom:.5rem}',
		'h1{font-size:1rem;font-weight:600;letter-spacing:.02em;margin-bottom:.75rem}',
		'p{font-size:.85rem;line-height:1.6;color:var(--subtext)}',
		'.divider{border:none;border-top:1px solid var(--border);margin:1rem 0}',
		'.brand{font-size:.7rem;color:var(--dim);letter-spacing:.08em;text-transform:uppercase}',
		'</style>',
		'<div class="card">',
		`<div class="status">${statusIcon}</div>`,
		`<h1>${escapeHtml(heading)}</h1>`,
		'<hr class="divider">',
		`<p>${escapeHtml(message)}</p>`,
		'<hr class="divider">',
		'<div class="brand">Spectra</div>',
		'</div>',
		'</body></html>',
	].join('\n');
}

function startCodexCallbackServer(state: string, signal?: AbortSignal) {
	let resolveCode: (code: string) => void;
	let rejectCode: (error: Error) => void;
	const code = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});
	void code.catch(() => {});
	const server = createServer((request, response) => {
		const callback = new URL(request.url ?? '/', CODEX_REDIRECT_URI);
		if (callback.pathname !== '/auth/callback') {
			response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderCallbackPage('Not found', 'The requested path does not exist.', 'error'));
			return;
		}
		if (callback.searchParams.get('state') !== state) {
			response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderCallbackPage('Invalid state', 'Invalid OAuth state. Return to Spectra and try again.', 'error'));
			return;
		}
		const authorizationCode = callback.searchParams.get('code');
		if (!authorizationCode) {
			const error = callback.searchParams.get('error');
			response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderCallbackPage('Authorization failed', error ? `OpenAI authorization failed: ${error}` : 'Missing authorization code.', 'error'));
			rejectCode(new Error(error ? `OpenAI authorization failed: ${error}` : 'OpenAI callback missing authorization code'));
			return;
		}
		response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderCallbackPage('Authorization complete', 'You can return to Spectra.', 'success'));
		resolveCode(authorizationCode);
	});

	const close = () => new Promise<void>((resolve) => {
		if (!server.listening) {
			resolve();
			return;
		}
		server.close(() => resolve());
	});
	const cancelled = () => {
		rejectCode(new Error('Login cancelled'));
		if (server.listening) void close();
	};
	const listening = new Promise<void>((resolve, reject) => {
		let startupExpired = false;
		const startupTimer = setTimeout(() => {
			startupExpired = true;
			reject(new Error('Timed out starting the OpenAI Codex callback server on localhost:1455.'));
		}, CODEX_CALLBACK_START_TIMEOUT_MS);
		server.once('error', (error: NodeJS.ErrnoException) => {
			clearTimeout(startupTimer);
			if (error.code === 'EADDRINUSE') {
				reject(new Error('OpenAI Codex needs localhost:1455 for its OAuth callback. Another sign-in is still active; cancel it or close the other Codex client, then try again.'));
				return;
			}
			reject(error);
		});
		server.listen(1455, '127.0.0.1', () => {
			clearTimeout(startupTimer);
			if (startupExpired) {
				void close();
				return;
			}
			resolve();
		});
	});
	return {
		listening,
		waitForCode: () => new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('OpenAI authorization timed out')), CODEX_CALLBACK_TIMEOUT_MS);
			code.then(resolve, reject).finally(() => clearTimeout(timer));
		}),
		close: async () => {
			signal?.removeEventListener('abort', cancelled);
			await close();
		},
	};
}

export async function loginCodex(callbacks: ProviderAuthCallbacks): Promise<OauthCredential> {
	if (callbacks.signal?.aborted) throw new Error('Login cancelled');
	const flow = createCodexAuthorizationFlow();
	const callbackServer = startCodexCallbackServer(flow.state, callbacks.signal);
	try {
		await callbackServer.listening;
		if (callbacks.signal?.aborted) throw new Error('Login cancelled');
		callbacks.onAuth({ url: flow.url, instructions: 'Open this URL to authorize Spectra with OpenAI.' });
		callbacks.onProgress('Waiting for OpenAI browser authorization...');
		const code = await callbackServer.waitForCode();
		callbacks.onProgress('Exchanging authorization code for tokens...');
		const exchangeController = new AbortController();
		const cancelExchange = () => exchangeController.abort();
		callbacks.signal?.addEventListener('abort', cancelExchange, { once: true });
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const tokenFetch = fetch(CODEX_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: CODEX_CLIENT_ID,
				code,
				code_verifier: flow.verifier,
				redirect_uri: CODEX_REDIRECT_URI,
			}),
			signal: exchangeController.signal,
		});
		try {
			const tokenResponse = await Promise.race([
				tokenFetch,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						exchangeController.abort();
						reject(new Error('OpenAI token exchange timed out after 15 seconds. Please try again.'));
					}, CODEX_TOKEN_REQUEST_TIMEOUT_MS);
				}),
			]);
			if (!tokenResponse.ok) {
				const detail = await tokenResponse.text().catch(() => '');
				throw new Error(`Codex token exchange failed: ${tokenResponse.status}${detail ? ` ${detail}` : ''}`);
			}
			return codexTokenToCredential(await tokenResponse.json() as TokenResponse);
		} finally {
			if (timeout) clearTimeout(timeout);
			callbacks.signal?.removeEventListener('abort', cancelExchange);
		}
	} finally {
		await callbackServer.close();
	}
}

export async function refreshCodexToken(refreshToken: string, signal?: AbortSignal): Promise<OauthCredential> {
	const response = await fetch(CODEX_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CODEX_CLIENT_ID }),
		signal,
	});
	if (!response.ok) throw new Error(`Codex token refresh failed: ${response.status}`);
	return codexTokenToCredential(await response.json() as TokenResponse, refreshToken);
}
