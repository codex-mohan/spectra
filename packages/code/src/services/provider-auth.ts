import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
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
const CODEX_DEVICE_USERCODE_URL = `${CODEX_OAUTH_HOST}/api/accounts/deviceauth/usercode`;
const CODEX_DEVICE_TOKEN_URL = `${CODEX_OAUTH_HOST}/api/accounts/deviceauth/token`;
const CODEX_DEVICE_AUTH_URL = 'https://auth.openai.com/codex/device';
const CODEX_DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
const CODEX_TOKEN_URL = `${CODEX_OAUTH_HOST}/oauth/token`;
const CODEX_POLL_INTERVAL_MS = 5000;
const CODEX_POLL_SAFETY_MARGIN_MS = 3000;
const CODEX_MAX_POLLS = 120;
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

interface CodexDeviceInitResponse {
	device_auth_id?: string;
	user_code?: string;
	interval?: string | number;
}

interface CodexDevicePollResponse {
	authorization_code?: string;
	code_verifier?: string;
}

export async function loginCodexDevice(callbacks: ProviderAuthCallbacks): Promise<OauthCredential> {
	callbacks.onProgress('Initiating OpenAI Codex device authorization...');
	const initResponse = await fetch(CODEX_DEVICE_USERCODE_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
		signal: callbacks.signal,
	});
	if (!initResponse.ok) throw new Error(`Codex device authorization failed: ${initResponse.status}`);
	const initData = (await initResponse.json()) as CodexDeviceInitResponse;
	if (!initData.device_auth_id || !initData.user_code) {
		throw new Error('Codex device authorization response missing required fields');
	}
	const pollIntervalMs =
		((typeof initData.interval === 'number'
			? initData.interval
			: parseInt(String(initData.interval ?? '5'), 10) || 5) *
			1000) +
		CODEX_POLL_SAFETY_MARGIN_MS;
	callbacks.onAuth({ url: CODEX_DEVICE_AUTH_URL, instructions: `Open this URL and enter code: ${initData.user_code}` });
	callbacks.onProgress(`Waiting for Codex authorization (code: ${initData.user_code})...`);

	for (let poll = 0; poll < CODEX_MAX_POLLS; poll++) {
		await scheduler.wait(poll === 0 ? Math.min(pollIntervalMs, CODEX_POLL_INTERVAL_MS) : pollIntervalMs, { signal: callbacks.signal });
		const pollResponse = await fetch(CODEX_DEVICE_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ device_auth_id: initData.device_auth_id, user_code: initData.user_code }),
			signal: AbortSignal.timeout(CODEX_TOKEN_REQUEST_TIMEOUT_MS),
		});
		if (pollResponse.status === 403 || pollResponse.status === 404) continue;
		if (!pollResponse.ok) throw new Error(`Codex device token polling failed: ${pollResponse.status}`);
		const pollData = (await pollResponse.json()) as CodexDevicePollResponse;
		if (!pollData.authorization_code || !pollData.code_verifier) {
			throw new Error('Codex device token response missing authorization_code or code_verifier');
		}
		callbacks.onProgress('Exchanging authorization code for tokens...');
		const tokenResponse = await fetch(CODEX_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: CODEX_CLIENT_ID,
				code: pollData.authorization_code,
				code_verifier: pollData.code_verifier,
				redirect_uri: CODEX_DEVICE_REDIRECT_URI,
			}),
			signal: AbortSignal.timeout(CODEX_TOKEN_REQUEST_TIMEOUT_MS),
		});
		if (!tokenResponse.ok) throw new Error(`Codex token exchange failed: ${tokenResponse.status}`);
		return codexTokenToCredential(await tokenResponse.json() as TokenResponse, undefined);
	}
	throw new Error('Codex device authorization timed out');
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
