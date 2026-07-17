import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig } from '../services/config.js';
import {
	discoverCompatibilityDirs,
	discoverConfigDirs,
	getGlobalCacheDir,
	getGlobalConfigDir,
	getGlobalDataDir,
	getGlobalStateDir,
} from '../utils/paths.js';

let tempDir: string;
const savedEnv: Record<string, string | undefined> = {};
const envKeys = ['SPECTRA_HOME', 'SPECTRA_CONFIG', 'SPECTRA_PROVIDER', 'SPECTRA_MODEL', 'SPECTRA_API_KEY'];

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'spectra-config-'));
	for (const key of envKeys) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of envKeys) {
		const value = savedEnv[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(tempDir, { recursive: true, force: true });
});

function writeJson(filePath: string, value: unknown): void {
	mkdirSync(filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))), { recursive: true });
	writeFileSync(filePath, JSON.stringify(value));
}

describe('Spectra directory policy', () => {
	it('uses one SPECTRA_HOME root for global files', () => {
		const home = join(tempDir, '.spectra');
		process.env.SPECTRA_HOME = home;

		expect(getGlobalConfigDir()).toBe(home);
		expect(getGlobalDataDir()).toBe(home);
		expect(getGlobalCacheDir()).toBe(join(home, 'cache'));
		expect(getGlobalStateDir()).toBe(join(home, 'state'));
	});

	it('keeps foreign compatibility directories out of app config discovery', () => {
		const home = join(tempDir, 'home');
		const project = join(tempDir, 'repo');
		process.env.SPECTRA_HOME = home;
		mkdirSync(home, { recursive: true });
		mkdirSync(join(project, '.spectra'), { recursive: true });
		mkdirSync(join(project, '.claude'), { recursive: true });
		mkdirSync(join(project, '.agents'), { recursive: true });
		mkdirSync(join(project, '.opencode'), { recursive: true });

		const configPaths = discoverConfigDirs(project).map((entry) => entry.path);
		const compatibilityPaths = discoverCompatibilityDirs(project).map((entry) => entry.path);

		expect(configPaths).toEqual([home, join(project, '.spectra')]);
		expect(compatibilityPaths).toContain(join(project, '.claude'));
		expect(compatibilityPaths).toContain(join(project, '.agents'));
		expect(compatibilityPaths).toContain(join(project, '.opencode'));
	});
});

describe('Spectra config precedence', () => {
	it('deep-merges global and project layers with nearest project and environment winning', () => {
		const home = join(tempDir, 'home');
		const project = join(tempDir, 'repo');
		const nested = join(project, 'packages', 'app');
		process.env.SPECTRA_HOME = home;

		writeJson(join(home, 'spectra.json'), {
			model: 'global-model',
			providers: { global: { name: 'Global', baseUrl: 'https://global.test' } },
			mcp: [{ name: 'shared', command: 'global' }],
			references: [
				{ name: 'shared', path: '../global-shared', description: 'global' },
				{ name: 'global', path: '../global-only' },
			],
		});
		writeJson(join(project, '.spectra', 'spectra.json'), {
			providers: { project: { name: 'Project', baseUrl: 'https://project.test' } },
			mcp: [{ name: 'project', command: 'project' }],
			references: [{ name: 'project', path: '../project-reference' }],
		});
		writeJson(join(nested, '.spectra', 'config.jsonc'), {
			model: 'nearest-model',
			mcp: [{ name: 'shared', command: 'nearest' }],
			references: [{ name: 'shared', path: '../nearest-shared', description: 'nearest' }],
		});
		writeJson(join(nested, '.claude', 'spectra.json'), { model: 'foreign-model' });
		process.env.SPECTRA_CONFIG = JSON.stringify({ provider: 'env-content-provider' });
		process.env.SPECTRA_MODEL = 'env-model';

		const config = loadConfig(nested);

		expect(config.model).toBe('env-model');
		expect(config.provider).toBe('env-content-provider');
		expect(Object.keys(config.providers ?? {})).toEqual(['global', 'project']);
		expect(config.mcp).toEqual([
			{ name: 'shared', command: 'nearest' },
			{ name: 'project', command: 'project' },
		]);
		expect(config.references).toEqual([
			{ name: 'shared', path: '../nearest-shared', description: 'nearest' },
			{ name: 'global', path: '../global-only' },
			{ name: 'project', path: '../project-reference' },
		]);
	});
});
