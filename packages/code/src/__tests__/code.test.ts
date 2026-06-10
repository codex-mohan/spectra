import { describe, it, expect } from 'vitest';
import { getPlatformInfo } from '../utils/platform.js';
import { getGlobalConfigDir } from '../utils/paths.js';

describe('spectra-code utilities', () => {
	it('detects platform', () => {
		const info = getPlatformInfo();
		expect(info.os).toBeDefined();
		expect(info.arch).toBeDefined();
		expect(info.shell).toBeDefined();
		expect(info.homeDir).toBeDefined();
	});

	it('resolves config directory', () => {
		const dir = getGlobalConfigDir();
		expect(dir).toBeTruthy();
		expect(typeof dir).toBe('string');
	});
});
