import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getProviderReadiness, runDoctor } from '../commands/doctor.js';

const now = 1_700_000_000_000;

describe('getProviderReadiness', () => {
	it('recognizes stored API and unexpired OAuth credentials', () => {
		expect(getProviderReadiness(
			{ model: 'claude', provider: 'anthropic' },
			{ anthropic: { type: 'api', key: 'secret' } },
			now,
			{},
		).credentialConnected).toBe(true);
		expect(getProviderReadiness(
			{ model: 'codex', provider: 'openai-codex' },
			{ 'openai-codex': { type: 'oauth', access: 'access', refresh: 'refresh', expires: now + 1 } },
			now,
			{},
		).credentialConnected).toBe(true);
		expect(getProviderReadiness(
			{ model: 'codex', provider: 'openai-codex' },
			{ 'openai-codex': { type: 'oauth', access: 'access', refresh: 'refresh', expires: now } },
			now,
			{},
		).credentialConnected).toBe(false);
	});

	it('recognizes custom-provider keys and local no-auth providers', () => {
		expect(getProviderReadiness(
			{
				model: 'custom-model',
				provider: 'custom',
				providers: { custom: { name: 'Custom', baseUrl: 'https://example.com', apiKey: 'secret' } },
			},
			{},
			now,
			{},
		).credentialConnected).toBe(true);
		expect(getProviderReadiness(
			{ model: 'llama', provider: 'ollama' },
			{},
			now,
			{},
		).credentialConnected).toBe(true);
	});

	it('recognizes provider environment keys and registry aliases', () => {
		expect(getProviderReadiness(
			{ model: 'gpt', provider: 'openai-responses' },
			{},
			now,
			{ OPENAI_API_KEY: 'secret' },
		).credentialConnected).toBe(true);
		expect(getProviderReadiness(
			{ model: 'claude', provider: 'anthropic' },
			{},
			now,
			{ OPENAI_API_KEY: 'wrong-provider' },
		).credentialConnected).toBe(false);
	});

	it('does not expose a legacy top-level config key as a connected runtime credential', () => {
		expect(getProviderReadiness(
			{ model: 'claude', provider: 'anthropic', apiKey: 'not-wired-to-runtime' },
			{},
			now,
			{},
		).credentialConnected).toBe(false);
	});
});

describe('runDoctor', () => {
	let spectraHome: string;
	let previousSpectraHome: string | undefined;

	beforeEach(() => {
		spectraHome = mkdtempSync(join(tmpdir(), 'spectra-doctor-test-'));
		previousSpectraHome = process.env.SPECTRA_HOME;
		process.env.SPECTRA_HOME = spectraHome;
	});

	afterEach(() => {
		if (previousSpectraHome === undefined) delete process.env.SPECTRA_HOME;
		else process.env.SPECTRA_HOME = previousSpectraHome;
		rmSync(spectraHome, { recursive: true, force: true });
	});

	it('uses severity for overall health and omits the unused fd check', async () => {
		const result = await runDoctor();
		expect(result.checks.some((check) => check.name === 'fd')).toBe(false);
		expect(result.allPassed).toBe(!result.checks.some((check) => check.status === 'error'));
		expect(result.hasWarnings).toBe(result.checks.some((check) => check.status === 'warning'));
		expect(result.checks.find((check) => check.name === 'Configuration')?.status).toBe('pass');
		expect(result.checks.find((check) => check.name === 'ripgrep')?.detail).not.toContain('faster');
	});

	it('does not create lazy cache directories during diagnostics', async () => {
		const cacheDir = join(spectraHome, 'cache');
		expect(existsSync(cacheDir)).toBe(false);
		const result = await runDoctor();
		expect(existsSync(cacheDir)).toBe(false);
		expect(result.checks.find((check) => check.name === 'Cache dir')).toMatchObject({
			status: 'pass',
			detail: expect.stringContaining('created on first use'),
		});
	});
});
