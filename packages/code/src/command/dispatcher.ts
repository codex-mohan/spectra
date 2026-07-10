// ---------------------------------------------------------------------------
// Command dispatcher — lifecycle execution, effect application, legacy adapter.
// ---------------------------------------------------------------------------

import type {
	CommandContext,
	CommandDefinition,
	CommandEffect,
	LegacyCmdItemLike,
	ResolvedCommand,
} from './types.js';

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface DispatcherResult {
	readonly ok: boolean;
	readonly effects: readonly CommandEffect[];
	readonly error?: unknown;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface DispatcherHooks {
	/** Called before command execution. Throwing cancels the command. */
	readonly before?: (cmd: ResolvedCommand, ctx: CommandContext) => void | Promise<void>;
	/**
	 * Called after command execution — always runs, even on failure.
	 * Receives the full result so it can observe errors without swallowing them.
	 */
	readonly after?: (
		cmd: ResolvedCommand,
		ctx: CommandContext,
		result: DispatcherResult,
	) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Effect normalisation
// ---------------------------------------------------------------------------

function toEffects(value: CommandEffect[] | CommandEffect | void): CommandEffect[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

/**
 * Execute a resolved command through the lifecycle:
 *
 *   1. before hook (if provided) — throwing cancels execution
 *   2. definition.execute(ctx)
 *   3. normalise effects
 *   4. after hook (always runs, receives failure info)
 *
 * The dispatcher never swallows execution errors: the error is captured
 * in the result and re-thrown after the after hook runs.
 */
export async function dispatch(
	resolved: ResolvedCommand,
	ctx: CommandContext,
	hooks?: DispatcherHooks,
): Promise<DispatcherResult> {
	let result: DispatcherResult;

	try {
		if (hooks?.before) await hooks.before(resolved, ctx);
		const execResult = await resolved.definition.execute(ctx);
		result = { ok: true, effects: toEffects(execResult) };
	} catch (error) {
		result = { ok: false, effects: [], error };
	}

	// Always run after hook — failures are observable, never swallowed.
	try {
		if (hooks?.after) await hooks.after(resolved, ctx, result);
	} catch {
		// after-hook errors are non-fatal; they must not mask the command result.
	}

	// Propagate execution errors to the caller — do not swallow.
	if (!result.ok) throw result.error;

	return result;
}

// ---------------------------------------------------------------------------
// Legacy CmdItem adapter
// ---------------------------------------------------------------------------

/**
 * Adapt a legacy CmdItem (from tui/command-types) into a CommandDefinition
 * without modifying the original handler. The adapter:
 *
 *  - Maps `action` → `execute`
 *  - Wraps `beforeRun` / `afterRun` into `execute` so the dispatcher
 *    sees a single execute() call (hooks are consumed internally).
 *  - Maps `label` → `title`, `desc` → `description`, `cat` → `category`.
 *
 * The returned definition's execute() runs beforeRun → action → afterRun
 * exactly as the original `executeCommand` did, so behaviour is preserved.
 *
 * For integration with the new dispatcher, call this adapter then use
 * `createRegistry([adapted])` and `dispatch()` — the legacy beforeRun /
 * afterRun are baked into execute(), not dispatcher hooks.
 */
export function adaptLegacyCmdItem(item: LegacyCmdItemLike): CommandDefinition {
	return {
		id: `builtin:${item.id}`,
		name: item.slashName ?? item.id,
		aliases: item.slashAliases ?? [],
		title: item.label,
		description: item.desc,
		category: item.cat,
		source: 'builtin',
		sourceInfo: { label: 'Spectra built-in' },
		argCompleter: item.argCompleter
			? (args) => item.argCompleter!(args)
			: undefined,
		execute: async (ctx: CommandContext) => {
			const runCtx = { source: ctx.source, args: ctx.args };
			if (item.beforeRun) await item.beforeRun(runCtx);
			await item.action(runCtx);
			if (item.afterRun) await item.afterRun(runCtx);
		},
	};
}
