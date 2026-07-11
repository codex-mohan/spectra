import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { write } from '../services/auth-store.js';
import { PROVIDER_META } from '../tui/utils/provider-meta.js';
import { createCodexAuthorizationFlow } from '../services/provider-auth.js';
import { getAuthKey } from '../tui/utils/model-config.js';

describe('provider auth keys', () => {
	let tmpDir: string;
	let previousDataHome: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-auth-test-'));
		previousDataHome = process.env.XDG_DATA_HOME;
		process.env.XDG_DATA_HOME = tmpDir;
	});

	afterEach(() => {
		if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
		else process.env.XDG_DATA_HOME = previousDataHome;
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
});

describe('selected OAuth provider metadata', () => {
	it('exposes each OAuth-backed provider in the TUI catalog', () => {
		for (const provider of ['github-copilot', 'xai', 'digitalocean', 'snowflake-cortex']) {
			expect(PROVIDER_META[provider]).toBeDefined();
		}
	});
});
