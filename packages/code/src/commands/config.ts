import { loadConfig, type SpectraConfig } from '../services/config.js';
import {
	SETTINGS,
	SETTINGS_BY_PATH,
	configPath,
	effectiveSettingValue,
	findSettingScope,
	formatSettingValue,
	getPathValue,
	isSettingPath,
	maskSecrets,
	parseSettingValue,
	validateSettingValue,
	writeSetting,
	type SettingPath,
	type SettingScope,
} from '../config/registry.js';

export interface ConfigCommandOptions {
	action: 'list' | 'get' | 'set' | 'reset' | 'path';
	key?: string;
	value?: string;
	scope?: string;
	json?: boolean;
}

export interface ConfigCommandResult {
	exitCode: number;
	output: string;
}

function resolveScope(value: string | undefined): SettingScope | undefined {
	if (value === undefined || value === '') return undefined;
	if (value === 'global' || value === 'project') return value;
	return undefined;
}

function flatten(value: unknown, prefix = '', output: Record<string, unknown> = {}): Record<string, unknown> {
	if (value === null || typeof value !== 'object') {
		if (prefix) output[prefix] = value;
		return output;
	}
	if (Array.isArray(value)) {
		output[prefix] = value;
		return output;
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		flatten(child, prefix ? `${prefix}.${key}` : key, output);
	}
	return output;
}

function resolveValue(key: string, cwd: string): unknown {
	if (isSettingPath(key)) return effectiveSettingValue(key, cwd);
	return getPathValue(loadConfig(cwd), key);
}

export function runConfigCommand(options: ConfigCommandOptions, cwd: string = process.cwd()): ConfigCommandResult {
	const scope = resolveScope(options.scope);
	if (options.scope !== undefined && options.scope !== '' && scope === undefined) {
		return { exitCode: 1, output: `Unknown scope "${options.scope}". Use global or project.` };
	}
	const defaultScope: SettingScope = 'global';

	if (options.action === 'path') {
		const paths = { global: configPath('global', cwd), project: configPath('project', cwd) };
		return {
			exitCode: 0,
			output: options.json ? JSON.stringify(paths, null, 2) : `global  ${paths.global}\nproject ${paths.project}`,
		};
	}

	if (options.action === 'list') {
		if (options.json) {
			return { exitCode: 0, output: JSON.stringify(maskSecrets(loadConfig(cwd)), null, 2) };
		}
		const lines: string[] = [];
		for (const definition of SETTINGS) {
			const value = effectiveSettingValue(definition.path, cwd);
			const owner = findSettingScope(definition.path, cwd);
			const display = definition.secret && value !== undefined ? '••••' : formatSettingValue(value);
			lines.push(`${definition.path} = ${display}  [${owner}]`);
		}
		return { exitCode: 0, output: lines.join('\n') };
	}

	if (!options.key) return { exitCode: 1, output: `config ${options.action} requires a key` };
	const key = options.key;
	if (!isSettingPath(key)) return { exitCode: 1, output: `Unknown setting "${key}". Run "spectra config list".` };
	const definition = SETTINGS_BY_PATH.get(key)!;

	if (options.action === 'get') {
		const value = resolveValue(key, cwd);
		if (options.json) return { exitCode: 0, output: JSON.stringify(value ?? null, null, 2) };
		return { exitCode: 0, output: formatSettingValue(value) };
	}

	if (options.action === 'set') {
		if (options.value === undefined) return { exitCode: 1, output: `config set ${key} requires a value` };
		let value: unknown;
		try {
			value = parseSettingValue(definition, options.value);
		} catch (error) {
			return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
		}
		const invalid = validateSettingValue(definition, value);
		if (invalid) return { exitCode: 1, output: `${key}: ${invalid}` };
		writeSetting(scope ?? defaultScope, key as SettingPath, value, cwd);
		return {
			exitCode: 0,
			output: options.json
				? JSON.stringify({ key, value, scope: scope ?? defaultScope }, null, 2)
				: `Set ${key} = ${formatSettingValue(value)} (${scope ?? defaultScope})`,
		};
	}

	writeSetting(scope ?? defaultScope, key as SettingPath, undefined, cwd);
	return {
		exitCode: 0,
		output: options.json
			? JSON.stringify({ key, reset: true, scope: scope ?? defaultScope }, null, 2)
			: `Reset ${key} in ${scope ?? defaultScope}`,
	};
}

/** Flattened effective config, used by doctor and tests. */
export function flattenConfig(config: SpectraConfig): Record<string, unknown> {
	return flatten(config);
}
