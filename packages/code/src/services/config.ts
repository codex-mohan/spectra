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

/** Config layer an MCP server is persisted to. */
export type McpScope = 'project' | 'global';

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
	ensureParentDir(target);
	writeFileSync(target, JSON.stringify(cfg, null, 2));
}

function ensureParentDir(filePath: string): void {
	const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
	if (separator > 0) mkdirSync(filePath.slice(0, separator), { recursive: true });
}

const MCP_SCOPES: readonly McpScope[] = ['project', 'global'];

/** Path of the single config file backing a scope, independent of what exists on disk. */
export function mcpScopePath(scope: McpScope, cwd: string = process.cwd()): string {
	return scope === 'project' ? join(cwd, '.spectra', 'spectra.json') : join(getGlobalConfigDir(), 'spectra.json');
}

/** Reads one config file in isolation, without merging the global and project layers. */
export function readConfigFile(filePath: string): SpectraConfig {
	if (!existsSync(filePath)) return {};
	try {
		const parsed = safeJsonParse(readFileSync(filePath, 'utf-8'));
		return isRecord(parsed) ? parsed as SpectraConfig : {};
	} catch {
		return {};
	}
}

function writeConfigFile(filePath: string, cfg: SpectraConfig): void {
	ensureParentDir(filePath);
	writeFileSync(filePath, JSON.stringify(cfg, null, 2));
}

/** Locates the scope currently owning an MCP server name. */
export function findMcpScope(name: string, cwd: string = process.cwd()): McpScope | undefined {
	for (const scope of MCP_SCOPES) {
		const servers = readConfigFile(mcpScopePath(scope, cwd)).mcp ?? [];
		if (servers.some((server) => server.name === name)) return scope;
	}
	return undefined;
}

/** Inserts or replaces an MCP server in one scope, leaving every other key untouched. */
export function saveMcpServer(server: McpConfig, scope: McpScope, cwd: string = process.cwd()): void {
	const filePath = mcpScopePath(scope, cwd);
	const cfg = readConfigFile(filePath);
	const servers = [...(cfg.mcp ?? [])];
	const index = servers.findIndex((entry) => entry.name === server.name);
	if (index >= 0) servers[index] = server;
	else servers.push(server);
	cfg.mcp = servers;
	writeConfigFile(filePath, cfg);
}

/** Removes an MCP server from whichever scope defines it. */
export function removeMcpServerConfig(name: string, cwd: string = process.cwd()): McpScope | undefined {
	for (const scope of MCP_SCOPES) {
		const filePath = mcpScopePath(scope, cwd);
		const cfg = readConfigFile(filePath);
		const servers = cfg.mcp ?? [];
		const remaining = servers.filter((server) => server.name !== name);
		if (remaining.length === servers.length) continue;
		cfg.mcp = remaining;
		writeConfigFile(filePath, cfg);
		return scope;
	}
	return undefined;
}

/** Toggles the enabled flag of a server in whichever scope defines it. */
export function setMcpServerEnabled(name: string, enabled: boolean, cwd: string = process.cwd()): boolean {
	for (const scope of MCP_SCOPES) {
		const filePath = mcpScopePath(scope, cwd);
		const cfg = readConfigFile(filePath);
		const servers = cfg.mcp ?? [];
		const index = servers.findIndex((server) => server.name === name);
		if (index < 0) continue;
		servers[index] = { ...servers[index], enabled };
		cfg.mcp = servers;
		writeConfigFile(filePath, cfg);
		return true;
	}
	return false;
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
