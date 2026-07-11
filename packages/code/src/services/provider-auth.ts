import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer } from 'http';
import { scheduler } from 'timers/promises';
import { getGlobalDataDir } from '../utils/paths.js';
import type { OauthCredential } from './auth-store.js';

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
const CODEX_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
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

function startCodexCallbackServer(state: string) {
	let resolveCode: (code: string) => void;
	let rejectCode: (error: Error) => void;
	const code = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});
	const server = createServer((request, response) => {
		const callback = new URL(request.url ?? '/', CODEX_REDIRECT_URI);
		if (callback.pathname !== '/auth/callback') {
			response.writeHead(404).end('Not found');
			return;
		}
		if (callback.searchParams.get('state') !== state) {
			response.writeHead(400).end('Invalid OAuth state. Return to Spectra and try again.');
			return;
		}
		const authorizationCode = callback.searchParams.get('code');
		if (!authorizationCode) {
			const error = callback.searchParams.get('error');
			response.writeHead(400).end(error ? `OpenAI authorization failed: ${error}` : 'Missing authorization code.');
			rejectCode(new Error(error ? `OpenAI authorization failed: ${error}` : 'OpenAI callback missing authorization code'));
			return;
		}
		response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Spectra</title><p>OpenAI authorization completed. You can return to Spectra.</p>');
		resolveCode(authorizationCode);
	});
	const listening = new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(1455, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});
	return {
		listening,
		waitForCode: (signal?: AbortSignal) => new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('OpenAI authorization timed out')), CODEX_CALLBACK_TIMEOUT_MS);
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

export async function loginCodex(callbacks: ProviderAuthCallbacks): Promise<OauthCredential> {
	const flow = createCodexAuthorizationFlow();
	const callbackServer = startCodexCallbackServer(flow.state);
	try {
		await callbackServer.listening;
		callbacks.onAuth({ url: flow.url, instructions: 'Open this URL to authorize Spectra with OpenAI.' });
		callbacks.onProgress('Waiting for OpenAI browser authorization...');
		const code = await callbackServer.waitForCode(callbacks.signal);
		callbacks.onProgress('Exchanging authorization code for tokens...');
		const tokenResponse = await fetch(CODEX_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: CODEX_CLIENT_ID,
				code,
				code_verifier: flow.verifier,
				redirect_uri: CODEX_REDIRECT_URI,
			}),
			signal: callbacks.signal,
		});
		if (!tokenResponse.ok) throw new Error(`Codex token exchange failed: ${tokenResponse.status}`);
		return codexTokenToCredential(await tokenResponse.json() as TokenResponse);
	} finally {
		callbackServer.close();
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
