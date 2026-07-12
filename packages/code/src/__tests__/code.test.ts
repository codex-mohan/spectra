import { describe, it, expect, vi } from 'vitest';
import open from 'open';
import { assertWebUrl, getPlatformInfo, openBrowser } from '../utils/platform.js';
import { getGlobalConfigDir } from '../utils/paths.js';

vi.mock('open', () => ({ default: vi.fn(() => Promise.resolve()) }));

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

describe('browser launching', () => {
	it('accepts HTTP(S) OAuth URLs', () => {
		expect(() => assertWebUrl('https://auth.example.com/oauth/authorize?state=abc')).not.toThrow();
		expect(() => assertWebUrl('http://localhost:1455/auth/callback')).not.toThrow();
	});

	it('delegates browser opening to the cross-platform opener', async () => {
		const url = 'https://auth.example.com/oauth/authorize?state=abc&code_challenge=def';
		await openBrowser(url);
		expect(open).toHaveBeenCalledWith(url);
	});
	it('refuses non-web URLs', () => {
		expect(() => assertWebUrl('file:///sensitive-token')).toThrow('Cannot open non-web URL');
	});
});
