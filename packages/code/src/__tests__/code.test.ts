import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import open from 'open';
import { assertWebUrl, getPlatformInfo, openBrowser, openTarget } from '../utils/platform.js';
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

describe('opening links and paths', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'spectra-open-'));
		vi.mocked(open).mockClear();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	});

	it('opens an existing local file', async () => {
		const file = join(dir, 'note.txt');
		writeFileSync(file, 'hello');
		await openTarget(file);
		expect(open).toHaveBeenCalledWith(file);
	});

	it('opens a file URL through its filesystem path', async () => {
		const file = join(dir, 'note.txt');
		writeFileSync(file, 'hello');
		await openTarget(pathToFileURL(file).toString());
		expect(open).toHaveBeenCalledWith(file);
	});

	it('refuses unknown schemes and missing paths', async () => {
		await expect(openTarget('vscode://file/secret')).rejects.toThrow('Unsupported link scheme');
		await expect(openTarget(join(dir, 'missing.txt'))).rejects.toThrow('Path not found');
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
