import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync, renameSync, watch, type FSWatcher } from 'fs';
import { dirname, join } from 'path';
import { getGlobalConfigDir } from '../utils/paths.js';
import type { SpectraConfig } from '../services/config.js';

export type SettingsTab =
	| 'appearance'
	| 'model'
	| 'interaction'
	| 'context'
	| 'memory'
	| 'files'
	| 'shell'
	| 'tools'
	| 'tasks'
	| 'providers';

export type SettingType = 'string' | 'number' | 'boolean' | 'enum' | 'json';
export type SettingScope = 'global' | 'project';

type JoinPath<K extends string, P extends string> = K extends '' ? P : `${K}.${P}`;
type DotPaths<T, Prefix extends string = ''> = {
	[K in keyof T & string]:
		| JoinPath<Prefix, K>
		| (NonNullable<T[K]> extends readonly unknown[]
			? never
			: NonNullable<T[K]> extends object
				? DotPaths<NonNullable<T[K]>, JoinPath<Prefix, K>>
				: never);
}[keyof T & string];

/** Every registry path is checked against SpectraConfig at compile time. */
export type SettingPath = DotPaths<Required<SpectraConfig>>;

export interface SettingDefinition {
	path: SettingPath;
	type: SettingType;
	tab: SettingsTab;
	section: string;
	label: string;
	description: string;
	default?: unknown;
	options?: readonly string[];
	secret?: boolean;
	restart?: boolean;
	validate?: (value: unknown) => string | undefined;
}

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
	{ id: 'appearance', label: 'Appearance' },
	{ id: 'model', label: 'Model' },
	{ id: 'interaction', label: 'Interaction' },
	{ id: 'context', label: 'Context' },
	{ id: 'memory', label: 'Memory' },
	{ id: 'files', label: 'Files' },
	{ id: 'shell', label: 'Shell' },
	{ id: 'tools', label: 'Tools' },
	{ id: 'tasks', label: 'Tasks' },
	{ id: 'providers', label: 'Providers' },
];

const accessModeOptions = ['always-ask', 'write', 'yolo'] as const;
const approvalOptions = ['allow', 'deny', 'prompt'] as const;
const logLevelOptions = ['debug', 'info', 'warn', 'error'] as const;
const themeOptions = ['dark', 'light'] as const;

export const SETTINGS: readonly SettingDefinition[] = [
	{
		path: 'theme',
		type: 'enum',
		tab: 'appearance',
		section: 'Interface',
		label: 'Theme',
		description: 'Color theme used by the TUI',
		default: 'dark',
		options: themeOptions,
	},
	{
		path: 'logLevel',
		type: 'enum',
		tab: 'appearance',
		section: 'Diagnostics',
		label: 'Log level',
		description: 'Log verbosity written by the CLI and services',
		default: 'info',
		options: logLevelOptions,
	},
	{
		path: 'model',
		type: 'string',
		tab: 'model',
		section: 'Selection',
		label: 'Model',
		description: 'Default model id',
	},
	{
		path: 'smallModel',
		type: 'string',
		tab: 'model',
		section: 'Selection',
		label: 'Small model',
		description: 'Model used for titles and small background calls',
	},
	{
		path: 'provider',
		type: 'string',
		tab: 'model',
		section: 'Selection',
		label: 'Provider',
		description: 'Default provider id',
	},
	{
		path: 'apiKey',
		type: 'string',
		tab: 'model',
		section: 'Credentials',
		label: 'API key',
		description: 'API key for the selected provider (prefer auth login or env vars)',
		secret: true,
	},
	{
		path: 'agent',
		type: 'string',
		tab: 'interaction',
		section: 'Agent',
		label: 'Default agent',
		description: 'Agent definition used for new sessions',
		default: 'build',
	},
	{
		path: 'tools.approvalMode',
		type: 'enum',
		tab: 'interaction',
		section: 'Approval',
		label: 'Approval mode',
		description: 'Default approval policy for tool calls',
		default: 'write',
		options: accessModeOptions,
	},
	{
		path: 'tools.approval',
		type: 'json',
		tab: 'interaction',
		section: 'Approval',
		label: 'Per-tool approval',
		description: 'Map of tool name to allow/deny/prompt',
	},
	{
		path: 'permissions',
		type: 'json',
		tab: 'interaction',
		section: 'Rules',
		label: 'Permission rules',
		description: 'Named permission rules',
	},
	{
		path: 'permission',
		type: 'json',
		tab: 'interaction',
		section: 'Rules',
		label: 'Permission policy',
		description: 'Per-permission allow/ask/deny policy',
	},
	{
		path: 'safety.repetition',
		type: 'json',
		tab: 'context',
		section: 'Guards',
		label: 'Repetition guard',
		description: 'true, false, "warn", or { enabled, minRepeats, minUnitChars }',
		default: true,
	},
	{
		path: 'safety.outputBloat.warnBytes',
		type: 'number',
		tab: 'context',
		section: 'Guards',
		label: 'Output warning bytes',
		description: 'Emit a warning when a tool result reaches this many bytes',
		default: 50000,
	},
	{
		path: 'safety.outputBloat.truncateBytes',
		type: 'number',
		tab: 'context',
		section: 'Guards',
		label: 'Output truncate bytes',
		description: 'Spill and trim tool results above this many bytes; 0 disables',
		default: 200000,
	},
	{
		path: 'memory.enabled',
		type: 'boolean',
		tab: 'memory',
		section: 'Memory',
		label: 'Enabled',
		description: 'Enable project memory',
		default: true,
	},
	{
		path: 'memory.projectScope',
		type: 'boolean',
		tab: 'memory',
		section: 'Memory',
		label: 'Project scope',
		description: 'Store memory per project instead of globally',
		default: true,
	},
	{
		path: 'skills.autoSynthesize',
		type: 'boolean',
		tab: 'memory',
		section: 'Skills',
		label: 'Auto synthesize',
		description: 'Deprecated: skill proposals are explicit',
		default: false,
	},
	{
		path: 'skills.confirmBeforeSave',
		type: 'boolean',
		tab: 'memory',
		section: 'Skills',
		label: 'Confirm before save',
		description: 'Deprecated: review is always required',
		default: true,
	},
	{
		path: 'security.writeGuard',
		type: 'enum',
		tab: 'files',
		section: 'Write guard',
		label: 'Write guard',
		description: 'Require a prior read before editing a file',
		default: 'soft',
		options: ['soft', 'strict', 'off'],
	},
	{
		path: 'security.writeGuardExclude',
		type: 'json',
		tab: 'files',
		section: 'Write guard',
		label: 'Write guard excludes',
		description: 'Glob patterns exempt from the write guard',
	},
	{
		path: 'security.blockedPaths',
		type: 'json',
		tab: 'files',
		section: 'Paths',
		label: 'Blocked paths',
		description: 'Paths that tools may never read or write',
	},
	{
		path: 'security.allowedPaths',
		type: 'json',
		tab: 'files',
		section: 'Paths',
		label: 'Allowed paths',
		description: 'Paths outside the workspace that tools may access',
	},
	{
		path: 'references',
		type: 'json',
		tab: 'files',
		section: 'References',
		label: 'Project references',
		description: 'Named reference files injected into context',
	},
	{
		path: 'shell',
		type: 'string',
		tab: 'shell',
		section: 'Shell',
		label: 'Shell',
		description: 'Shell executable used by the shell tool',
	},
	{
		path: 'commands.shellExecution',
		type: 'boolean',
		tab: 'shell',
		section: 'Commands',
		label: 'Command shell execution',
		description: 'Allow shell interpolation in command templates',
		default: false,
	},
	{
		path: 'tools.webSearch.providers',
		type: 'json',
		tab: 'tools',
		section: 'Web search',
		label: 'Search providers',
		description: 'Provider order, e.g. ["brave", "tavily"]',
	},
	{
		path: 'tools.webSearch.maxResults',
		type: 'number',
		tab: 'tools',
		section: 'Web search',
		label: 'Max results',
		description: 'Results per web search (1-10)',
		default: 5,
		validate: (value) => (typeof value === 'number' && value >= 1 && value <= 10 ? undefined : 'must be between 1 and 10'),
	},
	{
		path: 'tools.webSearch.timeoutMs',
		type: 'number',
		tab: 'tools',
		section: 'Web search',
		label: 'Search timeout',
		description: 'Per-provider timeout in milliseconds',
		default: 60000,
	},
	{
		path: 'tools.lsp.enabled',
		type: 'boolean',
		tab: 'tools',
		section: 'LSP',
		label: 'LSP enabled',
		description: 'Enable language server integration',
		default: true,
	},
	{
		path: 'tools.lsp.requestTimeout',
		type: 'number',
		tab: 'tools',
		section: 'LSP',
		label: 'Request timeout',
		description: 'Milliseconds per LSP request',
		default: 20000,
	},
	{
		path: 'tools.lsp.diagnosticsOnWrite',
		type: 'boolean',
		tab: 'tools',
		section: 'LSP',
		label: 'Diagnostics on write',
		description: 'Append diagnostics to write/edit results',
		default: true,
	},
	{
		path: 'tools.lsp.shared',
		type: 'boolean',
		tab: 'tools',
		section: 'LSP',
		label: 'Shared servers',
		description: 'Share servers through the project mux daemon',
		default: true,
	},
	{
		path: 'tools.lsp.formatOnWrite',
		type: 'boolean',
		tab: 'tools',
		section: 'LSP',
		label: 'Format on write',
		description: 'Format files through LSP on write',
		default: false,
	},
	{
		path: 'tools.lsp',
		type: 'json',
		tab: 'tools',
		section: 'LSP',
		label: 'LSP config',
		description: 'Full LSP settings including servers, linters, and workspace settings',
	},
	{
		path: 'security.ssrf',
		type: 'json',
		tab: 'tools',
		section: 'Network',
		label: 'SSRF policy',
		description: 'Private/loopback blocking, allowed hosts, redirects',
	},
	{
		path: 'security.doomLoop.writeRepeatThreshold',
		type: 'number',
		tab: 'tools',
		section: 'Loop guard',
		label: 'Identical-call threshold',
		description: 'Block/ask after this many identical tool calls',
		default: 5,
	},
	{
		path: 'security.doomLoop.readOnlyRepeatThreshold',
		type: 'number',
		tab: 'tools',
		section: 'Loop guard',
		label: 'Read-only warning threshold',
		description: 'Warn after this many consecutive non-mutating results',
		default: 8,
	},
	{
		path: 'security.doomLoop.patchSpiralThreshold',
		type: 'number',
		tab: 'tools',
		section: 'Loop guard',
		label: 'Patch spiral threshold',
		description: 'Warn after this many failed edits on one file',
		default: 4,
	},
	{
		path: 'security.doomLoop.ask',
		type: 'boolean',
		tab: 'tools',
		section: 'Loop guard',
		label: 'Ask on identical calls',
		description: 'Prompt before continuing an identical-call loop instead of blocking',
		default: false,
	},
	{
		path: 'tasks.autoBackground.onUserMessage',
		type: 'boolean',
		tab: 'tasks',
		section: 'Background',
		label: 'Promote on message',
		description: 'Promote a running foreground tool when the user sends a message',
		default: true,
	},
	{
		path: 'tasks.autoBackground.afterMs',
		type: 'number',
		tab: 'tasks',
		section: 'Background',
		label: 'Promote after ms',
		description: 'Automatic promotion delay; 0 disables',
		default: 0,
	},
	{
		path: 'tasks.autoBackground.outputThresholdBytes',
		type: 'number',
		tab: 'tasks',
		section: 'Background',
		label: 'Promote output bytes',
		description: 'Promote after this much tool output; 0 disables',
		default: 0,
	},
	{
		path: 'tasks.maxConcurrency',
		type: 'number',
		tab: 'tasks',
		section: 'Subagents',
		label: 'Max concurrency',
		description: 'Parallel task fan-out limit (1-16)',
		default: 4,
		validate: (value) => (typeof value === 'number' && value >= 1 && value <= 16 ? undefined : 'must be between 1 and 16'),
	},
	{
		path: 'tasks.maxRuntimeMs',
		type: 'number',
		tab: 'tasks',
		section: 'Subagents',
		label: 'Max runtime ms',
		description: 'Wall-clock cap for a task child; 0 disables',
		default: 0,
	},
	{
		path: 'providers',
		type: 'json',
		tab: 'providers',
		section: 'Providers',
		label: 'Custom providers',
		description: 'Provider definitions including baseUrl, models, and headers',
	},
	{
		path: 'mcp',
		type: 'json',
		tab: 'providers',
		section: 'MCP',
		label: 'MCP servers',
		description: 'Server definitions (also manageable from /mcp)',
		restart: true,
	},
	{
		path: 'plugins',
		type: 'json',
		tab: 'providers',
		section: 'Plugins',
		label: 'Plugins',
		description: 'Plugin registrations',
		restart: true,
	},
];

export const SETTINGS_BY_PATH = new Map(SETTINGS.map((entry) => [entry.path, entry]));

export function isSettingPath(path: string): path is SettingPath {
	return SETTINGS_BY_PATH.has(path as SettingPath);
}

export function settingsForTab(tab: SettingsTab): SettingDefinition[] {
	return SETTINGS.filter((entry) => entry.tab === tab);
}

export function sectionsForTab(tab: SettingsTab): string[] {
	const seen: string[] = [];
	for (const entry of settingsForTab(tab)) {
		if (!seen.includes(entry.section)) seen.push(entry.section);
	}
	return seen;
}

export function configPath(scope: SettingScope, cwd: string = process.cwd()): string {
	return scope === 'project'
		? join(cwd, '.spectra', 'spectra.json')
		: join(getGlobalConfigDir(), 'spectra.json');
}

export function tryReadScopeFile(scope: SettingScope, cwd: string = process.cwd()): { config: SpectraConfig; valid: boolean } {
	const filePath = configPath(scope, cwd);
	if (!existsSync(filePath)) return { config: {}, valid: true };
	try {
		const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { config: {}, valid: false };
		return { config: parsed as SpectraConfig, valid: true };
	} catch {
		return { config: {}, valid: false };
	}
}

export function readScopeFile(scope: SettingScope, cwd: string = process.cwd()): SpectraConfig {
	return tryReadScopeFile(scope, cwd).config;
}

/** True when both existing scope files parse cleanly. */
export function configFilesValid(cwd: string = process.cwd()): boolean {
	return tryReadScopeFile('global', cwd).valid && tryReadScopeFile('project', cwd).valid;
}

export function getPathValue(config: unknown, path: string): unknown {
	let current: unknown = config;
	for (const part of path.split('.')) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function setPathValue(target: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split('.');
	let current = target;
	for (let index = 0; index < parts.length - 1; index++) {
		const part = parts[index];
		const next = current[part];
		if (!next || typeof next !== 'object' || Array.isArray(next)) current[part] = {};
		current = current[part] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = value;
}

function deletePathValue(target: Record<string, unknown>, path: string): void {
	const parts = path.split('.');
	let current: Record<string, unknown> = target;
	for (let index = 0; index < parts.length - 1; index++) {
		const next = current[parts[index]];
		if (!next || typeof next !== 'object' || Array.isArray(next)) return;
		current = next as Record<string, unknown>;
	}
	delete current[parts[parts.length - 1]];
}

export function withSetting(config: SpectraConfig, path: SettingPath, value: unknown): SpectraConfig {
	const clone = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
	setPathValue(clone, path, value);
	return clone as SpectraConfig;
}

export function withoutSetting(config: SpectraConfig, path: SettingPath): SpectraConfig {
	const clone = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
	deletePathValue(clone, path);
	return clone as SpectraConfig;
}

export function findSettingScope(path: SettingPath, cwd: string = process.cwd()): SettingScope | 'default' {
	if (getPathValue(readScopeFile('project', cwd), path) !== undefined) return 'project';
	if (getPathValue(readScopeFile('global', cwd), path) !== undefined) return 'global';
	return 'default';
}

export function effectiveSettingValue(path: SettingPath, cwd: string = process.cwd()): unknown {
	const project = getPathValue(readScopeFile('project', cwd), path);
	if (project !== undefined) return project;
	const global = getPathValue(readScopeFile('global', cwd), path);
	if (global !== undefined) return global;
	return SETTINGS_BY_PATH.get(path)?.default;
}

export function parseSettingValue(definition: SettingDefinition, raw: string): unknown {
	const trimmed = raw.trim();
	if (definition.type === 'string') return raw;
	if (definition.type === 'boolean') {
		if (/^(true|yes|on|1)$/i.test(trimmed)) return true;
		if (/^(false|no|off|0)$/i.test(trimmed)) return false;
		throw new Error(`${definition.label} expects true or false`);
	}
	if (definition.type === 'number') {
		if (trimmed === '') throw new Error(`${definition.label} expects a number`);
		const value = Number(trimmed);
		if (!Number.isFinite(value)) throw new Error(`${definition.label} expects a number`);
		return value;
	}
	if (definition.type === 'enum') {
		if (!definition.options?.includes(trimmed)) {
			throw new Error(`${definition.label} expects one of: ${definition.options?.join(', ')}`);
		}
		return trimmed;
	}
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`${definition.label} expects valid JSON`);
	}
}

export function validateSettingValue(definition: SettingDefinition, value: unknown): string | undefined {
	if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return 'must be a number';
	if (definition.type === 'boolean' && typeof value !== 'boolean') return 'must be true or false';
	if (definition.type === 'string' && typeof value !== 'string') return 'must be a string';
	if (definition.type === 'enum' && (typeof value !== 'string' || !definition.options?.includes(value))) {
		return `must be one of: ${definition.options?.join(', ')}`;
	}
	if (definition.type === 'json' && value === undefined) return 'must be valid JSON';
	return definition.validate?.(value);
}

export function formatSettingValue(value: unknown): string {
	if (value === undefined) return '(unset)';
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

export function isSettingChanged(definition: SettingDefinition, value: unknown): boolean {
	if (value === undefined) return false;
	return JSON.stringify(value) !== JSON.stringify(definition.default);
}

export function maskSecrets(value: unknown, key = ''): unknown {
	if (Array.isArray(value)) return value.map((item) => maskSecrets(item, key));
	if (!value || typeof value !== 'object') return value;
	const output: Record<string, unknown> = {};
	for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
		if (/(api.?key|token|secret|password|authorization)/i.test(childKey) || key === 'headers') {
			output[childKey] = typeof childValue === 'string' && childValue.length > 0 ? '••••' : childValue;
		} else {
			output[childKey] = maskSecrets(childValue, childKey);
		}
	}
	return output;
}

/** Atomic, locked write of one config scope. Re-reads the file so disjoint edits survive. */
export function writeScopeConfig(scope: SettingScope, cwd: string, mutate: (config: SpectraConfig) => SpectraConfig): void {
	const filePath = configPath(scope, cwd);
	mkdirSync(dirname(filePath), { recursive: true });
	const lockPath = `${filePath}.lock`;
	let lock: number | undefined;
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			lock = openSync(lockPath, 'wx');
			break;
		} catch {
			// Another writer holds the lock; retry briefly.
			const until = Date.now() + 10;
			while (Date.now() < until) { /* spin */ }
		}
	}
	try {
		const current = existsSync(filePath)
			? (() => {
				try {
					const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
					return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SpectraConfig : {};
				} catch {
					return {};
				}
			})()
			: {};
		const next = mutate(current);
		const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
		renameSync(tempPath, filePath);
	} finally {
		if (lock !== undefined) closeSync(lock);
		try { unlinkSync(lockPath); } catch { /* lock already gone */ }
	}
}

export function writeSetting(scope: SettingScope, path: SettingPath, value: unknown | undefined, cwd: string = process.cwd()): void {
	writeScopeConfig(scope, cwd, (config) => value === undefined ? withoutSetting(config, path) : withSetting(config, path, value));
}

export class SettingsWriter {
	private pending = new Map<string, { scope: SettingScope; path: SettingPath; value: unknown | undefined }>();
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly cwd: string = process.cwd(), private readonly debounceMs = 100) {}

	stage(scope: SettingScope, path: SettingPath, value: unknown | undefined): void {
		this.pending.set(`${scope}:${path}`, { scope, path, value });
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, this.debounceMs);
	}

	reset(scope: SettingScope, path: SettingPath): void {
		this.stage(scope, path, undefined);
	}

	pendingCount(): number {
		return this.pending.size;
	}

	async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const entries = [...this.pending.values()];
		this.pending.clear();
		const byScope = new Map<SettingScope, typeof entries>();
		for (const entry of entries) {
			const list = byScope.get(entry.scope) ?? [];
			list.push(entry);
			byScope.set(entry.scope, list);
		}
		for (const [scope, list] of byScope) {
			writeScopeConfig(scope, this.cwd, (config) => {
				let next = config;
				for (const entry of list) next = entry.value === undefined ? withoutSetting(next, entry.path) : withSetting(next, entry.path, entry.value);
				return next;
			});
		}
	}

	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.pending.clear();
	}
}

/** Watch both config scopes; keeps the last good config when a file is mid-write or invalid. */
export function watchConfigFiles(cwd: string, onChange: (valid: boolean) => void): () => void {
	const watchers: FSWatcher[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	const schedule = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			onChange(configFilesValid(cwd));
		}, 100);
	};
	for (const scope of ['global', 'project'] as const) {
		const directory = scope === 'project' ? join(cwd, '.spectra') : getGlobalConfigDir();
		if (!existsSync(directory)) continue;
		try {
			const watcher = watch(directory, () => schedule());
			watchers.push(watcher);
		} catch {
			// Watching is best-effort; the UI still reloads after its own writes.
		}
	}
	return () => {
		if (timer) clearTimeout(timer);
		for (const watcher of watchers) watcher.close();
	};
}
