import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { write } from '../services/auth-store.js';
import { PROVIDER_META } from '../tui/utils/provider-meta.js';
import { createCodexAuthorizationFlow, extractCodexAccountId, loginCodex, renderCallbackPage } from '../services/provider-auth.js';
import { getAuthKey, lookupContextWindow } from '../tui/utils/model-config.js';

describe('provider auth keys', () => {
	let tmpDir: string;
	let previousDataHome: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-auth-test-'));
		previousDataHome = process.env.SPECTRA_HOME;
		process.env.SPECTRA_HOME = tmpDir;
	});

	afterEach(() => {
		if (previousDataHome === undefined) delete process.env.SPECTRA_HOME;
		else process.env.SPECTRA_HOME = previousDataHome;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('returns oauth access tokens while fresh', () => {
		write('kimi-code', {
			type: 'oauth',
			access: 'access-token',
			refresh: 'refresh-token',
			expires: Date.now() + 60_000,
		});

		expect(getAuthKey('kimi-code')).toBe('access-token');
	});

	it('returns local no-auth sentinels for local providers', () => {
		expect(getAuthKey('ollama')).toBe('ollama-local');
		expect(getAuthKey('lm-studio')).toBe('lm-studio-local');
	});
});

describe('OpenCode model metadata', () => {
	it('maps Zen metadata without replacing the dedicated Go catalog', () => {
		expect(lookupContextWindow('deepseek-v4-flash-free', 'opencode-zen')).toBe(200_000);
		expect(lookupContextWindow('glm-5', 'opencode-go')).toBe(202_752);
	});
});

describe('Codex OAuth authorization', () => {
	it('creates the OpenAI PKCE authorization URL', () => {
		const flow = createCodexAuthorizationFlow();
		const url = new URL(flow.url);

		expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
		expect(url.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
		expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
		expect(url.searchParams.get('scope')).toBe('openid profile email offline_access');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('id_token_add_organizations')).toBe('true');
		expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
		expect(url.searchParams.get('originator')).toBe('spectra');
		expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{32}$/);
		expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(flow.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('extracts the ChatGPT account ID from JWT claims without trusting malformed tokens', () => {
		const claims = {
			'https://api.openai.com/auth': { chatgpt_account_id: 'account-123' },
		};
		const jwt = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

		expect(extractCodexAccountId(jwt)).toBe('account-123');
		expect(extractCodexAccountId('not-a-jwt', jwt)).toBe('account-123');
		expect(extractCodexAccountId('header.invalid.signature')).toBeUndefined();
	});

	it('does not start a callback server after cancellation', async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(loginCodex({
			onAuth: () => {},
			onProgress: () => {},
			signal: controller.signal,
		})).rejects.toThrow('Login cancelled');
	});
});

describe('selected OAuth provider metadata', () => {
	it('exposes each OAuth-backed provider in the TUI catalog', () => {
		for (const provider of ['github-copilot', 'xai', 'digitalocean', 'snowflake-cortex']) {
			expect(PROVIDER_META[provider]).toBeDefined();
		}
	});
});

describe('OAuth callback pages', () => {
	it('uses Spectra terminal styling and escapes callback text', () => {
		const page = renderCallbackPage('<failed>', 'Unexpected <script>alert(1)</script>', 'error');

		expect(page).toContain('linear-gradient(135deg,var(--bg),var(--card))');
		expect(page).toContain('"Cascadia Code"');
		expect(page).toContain('--accent:#6EC8D0');
		expect(page).toContain('&lt;failed&gt;');
		expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(page).not.toContain('<script>alert(1)</script>');
	});
});
