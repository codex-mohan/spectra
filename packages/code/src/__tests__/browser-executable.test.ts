import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { browserExecutableError, resolveBrowserExecutable } from '../browser/executable.js';

describe('browser executable resolution', () => {
	it('returns an existing configured path and rejects a missing one', () => {
		const dir = mkdtempSync(join(tmpdir(), 'spectra-browser-exe-'));
		try {
			const file = join(dir, 'chrome.exe');
			writeFileSync(file, '');
			expect(resolveBrowserExecutable({ configuredPath: file })).toBe(file);
			expect(resolveBrowserExecutable({ configuredPath: join(dir, 'missing.exe') })).toBeUndefined();
			expect(browserExecutableError({ configuredPath: join(dir, 'missing.exe') })).toContain('SPECTRA_CHROME_PATH');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
