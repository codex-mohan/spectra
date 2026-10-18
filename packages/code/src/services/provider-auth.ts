import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { networkInterfaces } from 'os';
import { scheduler } from 'timers/promises';
import { getGlobalDataDir } from '../utils/paths.js';
import type { OauthCredential } from './auth-store.js';
import { c } from '../tui/tokens.js';
import { APP_USER_AGENT, APP_VERSION } from './app-version.js';

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
/** `localhost` resolves to both loopback families; the callback serves both. */
const IPV4_LOOPBACK = '127.0.0.1';
const IPV6_LOOPBACK = '::1';
const CODEX_CALLBACK_PORT = 1455;
const CODEX_PORT_IN_USE_MESSAGE = 'OpenAI Codex needs localhost:1455 for its OAuth callback. Another sign-in is still active; cancel it or close the other Codex client, then try again.';
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
		'User-Agent': APP_USER_AGENT,
		'X-Msh-Platform': 'spectra_code',
		'X-Msh-Version': APP_VERSION,
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
 * Render a self-contained, styled callback page: an animated pixel field over
 * Spectra's palette behind the status card. All CSS/JS derives from Spectra
 * token values inlined at render time. No remote assets, no external fonts —
 * pure CLI/retro-console aesthetic.
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
	// Pixel field palette: the Spectra accent ramp and its cool neighbors.
	const pixelColors = JSON.stringify([c.accent, c.blue, c.purple, c.info, c.thinking]);
	return [
		'<!doctype html>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<title>Spectra</title>',
		'<style>',
		`*{margin:0;padding:0;box-sizing:border-box}`,
		`:root{${palette};--status:${statusColor}}`,
		'body{background:radial-gradient(ellipse at top,var(--glow),transparent 52%),linear-gradient(135deg,var(--bg),var(--card));color:var(--text);font-family:"SF Mono","Cascadia Code","Fira Code",Consolas,"Courier New",monospace;',
		'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;overflow:hidden}',
		'/* pixel layers */',
		'#px{position:fixed;inset:0;width:100%;height:100%;z-index:0}',
		'.grid{position:fixed;inset:0;z-index:1;pointer-events:none;opacity:.35;',
		'background-image:linear-gradient(rgba(110,200,208,.14) 1px,transparent 1px),linear-gradient(90deg,rgba(110,200,208,.14) 1px,transparent 1px);',
		'background-size:24px 24px;animation:grid-drift 36s steps(36) infinite}',
		'@keyframes grid-drift{to{background-position:24px 24px}}',
		'.dither{position:fixed;inset:0;z-index:1;pointer-events:none;opacity:.12;mix-blend-mode:screen;',
		'background-image:conic-gradient(var(--accent) 0 25%,transparent 0 50%,var(--accent) 0 75%,transparent 0);',
		'background-size:8px 8px;animation:dither-shift 2s steps(4) infinite}',
		'@keyframes dither-shift{to{background-position:8px 8px}}',
		'/* card */',
		'.card{position:relative;z-index:2;background:var(--card);border:1px solid var(--border);border-radius:2px;',
		'padding:2rem 2.5rem;max-width:32rem;width:100%;animation:rise .5s ease-out both;',
		'box-shadow:8px 8px 0 0 rgba(0,0,0,.35),0 4px 24px rgba(0,0,0,.4),0 0 48px var(--glow)}',
		'@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
		'.card::before,.card::after{content:"";position:absolute;height:4px;width:56px}',
		'.card::before{left:-1px;top:-1px;background:linear-gradient(90deg,var(--accent),var(--status))}',
		'.card::after{right:-1px;bottom:-1px;background:linear-gradient(90deg,var(--status),var(--accent))}',
		'.status{color:var(--status);font-size:1.5rem;margin-bottom:.5rem}',
		'h1{font-size:1rem;font-weight:600;letter-spacing:.02em;margin-bottom:.75rem}',
		'p{font-size:.85rem;line-height:1.6;color:var(--subtext)}',
		'.divider{border:none;border-top:1px solid var(--border);margin:1rem 0}',
		'.brand{font-size:.7rem;color:var(--dim);letter-spacing:.08em;text-transform:uppercase}',
		'@media (prefers-reduced-motion:reduce){.grid,.dither,.card{animation:none}}',
		'</style>',
		'<canvas id="px" aria-hidden="true"></canvas>',
		'<div class="grid" aria-hidden="true"></div>',
		'<div class="dither" aria-hidden="true"></div>',
		'<div class="card">',
		`<div class="status">${statusIcon}</div>`,
		`<h1>${escapeHtml(heading)}</h1>`,
		'<hr class="divider">',
		`<p>${escapeHtml(message)}</p>`,
		'<hr class="divider">',
		'<div class="brand">Spectra</div>',
		'</div>',
		'<script>',
		// Static script — no user-controlled text is interpolated below.
		'(() => {',
		`const COLORS = ${pixelColors};`,
		'const canvas = document.getElementById("px");',
		'const ctx = canvas.getContext("2d");',
		'const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;',
		'const CELL = 4;',
		'let w = 0, h = 0, cells = [], last = 0;',
		'function seed() {',
		'  const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);',
		'  const count = Math.min(160, Math.round(cols * rows / 24));',
		'  cells = [];',
		'  for (let i = 0; i < count; i++) {',
		'    cells.push({',
		'      x: Math.floor(Math.random() * cols) * CELL,',
		'      y: Math.floor(Math.random() * rows) * CELL,',
		'      size: (2 + Math.floor(Math.random() * 5)) * CELL,',
		'      speed: 3 + Math.random() * 14,',
		'      color: COLORS[Math.floor(Math.random() * COLORS.length)],',
		'      phase: Math.random() * Math.PI * 2,',
		'      alpha: 0.08 + Math.random() * 0.3',
		'    });',
		'  }',
		'}',
		'function resize() {',
		'  const dpr = Math.min(2, window.devicePixelRatio || 1);',
		'  w = window.innerWidth; h = window.innerHeight;',
		'  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);',
		'  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);',
		'  ctx.imageSmoothingEnabled = false;',
		'  seed();',
		'}',
		'function draw(now) {',
		'  ctx.clearRect(0, 0, w, h);',
		'  for (const p of cells) {',
		'    const twinkle = 0.7 + 0.3 * Math.sin(now / 900 + p.phase);',
		'    ctx.globalAlpha = p.alpha * twinkle;',
		'    ctx.fillStyle = p.color;',
		'    ctx.fillRect(Math.round(p.x / CELL) * CELL, Math.round(p.y / CELL) * CELL, p.size, p.size);',
		'  }',
		'  ctx.globalAlpha = 1;',
		'}',
		'function frame(now) {',
		'  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;',
		'  for (const p of cells) { p.y -= p.speed * dt; if (p.y + p.size < 0) p.y = h + p.size; }',
		'  draw(now);',
		'  requestAnimationFrame(frame);',
		'}',
		'resize();',
		'addEventListener("resize", resize);',
		'reduce ? draw(0) : requestAnimationFrame(frame);',
		'})();',
		'</script>',
		'</body></html>',
	].join('\n');
}

/**
 * Whether this host exposes an IPv6 loopback (`::1`) worth binding. With IPv6
 * disabled there is no `::1` to bind, and that failure must not be mistaken
 * for a port collision.
 */
function ipv6LoopbackAvailable(): boolean {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.internal && address.family === 'IPv6') return true;
		}
	}
	return false;
}

/**
 * Start the Codex OAuth callback server.
 *
 * `CODEX_REDIRECT_URI` advertises `localhost`, which resolves to both loopback
 * families and clients commonly try `::1` first. Binding only `127.0.0.1`
 * delivers the authorization code to whatever holds the IPv6 loopback on port
 * 1455 (or drops the connection), while the flow waits out its timeout — so
 * both literals are bound and answer the same routes, and which family the
 * client resolves stops mattering. A genuine collision on either literal fails
 * the flow before the browser opens: the redirect URI is registered with
 * OpenAI and cannot move to another port.
 */
export function startCodexCallbackServer(state: string, signal?: AbortSignal) {
	let resolveCode: (code: string) => void;
	let rejectCode: (error: Error) => void;
	const code = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});
	void code.catch(() => {});
	const handleRequest = (request: IncomingMessage, response: ServerResponse) => {
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
	};
	const servers = [createServer(handleRequest)];
	const close = async () => {
		await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
			if (!server.listening) {
				resolve();
				return;
			}
			// Idle keep-alive sockets (the browser redirect, fetch probes) would
			// hold close() open until their timeout; drop them so the port frees now.
			server.closeIdleConnections?.();
			server.close(() => resolve());
		})));
	};
	const cancelled = () => {
		rejectCode(new Error('Login cancelled'));
		void close();
	};
	signal?.addEventListener('abort', cancelled);
	const listening = new Promise<void>((resolve, reject) => {
		const primary = servers[0]!;
		const onStartupError = (error: NodeJS.ErrnoException) =>
			reject(error.code === 'EADDRINUSE' ? new Error(CODEX_PORT_IN_USE_MESSAGE) : error);
		primary.once('error', onStartupError);
		primary.listen(CODEX_CALLBACK_PORT, IPV4_LOOPBACK, () => {
			primary.removeListener('error', onStartupError);
			// A server without an 'error' handler throws on late server errors.
			primary.on('error', (error: Error) => {
				rejectCode(error);
				void close();
			});
			if (!ipv6LoopbackAvailable()) {
				resolve();
				return;
			}
			const companion = createServer(handleRequest);
			servers.push(companion);
			companion.once('error', (error: NodeJS.ErrnoException) => {
				if (error.code === 'EADDRINUSE') {
					// Another process answers `::1:1455` and would receive the
					// redirect instead of us. Fail before the browser opens.
					reject(new Error(CODEX_PORT_IN_USE_MESSAGE));
					void close();
					return;
				}
				resolve();
			});
			companion.listen(CODEX_CALLBACK_PORT, IPV6_LOOPBACK, () => {
				companion.removeAllListeners('error');
				companion.on('error', (error: Error) => {
					rejectCode(error);
					void close();
				});
				resolve();
			});
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

/**
 * Exchange the authorization code for tokens, retrying once when the request
 * dies at the transport layer (cold DNS/TLS/proxy paths can lose the first
 * exchange from a fresh process). A retry that reached the token endpoint gets
 * a definitive `invalid_grant` instead — same outcome as today, no worse.
 */
async function exchangeCodexCode(verifier: string, code: string, callbacks: ProviderAuthCallbacks): Promise<Response> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (callbacks.signal?.aborted) throw new Error('Login cancelled');
		if (attempt > 0) callbacks.onProgress('Retrying token exchange...');
		const exchangeController = new AbortController();
		const cancelExchange = () => exchangeController.abort();
		callbacks.signal?.addEventListener('abort', cancelExchange, { once: true });
		let timeout: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				fetch(CODEX_TOKEN_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						grant_type: 'authorization_code',
						client_id: CODEX_CLIENT_ID,
						code,
						code_verifier: verifier,
						redirect_uri: CODEX_REDIRECT_URI,
					}),
					signal: exchangeController.signal,
				}),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						exchangeController.abort();
						reject(new Error('OpenAI token exchange timed out after 15 seconds.'));
					}, CODEX_TOKEN_REQUEST_TIMEOUT_MS);
				}),
			]);
		} catch (error) {
			lastError = error;
		} finally {
			clearTimeout(timeout);
			callbacks.signal?.removeEventListener('abort', cancelExchange);
		}
	}
	throw lastError instanceof Error ? lastError : new Error('OpenAI token exchange failed');
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
		const tokenResponse = await exchangeCodexCode(flow.verifier, code, callbacks);
		if (!tokenResponse.ok) {
			const detail = await tokenResponse.text().catch(() => '');
			throw new Error(`Codex token exchange failed: ${tokenResponse.status}${detail ? ` ${detail}` : ''}`);
		}
		return codexTokenToCredential(await tokenResponse.json() as TokenResponse);
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
