import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readAll, write } from '../services/auth-store.js';
import { isCredentialConnected } from '../services/provider-connection.js';

const now = 1_700_000_000_000;

describe('isCredentialConnected', () => {
	it('recognizes a non-empty API key', () => {
		expect(isCredentialConnected({ type: 'api', key: 'sk-test' }, undefined, now)).toBe(true);
		expect(isCredentialConnected({ type: 'api', key: '' }, undefined, now)).toBe(false);
	});

	it('recognizes only unexpired OAuth credentials', () => {
		const credential = { type: 'oauth' as const, access: 'access', refresh: 'refresh', expires: now + 1 };
		expect(isCredentialConnected(credential, undefined, now)).toBe(true);
		expect(isCredentialConnected({ ...credential, expires: now }, undefined, now)).toBe(false);
	});

	it('recognizes configured custom-provider API keys', () => {
		expect(isCredentialConnected(undefined, { apiKey: 'custom-key' }, now)).toBe(true);
		expect(isCredentialConnected(undefined, {}, now)).toBe(false);
	});

	it('does not treat unsupported credential types as connected', () => {
		expect(isCredentialConnected({ type: 'wellknown', key: 'key', token: 'token' }, undefined, now)).toBe(false);
	});
});

describe('provider credential persistence', () => {
	let tmpDir: string;
	let previousDataHome: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-provider-test-'));
		previousDataHome = process.env.SPECTRA_HOME;
		process.env.SPECTRA_HOME = tmpDir;
	});

	afterEach(() => {
		if (previousDataHome === undefined) delete process.env.SPECTRA_HOME;
		else process.env.SPECTRA_HOME = previousDataHome;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('reconnecting replaces the credential for the same provider', () => {
		write('openai-codex', { type: 'oauth', access: 'old-access', refresh: 'old-refresh', expires: now + 1 });
		write('openai-codex', { type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: now + 2 });

		expect(readAll()).toEqual({
			'openai-codex': { type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: now + 2 },
		});
	});
});
