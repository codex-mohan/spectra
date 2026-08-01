// ---------------------------------------------------------------------------
// TUI command types — legacy CmdItem + adapter bridge to command domain.
// ---------------------------------------------------------------------------

import {
	type CommandContext,
	type CommandDefinition,
	type CommandSource,
	type CommandSourceInfo,
	type CommandAction,
	type ResolvedCommand,
	type CommandResult,
	type ArgCompletion as DomainArgCompletion,
	adaptLegacyCmdItem,
	createRegistry,
	type RegistrySnapshot,
	dispatch,
	type DispatcherResult,
} from '../command/index.js';
import { BUILTIN_TEMPLATE_COMMANDS } from '../command/index.js';

// ---------------------------------------------------------------------------
// Re-export domain types for TUI consumers
// ---------------------------------------------------------------------------

export type { CommandContext, CommandDefinition, CommandSource, CommandSourceInfo, CommandAction, CommandResult, ArgCompletion as DomainArgCompletion } from '../command/index.js';
export type { ResolvedCommand, RegistrySnapshot, DispatcherResult } from '../command/index.js';
/** Alias for backward compat with TUI consumers */
export type CommandRegistry = RegistrySnapshot;

// ---------------------------------------------------------------------------
// Legacy types — kept for backward compatibility with existing handlers
// ---------------------------------------------------------------------------

export interface ArgCompletion {
	value: string;
	desc?: string;
}

export interface CommandRunContext {
	source: 'palette' | 'slash';
	args: string;
}

export interface CmdItem {
	id: string;
	label: string;
	desc: string;
	cat?: string;
	action: (ctx: CommandRunContext) => void | Promise<void>;
	slashName?: string;
	slashAliases?: string[];
	argCompleter?: (args: string) => Array<string | ArgCompletion> | Promise<Array<string | ArgCompletion>>;
	beforeRun?: (ctx: CommandRunContext) => void | Promise<void>;
	afterRun?: (ctx: CommandRunContext) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Legacy executor — preserved for any code that still calls it directly
// ---------------------------------------------------------------------------

export async function executeCommand(item: CmdItem, ctx: CommandRunContext): Promise<void> {
	await item.beforeRun?.(ctx);
	await item.action(ctx);
	await item.afterRun?.(ctx);
}

// ---------------------------------------------------------------------------
// Registry builder — adapts CmdItem[] → immutable RegistrySnapshot
// ---------------------------------------------------------------------------

/**
 * Build an immutable RegistrySnapshot from legacy CmdItem output.
 * When `templates` is provided, those definitions are placed first so
 * project template names win primary invocation slots; adapted builtins
 * fill the remaining slots and receive collision suffixes where needed.
 */
export function buildCommandRegistry(
	items: CmdItem[],
	templates?: readonly CommandDefinition[],
): RegistrySnapshot {
	const builtinDefs: CommandDefinition[] = items.map((item) => adaptLegacyCmdItem(item));
	const definitions: CommandDefinition[] = templates
		? [...templates, ...BUILTIN_TEMPLATE_COMMANDS, ...builtinDefs]
		: [...BUILTIN_TEMPLATE_COMMANDS, ...builtinDefs];
	return createRegistry(definitions);
}

// ---------------------------------------------------------------------------
// Dispatcher wrapper — thin adapter over command domain dispatch()
// ---------------------------------------------------------------------------

/**
 * Centralized command dispatcher.
 * Lifecycle: execute (which internally runs beforeRun → action → afterRun
 * for legacy commands), with hook failure reporting.
 */
export async function dispatchCommand(
	resolved: ResolvedCommand,
	ctx: CommandRunContext,
): Promise<DispatcherResult> {
	const domainCtx: CommandContext = { source: ctx.source, args: ctx.args, invocation: resolved.invocation };
	return dispatch(resolved, domainCtx);
}
