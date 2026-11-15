import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import { getGlobalConfigDir } from '../utils/paths.js';
import { loadConfig, type PluginConfig } from '../services/config.js';
import { setExternalSettings, type SettingDefinition } from '../config/registry.js';
import { writeScopeConfig } from '../config/registry.js';
import { HookBus } from '../runtime/hooks.js';
import {
	defineService,
	type Disposable,
	type HookInputMap,
	type HookResultMap,
	type HookName,
	type LoadedPlugin,
	type PluginContext,
	type PluginDiagnostic,
	type PluginManifest,
	type PluginSettingInput,
	type PromptSection,
	type ServiceKey,
	type SpectraPlugin,
} from '../runtime/types.js';
import type { SpectraTool } from '../tools/types.js';
import type { CommandDefinition } from '../command/types.js';

interface PluginRecord {
	id: string;
	manifest: PluginManifest;
	entryPath: string;
	config: Record<string, unknown>;
	enabled: boolean;
	state: LoadedPlugin['state'];
	disposables: Disposable[];
	tools: SpectraTool[];
	commands: CommandDefinition[];
	prompts: PromptSection[];
	settings: SettingDefinition[];
	hookCount: number;
	diagnostics: PluginDiagnostic[];
	error?: string;
}

const ACTIVATION_TIMEOUT_MS = 10_000;
const HOOK_TIMEOUT_MS = 5_000;
const CORE_SERVICES: Record<string, true> = {
	'spectra.tools': true,
	'spectra.commands': true,
	'spectra.prompts': true,
	'spectra.settings': true,
	'spectra.hooks': true,
	'spectra.sessions': true,
};

export interface PluginHostOptions {
	activationTimeoutMs?: number;
	hookTimeoutMs?: number;
}

function resolveContainedEntry(pluginDir: string, entry: string): string | null {
	const target = resolve(pluginDir, entry);
	const rel = relative(pluginDir, target);
	if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
	return target;
}

function readManifest(directory: string): PluginManifest | string {
	const path = join(directory, 'plugin.json');
	if (!existsSync(path)) return `Missing plugin.json in ${directory}`;
	try {
		const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PluginManifest>;
		if (!raw.id || typeof raw.id !== 'string') return 'plugin.json requires a string id';
		if (!raw.entry || typeof raw.entry !== 'string') return 'plugin.json requires a string entry';
		return {
			id: raw.id,
			name: raw.name,
			version: raw.version,
			description: raw.description,
			entry: raw.entry,
			requires: Array.isArray(raw.requires) ? raw.requires : [],
			capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
		};
	} catch (error) {
		return `Invalid plugin.json: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function isPluginExport(value: unknown): value is SpectraPlugin | ((ctx: PluginContext, config: Record<string, unknown>) => unknown) {
	if (typeof value === 'function') return true;
	return Boolean(value && typeof value === 'object' && typeof (value as SpectraPlugin).setup === 'function');
}

export class PluginHost {
	private readonly records = new Map<string, PluginRecord>();
	private readonly services = new Map<string, unknown>();
	private readonly hooks: HookBus;
	private readonly activationTimeoutMs: number;
	private initialized: Promise<void> | null = null;
	private cwd = process.cwd();
	private active = false;

	constructor(options: PluginHostOptions = {}) {
		this.activationTimeoutMs = options.activationTimeoutMs ?? ACTIVATION_TIMEOUT_MS;
		this.hooks = new HookBus({ handlerTimeoutMs: options.hookTimeoutMs ?? HOOK_TIMEOUT_MS });
		this.services.set('spectra.tools', { register: (tool: SpectraTool, pluginId?: string) => this.registerTool(pluginId ?? 'unknown', tool) });
		this.services.set('spectra.commands', { register: (command: CommandDefinition, pluginId?: string) => this.registerCommand(pluginId ?? 'unknown', command) });
		this.services.set('spectra.prompts', { section: (section: Omit<PromptSection, 'pluginId'>, pluginId?: string) => this.registerPrompt(pluginId ?? 'unknown', section) });
		this.services.set('spectra.settings', { register: (setting: PluginSettingInput, pluginId?: string) => this.registerSetting(pluginId ?? 'unknown', setting) });
		this.services.set('spectra.hooks', this.hooks);
		this.services.set('spectra.sessions', {});
		this.hooks.onError((pluginId, event, error) => this.failPlugin(pluginId, event, error));
	}

	async initialize(cwd = process.cwd()): Promise<void> {
		if (this.initialized) return this.initialized;
		this.cwd = cwd;
		this.initialized = (async () => {
			this.discover();
			for (const record of this.records.values()) {
				if (record.enabled) await this.activate(record);
			}
			this.refreshSettings();
			this.active = true;
		})();
		return this.initialized;
	}

	private discover(): void {
		const config = loadConfig(this.cwd);
		const configured = new Map<string, PluginConfig>();
		for (const entry of config.plugins ?? []) {
			if (entry && typeof entry.name === 'string') configured.set(entry.name, entry);
		}

		const directories = [
			join(this.cwd, '.spectra', 'plugins'),
			join(getGlobalConfigDir(), 'plugins'),
		];
		for (const directory of directories) {
			if (!existsSync(directory)) continue;
			for (const child of readdirSync(directory, { withFileTypes: true })) {
				if (!child.isDirectory()) continue;
				const pluginDir = join(directory, child.name);
				const manifestOrError = readManifest(pluginDir);
				if (typeof manifestOrError === 'string') {
					this.addBroken(child.name, manifestOrError);
					continue;
				}
				const entryPath = resolveContainedEntry(pluginDir, manifestOrError.entry);
				if (!entryPath) {
					this.addBroken(child.name, `Plugin entry escapes its directory: ${manifestOrError.entry}`);
					continue;
				}
				this.addDiscovered(manifestOrError, entryPath, configured.get(manifestOrError.id) ?? configured.get(child.name));
			}
		}

		for (const [name, entry] of configured) {
			if (this.records.has(name)) continue;
			const rawPath = entry.path?.trim();
			if (!rawPath) continue;
			const path = isAbsolute(rawPath) ? rawPath : resolve(this.cwd, rawPath);
			if (!existsSync(path)) {
				this.addBroken(name, `Plugin path does not exist: ${path}`);
				continue;
			}
			const directory = existsSync(join(path, 'plugin.json')) ? path : dirname(path);
			const manifestOrError = readManifest(directory);
			if (typeof manifestOrError === 'string') {
				this.addBroken(name, manifestOrError);
				continue;
			}
			const entryPath = resolveContainedEntry(directory, manifestOrError.entry);
			if (!entryPath) {
				this.addBroken(name, `Plugin entry escapes its directory: ${manifestOrError.entry}`);
				continue;
			}
			this.addDiscovered(manifestOrError, entryPath, entry);
		}
	}

	private async failPlugin(pluginId: string, event: string, error: unknown): Promise<void> {
		const record = this.records.get(pluginId);
		if (!record || record.state === 'failed') return;
		record.diagnostics.push({
			at: Date.now(),
			level: 'error',
			message: `Hook ${event} failed and the plugin was disabled: ${error instanceof Error ? error.message : String(error)}`,
		});
		record.state = 'failed';
		record.error = error instanceof Error ? error.message : String(error);
		await this.disposeRecord(record);
		record.state = 'failed';
		this.refreshSettings();
	}

	private addBroken(id: string, message: string): void {
		this.records.set(id, {
			id,
			manifest: { id, entry: '' },
			entryPath: '',
			config: {},
			enabled: false,
			state: 'failed',
			disposables: [],
			tools: [],
			commands: [],
			prompts: [],
			settings: [],
			hookCount: 0,
			diagnostics: [{ at: Date.now(), level: 'error', message }],
			error: message,
		});
	}

	private addDiscovered(manifest: PluginManifest, entryPath: string, configured?: PluginConfig): void {
		if (this.records.has(manifest.id)) return;
		this.records.set(manifest.id, {
			id: manifest.id,
			manifest,
			entryPath,
			config: configured?.config ?? {},
			enabled: configured?.enabled !== false,
			state: configured?.enabled === false ? 'disabled' : 'discovered',
			disposables: [],
			tools: [],
			commands: [],
			prompts: [],
			settings: [],
			hookCount: 0,
			diagnostics: [],
		});
	}

	private async activate(record: PluginRecord): Promise<void> {
		if (record.state === 'active' || record.state === 'loading') return;
		const missing = (record.manifest.requires ?? []).filter((name) => !this.services.has(name) && CORE_SERVICES[name] !== true);
		if (missing.length > 0) {
			record.state = 'failed';
			record.error = `Missing required services: ${missing.join(', ')}`;
			record.diagnostics.push({ at: Date.now(), level: 'error', message: record.error });
			return;
		}
		record.state = 'loading';
		const controller = new AbortController();
		const context = this.createContext(record, controller.signal);
		const deadline = Date.now() + this.activationTimeoutMs;
		let setupPromise: Promise<unknown> | null = null;
		try {
			const module = await this.withinDeadline(
				import(`${pathToFileURL(record.entryPath).href}?v=${Date.now()}`),
				deadline,
				'import',
			) as { default?: unknown };
			const exported = module.default;
			if (!isPluginExport(exported)) throw new Error('Plugin default export must be definePlugin(...) or a setup function');
			const setup = typeof exported === 'function' ? exported : exported.setup.bind(exported);
			setupPromise = Promise.resolve(setup(context, record.config));
			const result = await this.withinDeadline(setupPromise, deadline, 'setup');
			if (result && typeof (result as Disposable).dispose === 'function') record.disposables.push(result as Disposable);
			record.state = 'active';
			record.error = undefined;
			record.diagnostics.push({ at: Date.now(), level: 'info', message: 'Activated' });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			record.state = 'failed';
			record.error = message;
			record.diagnostics.push({ at: Date.now(), level: 'error', message });
			controller.abort();
			await this.disposeRecord(record);
			record.state = 'failed';
			void setupPromise?.then((late) => {
				if (late && typeof (late as Disposable).dispose === 'function') void (late as Disposable).dispose();
			}).catch(() => {});
		}
	}

	private async withinDeadline<T>(work: Promise<T>, deadline: number, phase: string): Promise<T> {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error(`Plugin activation timed out during ${phase}`);
		const { promise, resolve, reject } = Promise.withResolvers<T>();
		const timer = setTimeout(() => {
			reject(new Error(`Plugin activation timed out during ${phase} after ${this.activationTimeoutMs}ms`));
		}, remaining);
		timer.unref?.();
		work.then(resolve, reject);
		try {
			return await promise;
		} finally {
			clearTimeout(timer);
		}
	}

	private createContext(record: PluginRecord, signal: AbortSignal): PluginContext {
		const disposables = record.disposables;
		const assertActive = (): void => {
			if (signal.aborted) throw new Error('Plugin activation aborted');
		};
		const add = (disposable: Disposable): Disposable => {
			let active = true;
			const wrapped: Disposable = {
				dispose: async () => {
					if (!active) return;
					active = false;
					const index = disposables.indexOf(wrapped);
					if (index >= 0) disposables.splice(index, 1);
					await disposable.dispose();
				},
			};
			disposables.push(wrapped);
			return wrapped;
		};
		return {
			pluginId: record.id,
			config: record.config,
			signal,
			effect: (fn, label) => {
				assertActive();
				void label;
				const pending = Promise.resolve(fn()).catch((error: unknown) => {
					record.diagnostics.push({ at: Date.now(), level: 'error', message: `Effect failed: ${error instanceof Error ? error.message : String(error)}` });
					return undefined;
				});
				return add({
					dispose: async () => {
						const disposal = await pending;
						if (disposal && typeof disposal.dispose === 'function') await disposal.dispose();
					},
				});
			},
			provide: <T>(key: ServiceKey<T>, value: T) => {
				assertActive();
				if (CORE_SERVICES[key.id]) throw new Error(`Plugins cannot provide core service ${key.id}`);
				const prefix = `plugin:${record.id}:`;
				if (!key.id.startsWith(prefix)) throw new Error(`Plugin services must use "${prefix}<name>"`);
				this.services.set(key.id, value);
				return add({ dispose: () => { if (this.services.get(key.id) === value) this.services.delete(key.id); } });
			},
			get: <T>(key: ServiceKey<T>) => this.services.get(key.id) as T | undefined,
			require: <T>(key: ServiceKey<T>) => {
				const value = this.services.get(key.id) as T | undefined;
				if (value === undefined) throw new Error(`Required service unavailable: ${key.id}`);
				return value;
			},
			tools: { register: (tool) => { assertActive(); return add(this.registerTool(record.id, tool)); } },
			commands: { register: (command) => { assertActive(); return add(this.registerCommand(record.id, command)); } },
			prompts: { section: (section) => { assertActive(); return add(this.registerPrompt(record.id, section)); } },
			settings: { register: (setting) => { assertActive(); return add(this.registerSetting(record.id, setting)); } },
			hooks: {
				on: (event, handler, priority) => {
					assertActive();
					record.hookCount++;
					const disposable = this.hooks.on(record.id, event, handler, priority);
					return add({
						dispose: () => {
							record.hookCount = Math.max(0, record.hookCount - 1);
							disposable.dispose();
						},
					});
				},
			},
		};
	}

	private registerTool(pluginId: string, tool: SpectraTool): Disposable {
		const record = this.records.get(pluginId);
		const normalized: SpectraTool = { ...tool, permission: tool.permission ?? `plugin:${pluginId}` };
		record?.tools.push(normalized);
		return { dispose: () => { const index = record?.tools.indexOf(normalized) ?? -1; if (index >= 0) record!.tools.splice(index, 1); } };
	}

	private registerCommand(pluginId: string, command: CommandDefinition): Disposable {
		const record = this.records.get(pluginId);
		const normalized: CommandDefinition = { ...command, source: 'plugin', sourceInfo: { ...command.sourceInfo, pluginId } };
		record?.commands.push(normalized);
		return { dispose: () => { const index = record?.commands.indexOf(normalized) ?? -1; if (index >= 0) record!.commands.splice(index, 1); } };
	}

	private registerPrompt(pluginId: string, section: Omit<PromptSection, 'pluginId'>): Disposable {
		const record = this.records.get(pluginId);
		const normalized: PromptSection = { ...section, pluginId };
		record?.prompts.push(normalized);
		return { dispose: () => { const index = record?.prompts.indexOf(normalized) ?? -1; if (index >= 0) record!.prompts.splice(index, 1); } };
	}

	private registerSetting(pluginId: string, setting: PluginSettingInput): Disposable {
		const record = this.records.get(pluginId);
		const definition: SettingDefinition = {
			path: `pluginSettings.${pluginId}.${setting.key}` as SettingDefinition['path'],
			type: setting.type,
			tab: 'tools',
			section: setting.section ?? `Plugins · ${record?.manifest.name ?? pluginId}`,
			label: setting.label ?? setting.key,
			description: setting.description,
			default: setting.default,
			options: setting.options,
		};
		record?.settings.push(definition);
		return { dispose: () => { const index = record?.settings.indexOf(definition) ?? -1; if (index >= 0) record!.settings.splice(index, 1); } };
	}

	private async disposeRecord(record: PluginRecord): Promise<void> {
		this.hooks.disposePlugin(record.id);
		for (const disposable of [...record.disposables].reverse()) {
			try { await disposable.dispose(); } catch (error) {
				record.diagnostics.push({ at: Date.now(), level: 'warn', message: `Disposal failed: ${error instanceof Error ? error.message : String(error)}` });
			}
		}
		record.disposables = [];
		record.tools = [];
		record.commands = [];
		record.prompts = [];
		record.settings = [];
		record.state = record.enabled ? 'disposed' : 'disabled';
		this.refreshSettings();
	}

	private refreshSettings(): void {
		setExternalSettings([...this.records.values()].flatMap((record) => record.settings));
	}

	async shutdown(): Promise<void> {
		for (const record of this.records.values()) await this.disposeRecord(record);
		this.records.clear();
		this.active = false;
		this.initialized = null;
		setExternalSettings([]);
	}

	async reload(id: string): Promise<void> {
		const record = this.records.get(id);
		if (!record) return;
		if (!record.enabled) return;
		await this.disposeRecord(record);
		await this.activate(record);
		this.refreshSettings();
	}

	async setEnabled(id: string, enabled: boolean): Promise<void> {
		const record = this.records.get(id);
		if (!record) return;
		record.enabled = enabled;
		if (enabled) {
			if (record.state !== 'active') await this.activate(record);
		} else {
			await this.disposeRecord(record);
			record.state = 'disabled';
		}
		writeScopeConfig('project', this.cwd, (config) => {
			const plugins = [...(config.plugins ?? [])];
			const index = plugins.findIndex((entry) => entry.name === id);
			if (index >= 0) plugins[index] = { ...plugins[index], enabled };
			else plugins.push({ name: id, enabled });
			return { ...config, plugins };
		});
		this.refreshSettings();
	}

	tools(): SpectraTool[] {
		return [...this.records.values()].flatMap((record) => record.state === 'active' ? record.tools : []);
	}

	commands(): CommandDefinition[] {
		return [...this.records.values()].flatMap((record) => record.state === 'active' ? record.commands : []);
	}

	promptSections(): PromptSection[] {
		return [...this.records.values()]
			.flatMap((record) => record.state === 'active' ? record.prompts : [])
			.sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
	}

	list(): LoadedPlugin[] {
		return [...this.records.values()].map((record) => ({
			id: record.id,
			manifest: record.manifest,
			state: record.state,
			enabled: record.enabled,
			error: record.error,
			contributions: {
				tools: record.tools.length,
				commands: record.commands.length,
				prompts: record.prompts.length,
				settings: record.settings.length,
				hooks: record.hookCount,
			},
			diagnostics: record.diagnostics.slice(-20),
			disposables: [],
		}));
	}

	async runToolBefore(payload: HookInputMap['tool.beforeExecute']): Promise<{ block?: boolean; reason?: string }> {
		const results = await this.hooks.runBlocking('tool.beforeExecute', payload);
		for (const result of results) if (result.block) return result as { block: true; reason?: string };
		return {};
	}

	async runToolAfter(payload: HookInputMap['tool.afterExecute']): Promise<HookResultMap['tool.afterExecute']['result'] | undefined> {
		const results = await this.hooks.run('tool.afterExecute', payload);
		let result = payload.result;
		for (const update of results) if (update.result) result = update.result;
		return result === payload.result ? undefined : result;
	}

	async runSessionStart(sessionId: string): Promise<void> {
		await this.hooks.run('session.start', { sessionId });
	}

	async runSessionEnd(sessionId: string): Promise<void> {
		await this.hooks.run('session.end', { sessionId });
	}

	async runTurnEnd(sessionId: string, error?: string): Promise<void> {
		await this.hooks.run('agent.turnEnd', { sessionId, ...(error ? { error } : {}) });
	}

	async runCommandBefore(payload: HookInputMap['command.beforeExecute']): Promise<{ block?: boolean; reason?: string }> {
		const results = await this.hooks.runBlocking('command.beforeExecute', payload);
		for (const result of results) if (result.block) return result as { block: true; reason?: string };
		return {};
	}
}

export const pluginHost = new PluginHost();
export const CORE_SERVICE_KEYS = {
	tools: defineService<unknown>('spectra.tools', 'Tool registry'),
	commands: defineService<unknown>('spectra.commands', 'Command registry'),
	prompts: defineService<unknown>('spectra.prompts', 'Prompt section registry'),
	settings: defineService<unknown>('spectra.settings', 'Settings registry'),
	hooks: defineService<unknown>('spectra.hooks', 'Hook bus'),
	sessions: defineService<unknown>('spectra.sessions', 'Session service'),
};
