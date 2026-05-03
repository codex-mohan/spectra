import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { write } from '../services/auth-store.js';
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
