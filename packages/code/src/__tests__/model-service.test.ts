import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildDiscoveryContext, resolveProviderHeaders } from '../services/model-service.js';
import type { Credential } from '../services/auth-store.js';

// ── buildDiscoveryContext ───────────────────────────────────────────────────

describe('buildDiscoveryContext', () => {
	it('returns undefined for undefined credential', () => {
		expect(buildDiscoveryContext('openai')).toBeUndefined();
	});

	it('returns undefined for well-known credential', () => {
		const cred: Credential = { type: 'wellknown', key: 'k', token: 't' };
		expect(buildDiscoveryContext('ollama', cred)).toBeUndefined();
	});

	it('returns API key from API credential', () => {
		const cred: Credential = { type: 'api', key: 'sk-abc' };
		const ctx = buildDiscoveryContext('anthropic', cred);
		expect(ctx).toEqual({ apiKey: 'sk-abc', headers: {} });
	});

	it('returns Codex access token and account header from OAuth credential', () => {
		const cred: Credential = {
			type: 'oauth',
			refresh: 'r',
			access: 'access-tok',
			expires: Date.now() + 60_000,
			accountId: 'acct-123',
		};
		const ctx = buildDiscoveryContext('openai-codex', cred);
		expect(ctx).toEqual({
			apiKey: 'access-tok',
			headers: { 'ChatGPT-Account-Id': 'acct-123' },
		});
	});
});

// ── resolveProviderHeaders ──────────────────────────────────────────────────

describe('resolveProviderHeaders', () => {
	// ── Local / no-auth providers ──────────────────────────────────────

	it('returns undefined for local provider with no credential', () => {
		expect(resolveProviderHeaders('ollama', undefined)).toBeUndefined();
	});

	it('returns undefined for local provider with well-known credential', () => {
		const cred: Credential = { type: 'wellknown', key: 'ollama-local', token: 't' };
		expect(resolveProviderHeaders('ollama', cred)).toBeUndefined();
	});

	// ── API key providers ──────────────────────────────────────────────

	it('returns Bearer header for API key credential', () => {
		const cred: Credential = { type: 'api', key: 'sk-abc' };
		const headers = resolveProviderHeaders('anthropic', cred);
		expect(headers).toEqual({ Authorization: 'Bearer sk-abc' });
	});

	// ── OAuth providers (generic) ──────────────────────────────────────

	it('returns Bearer header for valid OAuth credential', () => {
		const cred: Credential = {
			type: 'oauth',
			refresh: 'r',
			access: 'tok',
			expires: Date.now() + 60_000,
		};
		const headers = resolveProviderHeaders('anthropic', cred);
		expect(headers).toEqual({ Authorization: 'Bearer tok' });
	});

	it('returns undefined for expired OAuth credential', () => {
		const cred: Credential = {
			type: 'oauth',
			refresh: 'r',
			access: 'tok',
			expires: Date.now() - 1000,
		};
		expect(resolveProviderHeaders('anthropic', cred)).toBeUndefined();
	});

	// ── Codex (openai-codex) ──────────────────────────────────────────

	it('adds ChatGPT-Account-Id for Codex OAuth with accountId', () => {
		const cred: Credential = {
			type: 'oauth',
			refresh: 'r',
			access: 'tok',
			expires: Date.now() + 60_000,
			accountId: 'acct-xyz',
		};
		const headers = resolveProviderHeaders('openai-codex', cred);
		expect(headers).toEqual({
			Authorization: 'Bearer tok',
			'ChatGPT-Account-Id': 'acct-xyz',
		});
	});

	it('does not add ChatGPT-Account-Id when accountId is missing', () => {
		const cred: Credential = {
			type: 'oauth',
			refresh: 'r',
			access: 'tok',
			expires: Date.now() + 60_000,
		};
		const headers = resolveProviderHeaders('openai-codex', cred);
		expect(headers).toEqual({ Authorization: 'Bearer tok' });
		expect(headers!['ChatGPT-Account-Id']).toBeUndefined();
	});

	// ── Snowflake ─────────────────────────────────────────────────────

	it('adds Snowflake OAuth token type header', () => {
		const cred: Credential = {
			type: 'oauth',
			refresh: 'r',
			access: 'sf-tok',
			expires: Date.now() + 60_000,
			accountId: 'myaccount',
		};
		const headers = resolveProviderHeaders('snowflake-cortex', cred);
		expect(headers).toEqual({
			Authorization: 'Bearer sf-tok',
			'X-Snowflake-Authorization-Token-Type': 'OAUTH',
		});
	});

	it('does not add Snowflake header when accountId is missing', () => {
		const cred: Credential = {
			type: 'oauth',
			refresh: 'r',
			access: 'sf-tok',
			expires: Date.now() + 60_000,
		};
		const headers = resolveProviderHeaders('snowflake-cortex', cred);
		expect(headers).toEqual({ Authorization: 'Bearer sf-tok' });
		expect(headers!['X-Snowflake-Authorization-Token-Type']).toBeUndefined();
	});

	// ── GitHub Copilot ────────────────────────────────────────────────

	it('adds Copilot integration headers', () => {
		const cred: Credential = { type: 'api', key: 'gh-key' };
		const headers = resolveProviderHeaders('github-copilot', cred);
		expect(headers).toEqual({
			Authorization: 'Bearer gh-key',
			'Copilot-Integration-Id': 'vscode-chat',
			'Editor-Version': 'vscode/1.109.2',
			'Editor-Plugin-Version': 'copilot-chat/0.37.5',
			'User-Agent': 'GitHubCopilotChat/0.37.5',
			'X-GitHub-Api-Version': '2025-10-01',
			'x-initiator': 'user',
			'Openai-Intent': 'conversation-agent',
		});
	});

	// ── Existing custom headers preserved ──────────────────────────────

	it('merges with existing custom headers', () => {
		const cred: Credential = { type: 'api', key: 'sk' };
		const existing = { 'X-Custom': 'val' };
		const headers = resolveProviderHeaders('anthropic', cred, existing);
		expect(headers).toEqual({
			Authorization: 'Bearer sk',
			'X-Custom': 'val',
		});
	});

	it('preserves custom headers when no auth header is added (local provider)', () => {
		const existing = { 'X-Custom': 'val' };
		const headers = resolveProviderHeaders('ollama', undefined, existing);
		expect(headers).toEqual({ 'X-Custom': 'val' });
	});

	// ── Codex with custom headers ─────────────────────────────────────

	it('merges Codex account header with custom headers', () => {
		const cred: Credential = {
			type: 'oauth',
			refresh: 'r',
			access: 'tok',
			expires: Date.now() + 60_000,
			accountId: 'acct-1',
		};
		const existing = { 'X-Api-Version': '2024-01' };
		const headers = resolveProviderHeaders('openai-codex', cred, existing);
		expect(headers).toEqual({
			Authorization: 'Bearer tok',
			'ChatGPT-Account-Id': 'acct-1',
			'X-Api-Version': '2024-01',
		});
	});
});
