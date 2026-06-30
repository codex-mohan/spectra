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

export async function executeCommand(item: CmdItem, ctx: CommandRunContext): Promise<void> {
	await item.beforeRun?.(ctx);
	await item.action(ctx);
	await item.afterRun?.(ctx);
}
