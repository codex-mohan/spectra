import type { LspManager } from '../manager.js';

export interface LspArgs {
	action: string;
	file?: string;
	line?: number;
	symbol?: string;
	query?: string;
	new_name?: string;
	apply?: boolean;
	timeout?: number;
	payload?: string;
}

export interface ActionContext {
	manager: LspManager;
	args: LspArgs;
	cwd: string;
	signal?: AbortSignal;
}

export interface ActionResult {
	text: string;
	details: Record<string, unknown>;
	isError?: boolean;
}

export function requireFile(args: LspArgs): string {
	if (!args.file) throw new Error(`${args.action} requires a file`);
	return args.file;
}
