// ---------------------------------------------------------------------------
// Command domain types — pure TypeScript, no React/OpenTUI imports.
// ---------------------------------------------------------------------------

/** Where a command originates. */
export type CommandSource = 'builtin' | 'template' | 'plugin' | 'skill' | 'mcp';

/** Provenance shown by command discovery and diagnostics. */
export interface CommandSourceInfo {
	readonly label?: string;
	readonly path?: string;
	readonly package?: string;
	readonly pluginId?: string;
}

/** Invocation data shared by slash and palette commands. */
export interface CommandContext {
	readonly source: 'palette' | 'slash';
	readonly args: string;
	readonly invocation: string;
}

/** Phase 2 plain command actions — concrete discriminated union. */
export type CommandAction =
	| { readonly type: 'submit_prompt'; readonly text: string }
	| { readonly type: 'open_dialog'; readonly dialog: { readonly type: string; readonly [key: string]: unknown } }
	| { readonly type: 'show_toast'; readonly message: string; readonly variant?: 'info' | 'success' | 'warn' | 'error' };

/** A command handler may return void, a single action, or a readonly array of actions. */
export type CommandResult = void | CommandAction | readonly CommandAction[];

/** Argument completion entry for slash autocomplete. */
export interface ArgCompletion {
	readonly value: string;
	readonly desc?: string;
}

// ---------------------------------------------------------------------------
// CommandDefinition — the canonical registration unit.
// ---------------------------------------------------------------------------

export interface CommandDefinition {
	/** Stable identifier, unique per command. */
	readonly id: string;

	/**
	 * Canonical slash-name (without leading `/`).
	 * Used as the primary invocation key.
	 */
	readonly name: string;

	/** Additional invocation aliases — all resolved for slash lookup. */
	readonly aliases: readonly string[];

	/** Human-readable title for palette display. */
	readonly title: string;

	/** One-line description. */
	readonly description: string;

	/** Category for palette grouping. */
	readonly category?: string;

	/** Where this command originated. */
	readonly source: CommandSource;

	/** Source-specific metadata. */
	readonly sourceInfo?: CommandSourceInfo;

	/** Argument completer for slash autocomplete. */
	readonly argCompleter?: (
		args: string,
	) => readonly (string | ArgCompletion)[] | Promise<readonly (string | ArgCompletion)[]>;

	/**
	 * Execute the command.
	 * Returns zero or more actions, or void for legacy commands.
	 */
	readonly execute: (
		ctx: CommandContext,
	) => CommandResult | Promise<CommandResult>;
}

// ---------------------------------------------------------------------------
// ResolvedCommand — the result of registry lookup.
// ---------------------------------------------------------------------------

export interface ResolvedCommand {
	/** The original definition. */
	readonly definition: CommandDefinition;

	/** The exact invocation string that matched (name or alias). */
	readonly invocation: string;

	/**
	 * Collision index — 0 for first registration of this name,
	 * 1 for the `:2` suffixed variant, 2 for `:3`, etc.
	 */
	readonly collisionIndex: number;

	/** Whether the invocation matched the canonical name or an alias. */
	readonly matchedBy: 'name' | 'alias';
}

// ---------------------------------------------------------------------------
// Legacy adapter — matches CmdItem shape without importing from TUI.
// ---------------------------------------------------------------------------

/** Structural match for CmdItem from tui/command-types.ts. */
export interface LegacyCmdItemLike {
	readonly id: string;
	readonly label: string;
	readonly desc: string;
	readonly cat?: string;
	readonly action: (ctx: { source: 'palette' | 'slash'; args: string }) => void | Promise<void>;
	readonly slashName?: string;
	readonly slashAliases?: string[];
	readonly argCompleter?: (
		args: string,
	) => readonly (string | ArgCompletion)[] | Promise<readonly (string | ArgCompletion)[]>;
	readonly beforeRun?: (ctx: { source: 'palette' | 'slash'; args: string }) => void | Promise<void>;
	readonly afterRun?: (ctx: { source: 'palette' | 'slash'; args: string }) => void | Promise<void>;
}
