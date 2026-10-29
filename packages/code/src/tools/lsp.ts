import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { loadConfig, type LspConfig } from '../services/config.js';
import { getLspManager } from '../lsp/manager.js';
import { resolveLspSettings } from '../lsp/servers.js';
import { runCapabilitiesAction, runReloadAction, runRequestAction, runStatusAction } from '../lsp/actions/admin.js';
import { runDiagnosticsAction } from '../lsp/actions/diagnostics.js';
import { runNavigationAction, runSymbolsAction } from '../lsp/actions/navigation.js';
import { runCodeActionsAction, runFormatAction, runRenameAction, runRenameFileAction } from '../lsp/actions/refactor.js';
import type { ActionContext, ActionResult, LspArgs } from '../lsp/actions/types.js';

export const LSP_WRITE_ACTIONS = new Set(['rename', 'rename_file', 'code_actions', 'format', 'reload', 'request']);

const ACTIONS = [
	'diagnostics',
	'definition',
	'type_definition',
	'implementation',
	'references',
	'hover',
	'symbols',
	'rename',
	'rename_file',
	'code_actions',
	'format',
	'status',
	'reload',
	'capabilities',
	'request',
] as const;

export function createLspTool(): SpectraTool {
	return {
		name: 'lsp',
		capabilities: { reads: true, writes: false },
		description: `Query language servers for code intelligence.
Actions: ${ACTIONS.join(', ')}.
Lines are 1-based; \`symbol\` resolves the column on that line and supports name#N.
rename previews a diff unless apply=true. code_actions lists unless apply=true.
diagnostics accepts a file or "*" for a workspace sweep.`,
		displayName: (args: LspArgs) => `${args.action}${args.file ? ` ${args.file}` : ''}`,
		parameters: z.object({
			action: z.enum(ACTIONS).describe('LSP operation'),
			file: z.string().optional().describe('File path; "*" for workspace diagnostics'),
			line: z.number().optional().describe('1-based line'),
			symbol: z.string().optional().describe('Symbol text on the line; supports name#N'),
			query: z.string().optional().describe('Workspace symbol query, code-action index, or raw LSP method'),
			new_name: z.string().optional().describe('New symbol or file name for rename/rename_file'),
			apply: z.boolean().optional().describe('Apply edits (rename, code_actions); format applies by default'),
			timeout: z.number().optional().describe('Call deadline in seconds (5-300)'),
			payload: z.string().optional().describe('JSON payload for action=request'),
		}),
		execute: async (args, context) => {
			const config: LspConfig | undefined = loadConfig().tools?.lsp;
			const settings = resolveLspSettings(config);
			if (!settings.enabled) return errorResult('LSP is disabled (tools.lsp.enabled=false).');

			const timeoutMs = Math.min(300, Math.max(5, args.timeout ?? 0)) * 1000 || undefined;
			const signal = timeoutMs
				? (context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs))
				: context.signal;

			const actionContext: ActionContext = {
				manager: getLspManager(config),
				args: args as LspArgs,
				cwd: process.cwd(),
				signal,
			};

			try {
				const result = await dispatch(actionContext);
				return result.isError ? errorResult(result.text) : textResult(result.text, result.details);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return errorResult(`LSP ${args.action}: ${message}`);
			}
		},
	};
}

async function dispatch(context: ActionContext): Promise<ActionResult> {
	switch (context.args.action) {
		case 'diagnostics':
			return runDiagnosticsAction(context);
		case 'definition':
		case 'type_definition':
		case 'implementation':
		case 'references':
		case 'hover':
			return runNavigationAction(context);
		case 'symbols':
			return runSymbolsAction(context);
		case 'rename':
			return runRenameAction(context);
		case 'rename_file':
			return runRenameFileAction(context);
		case 'code_actions':
			return runCodeActionsAction(context);
		case 'format':
			return runFormatAction(context);
		case 'status':
			return runStatusAction(context);
		case 'reload':
			return runReloadAction(context);
		case 'capabilities':
			return runCapabilitiesAction(context);
		case 'request':
			return runRequestAction(context);
		default:
			throw new Error(`Unknown action: ${context.args.action}`);
	}
}
