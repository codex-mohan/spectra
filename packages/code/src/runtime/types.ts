import type { z } from 'zod';
import type { SpectraTool } from '../tools/types.js';
import type { CommandDefinition } from '../command/types.js';
import type { SettingDefinition } from '../config/registry.js';

export interface Disposable {
	dispose(): void | Promise<void>;
}

export interface ServiceKey<T> {
	readonly id: string;
	readonly description?: string;
}

export function defineService<T>(id: string, description?: string): ServiceKey<T> {
	return { id, description };
}

export type HookName =
	| 'tool.beforeExecute'
	| 'tool.afterExecute'
	| 'session.start'
	| 'session.end'
	| 'agent.turnEnd'
	| 'command.beforeExecute';

export interface ToolBeforeHookInput {
	toolName: string;
	args: Record<string, unknown>;
	sessionId?: string;
}

export interface ToolAfterHookInput extends ToolBeforeHookInput {
	result: { content: Array<{ type: string; [key: string]: unknown }>; isError?: boolean };
}

export interface HookInputMap {
	'tool.beforeExecute': ToolBeforeHookInput;
	'tool.afterExecute': ToolAfterHookInput;
	'session.start': { sessionId: string };
	'session.end': { sessionId: string };
	'agent.turnEnd': { sessionId: string; error?: string };
	'command.beforeExecute': { name: string; args: string };
}

export interface HookResultMap {
	'tool.beforeExecute': { block?: boolean; reason?: string };
	'tool.afterExecute': { result?: ToolAfterHookInput['result'] };
	'session.start': void;
	'session.end': void;
	'agent.turnEnd': void;
	'command.beforeExecute': { block?: boolean; reason?: string };
}

export interface PromptSection {
	id: string;
	order?: number;
	text: string;
	pluginId?: string;
}

export interface PluginSettingInput {
	key: string;
	label?: string;
	description: string;
	type: 'string' | 'number' | 'boolean' | 'enum' | 'json';
	default?: unknown;
	options?: readonly string[];
	section?: string;
}

export interface PluginManifest {
	id: string;
	name?: string;
	version?: string;
	description?: string;
	entry: string;
	requires?: readonly string[];
	capabilities?: readonly string[];
}

export interface PluginContext {
	readonly pluginId: string;
	readonly config: Record<string, unknown>;
	readonly signal: AbortSignal;
	effect(fn: () => void | Promise<void> | Disposable, label?: string): Disposable;
	provide<T>(key: ServiceKey<T>, value: T): Disposable;
	get<T>(key: ServiceKey<T>): T | undefined;
	require<T>(key: ServiceKey<T>): T;
	tools: {
		register(tool: SpectraTool): Disposable;
	};
	commands: {
		register(command: CommandDefinition): Disposable;
	};
	prompts: {
		section(section: Omit<PromptSection, 'pluginId'>): Disposable;
	};
	settings: {
		register(setting: PluginSettingInput): Disposable;
	};
	hooks: {
		on<E extends HookName>(event: E, handler: (payload: HookInputMap[E]) => void | HookResultMap[E] | Promise<void | HookResultMap[E]>, priority?: number): Disposable;
	};
}

export interface SpectraPlugin {
	manifest?: Partial<PluginManifest>;
	setup(context: PluginContext, config: Record<string, unknown>): void | Disposable | Promise<void | Disposable>;
}

export function definePlugin<T extends SpectraPlugin>(plugin: T): T {
	return plugin;
}

export type PluginState = 'discovered' | 'loading' | 'active' | 'failed' | 'disabled' | 'disposed';

export interface PluginDiagnostic {
	at: number;
	level: 'info' | 'warn' | 'error';
	message: string;
}

export interface LoadedPlugin {
	id: string;
	manifest: PluginManifest;
	state: PluginState;
	enabled: boolean;
	error?: string;
	contributions: { tools: number; commands: number; prompts: number; settings: number; hooks: number };
	diagnostics: PluginDiagnostic[];
	disposables: Disposable[];
}

export type PluginSettingPath = `pluginSettings.${string}.${string}`;
