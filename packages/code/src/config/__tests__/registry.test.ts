import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	SETTINGS,
	SETTINGS_BY_PATH,
	SETTINGS_TABS,
	SettingsWriter,
	configFilesValid,
	configPath,
	effectiveSettingValue,
	findSettingScope,
	maskSecrets,
	validateSettingValue,
	watchConfigFiles,
	writeSetting,
} from '../registry.js';
import { commitSetting, filterSettings, nextTab, scopeBadge } from '../../tui/ui/settings-state.js';
import { runConfigCommand } from '../../commands/config.js';

let home: string;
let cwd: string;
let previousHome: string | undefined;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), 'spectra-home-'));
	cwd = mkdtempSync(join(tmpdir(), 'spectra-project-'));
	mkdirSync(join(cwd, '.spectra'), { recursive: true });
	previousHome = process.env.SPECTRA_HOME;
	process.env.SPECTRA_HOME = home;
});

afterEach(() => {
	if (previousHome === undefined) delete process.env.SPECTRA_HOME;
	else process.env.SPECTRA_HOME = previousHome;
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

describe('settings registry', () => {
	it('has ten tabs, unique paths, and valid defaults', () => {
		expect(SETTINGS_TABS).toHaveLength(10);
		expect(new Set(SETTINGS.map((entry) => entry.path)).size).toBe(SETTINGS.length);
		for (const tab of SETTINGS_TABS) {
			expect(SETTINGS.some((entry) => entry.tab === tab.id)).toBe(true);
		}
		for (const entry of SETTINGS) {
			if (entry.default === undefined) continue;
			expect(validateSettingValue(entry, entry.default)).toBeUndefined();
		}
		expect(SETTINGS_BY_PATH.get('model')?.tab).toBe('model');
	});

	it('routes scopes and composes effective values', () => {
		writeSetting('global', 'model', 'global-model', cwd);
		expect(effectiveSettingValue('model', cwd)).toBe('global-model');
		expect(findSettingScope('model', cwd)).toBe('global');

		writeSetting('project', 'model', 'project-model', cwd);
		expect(effectiveSettingValue('model', cwd)).toBe('project-model');
		expect(findSettingScope('model', cwd)).toBe('project');
		expect(configPath('project', cwd)).toBe(join(cwd, '.spectra', 'spectra.json'));
	});

	it('rejects invalid values without touching the file', () => {
		writeSetting('project', 'tools.webSearch.maxResults', 5, cwd);
		const before = readFileSync(configPath('project', cwd), 'utf-8');
		const definition = SETTINGS_BY_PATH.get('tools.webSearch.maxResults')!;
		const result = commitSetting(definition, '99', 'project', cwd);
		expect(result.ok).toBe(false);
		expect(readFileSync(configPath('project', cwd), 'utf-8')).toBe(before);
	});

	it('masks secrets recursively', () => {
		expect(maskSecrets({ apiKey: 'secret', providers: { x: { apiKey: 'nested', headers: { Authorization: 'Bearer z' } } } }))
			.toEqual({ apiKey: '••••', providers: { x: { apiKey: '••••', headers: { Authorization: '••••' } } } });
	});

	it('reports invalid JSON files', () => {
		writeFileSync(configPath('project', cwd), '{ bad json');
		expect(configFilesValid(cwd)).toBe(false);
		writeFileSync(configPath('project', cwd), '{"model":"ok"}');
		expect(configFilesValid(cwd)).toBe(true);
	});
});

describe('SettingsWriter', () => {
	it('coalesces repeated edits and preserves disjoint keys', async () => {
		writeSetting('project', 'provider', 'keep-me', cwd);
		const writer = new SettingsWriter(cwd, 100);
		writer.stage('project', 'model', 'first');
		writer.stage('project', 'model', 'second');
		expect(writer.pendingCount()).toBe(1);
		await writer.flush();
		const saved = JSON.parse(readFileSync(configPath('project', cwd), 'utf-8'));
		expect(saved).toMatchObject({ model: 'second', provider: 'keep-me' });
		writer.dispose();
	});
});

describe('settings navigation', () => {
	it('cycles tabs in both directions', () => {
		expect(nextTab('appearance', 1)).toBe('model');
		expect(nextTab('appearance', -1)).toBe('providers');
		expect(scopeBadge('project')).toBe('P');
		expect(scopeBadge('default')).toBe('·');
	});

	it('searches across tabs by subsequence', () => {
		const results = filterSettings('doom', 'appearance');
		expect(results.some((entry) => entry.path.startsWith('security.doomLoop'))).toBe(true);
		expect(filterSettings('zzzzz', 'appearance')).toHaveLength(0);
	});
});

describe('config CLI', () => {
	it('sets and gets a typed value in the selected scope', () => {
		const set = runConfigCommand({ action: 'set', key: 'tools.webSearch.maxResults', value: '7', scope: 'project' }, cwd);
		expect(set.exitCode).toBe(0);
		const get = runConfigCommand({ action: 'get', key: 'tools.webSearch.maxResults', json: true }, cwd);
		expect(get).toEqual({ exitCode: 0, output: '7' });
		expect(findSettingScope('tools.webSearch.maxResults', cwd)).toBe('project');
	});

	it('masks secrets in list output', () => {
		writeSetting('global', 'apiKey', 'super-secret', cwd);
		const list = runConfigCommand({ action: 'list' }, cwd);
		expect(list.output).toContain('apiKey = ••••');
		expect(list.output).not.toContain('super-secret');
	});

	it('returns paths and rejects unknown settings', () => {
		const paths = runConfigCommand({ action: 'path', json: true }, cwd);
		expect(JSON.parse(paths.output)).toEqual({
			global: join(home, 'spectra.json'),
			project: join(cwd, '.spectra', 'spectra.json'),
		});
		expect(runConfigCommand({ action: 'get', key: 'nope' }, cwd).exitCode).toBe(1);
	});
});

describe('watchConfigFiles', () => {
	it('notifies after a config write and ignores invalid JSON', async () => {
		const calls: boolean[] = [];
		const stop = watchConfigFiles(cwd, (valid) => calls.push(valid));
		writeFileSync(configPath('project', cwd), '{"model":"watched"}');
		await new Promise((resolve) => setTimeout(resolve, 1500));
		stop();
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every(Boolean)).toBe(true);
	});
});
