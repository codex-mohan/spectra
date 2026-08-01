import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getGlobalConfigDir, discoverConfigDirs } from '../utils/paths.js';

export interface CustomProviderConfig {
	name: string;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
	models?: Record<string, { name?: string; contextWindow?: number; maxOutput?: number }>;
	enabled?: boolean;
}

import type { PermissionConfig, SecurityConfig } from '../security/types.js';

export interface SpectraConfig {
	model?: string;
	smallModel?: string;
	provider?: string;
	apiKey?: string;
	agent?: string;
	theme?: 'dark' | 'light';
	mcp?: McpConfig[];
	plugins?: PluginConfig[];
	permission?: PermissionConfig;
	security?: SecurityConfig;
	permissions?: PermissionRule[];
	shell?: string;
	logLevel?: 'debug' | 'info' | 'warn' | 'error';
	providers?: Record<string, CustomProviderConfig>;
	memory?: MemoryConfig;
	skills?: SkillsConfig;
	commands?: CommandConfig;
	references?: ProjectReferenceConfig[];
}

export interface ProjectReferenceConfig {
	name: string;
	path: string;
	description?: string;
	enabled?: boolean;
}

export interface MemoryConfig {
	enabled?: boolean;
	projectScope?: boolean;
}

export interface SkillsConfig {
	autoSynthesize?: boolean;
	confirmBeforeSave?: boolean;
}


export interface CommandConfig {
	/** Allow shell interpolation in user and project command templates. */
	shellExecution?: boolean;
}

export interface McpConfig {
	name: string;
	command?: string;
	args?: string[];
	url?: string;
	env?: Record<string, string>;
	headers?: Record<string, string>;
	enabled?: boolean;
	timeout?: number;
}

export interface PluginConfig {
	name: string;
	path?: string;
	enabled?: boolean;
}

export interface PermissionRule {
	name: string;
	pattern: string;
	allow?: boolean;
	timeout?: number;
}

const configFiles = ['spectra.json', 'spectra.jsonc', 'config.json', 'config.jsonc'];
const mergeByNameFields = new Set(['mcp', 'plugins', 'permissions', 'references']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeNamedEntries(target: unknown[], source: unknown[]): unknown[] {
	const result = [...target];
	for (const entry of source) {
		if (!isRecord(entry) || typeof entry.name !== 'string') {
			result.push(entry);
			continue;
		}
		const index = result.findIndex((candidate) => isRecord(candidate) && candidate.name === entry.name);
		if (index === -1) result.push(entry);
		else result[index] = mergeRecords(result[index] as Record<string, unknown>, entry);
	}
	return result;
}

function mergeRecords(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
	const result = { ...target };
	for (const [key, value] of Object.entries(source)) {
		const previous = result[key];
		if (isRecord(previous) && isRecord(value)) {
			result[key] = mergeRecords(previous, value);
		} else if (Array.isArray(previous) && Array.isArray(value) && mergeByNameFields.has(key)) {
			result[key] = mergeNamedEntries(previous, value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

function mergeConfig(target: SpectraConfig, source: unknown): SpectraConfig {
	return isRecord(source) ? mergeRecords(target as Record<string, unknown>, source) as SpectraConfig : target;
}

export function loadConfig(cwd?: string): SpectraConfig {
	let cfg: SpectraConfig = {};
	const projectDir = cwd || process.cwd();

	for (const { path: dirPath } of discoverConfigDirs(projectDir)) {
		for (const name of configFiles) {
			const filePath = join(dirPath, name);
			if (!existsSync(filePath)) continue;
			try {
				cfg = mergeConfig(cfg, safeJsonParse(readFileSync(filePath, 'utf-8')));
			} catch {}
		}
	}

	const envConfig = process.env.SPECTRA_CONFIG;
	if (envConfig) {
		try {
			cfg = mergeConfig(cfg, safeJsonParse(envConfig));
		} catch {}
	}

	const envProvider = process.env.SPECTRA_PROVIDER;
	const envModel = process.env.SPECTRA_MODEL;
	const envKey = process.env.SPECTRA_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

	if (envProvider) cfg.provider = envProvider;
	if (envModel) cfg.model = envModel;
	if (envKey) cfg.apiKey = envKey;

	return cfg;
}

export function saveConfig(cfg: SpectraConfig, filePath?: string): void {
	const target = filePath || join(getGlobalConfigDir(), 'spectra.json');
	const dir = target.substring(
		0,
		target.lastIndexOf('/') > 0
			? Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'))
			: target.lastIndexOf('\\') > 0
				? target.lastIndexOf('\\')
				: 0,
	);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(target, JSON.stringify(cfg, null, 2));
}

export function getEffectiveModel(cfg: SpectraConfig): string {
	return cfg.model || 'anthropic/claude-sonnet-4-20250514';
}

export function getEffectiveProvider(cfg: SpectraConfig): string {
	return cfg.provider || cfg.model?.split('/')[0] || 'anthropic';
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return JSON.parse(
			text
				.replace(/(?<![:"])\/\/.*$/gm, '')
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.trim(),
		);
	}
}
