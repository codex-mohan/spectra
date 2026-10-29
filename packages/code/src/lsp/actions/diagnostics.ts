import { resolve } from 'path';
import { spawnRg } from '../../tools/utils.js';
import { findServerForFile } from '../servers.js';
import { formatDiagnostics } from '../format.js';
import { requireFile, type ActionContext, type ActionResult } from './types.js';

const MAX_WORKSPACE_FILES = 300;

async function workspaceFiles(context: ActionContext): Promise<string[]> {
	const match = context.args.query;
	const result = await spawnRg(['--files', context.cwd], context.cwd).catch(() => null);
	if (!result) return [];
	const files = result.stdout.split('\n').filter(Boolean).map((file) => resolve(context.cwd, file));
	const pattern = match ? new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : null;
	return files
		.filter((file) => findServerForFile(file, context.manager.resolved.servers) !== null)
		.filter((file) => !pattern || pattern.test(file))
		.slice(0, MAX_WORKSPACE_FILES);
}

export async function runDiagnosticsAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	const allFiles = file === '*' || file.includes('*');
	const files = allFiles ? await workspaceFiles(context) : [resolve(file)];

	if (files.length === 0) {
		return { text: 'No matching files with a configured LSP server.', details: { action: 'diagnostics', success: true, count: 0 } };
	}

	if (files.length === 1) {
		const result = await context.manager.diagnostics(files[0], context.signal);
		return {
			text: formatDiagnostics(result.diagnostics, context.cwd, allFiles ? files[0] : undefined),
			details: {
				action: 'diagnostics',
				server: result.server,
				source: result.source,
				success: true,
				count: result.diagnostics.length,
			},
		};
	}

	const results = await context.manager.workspaceDiagnostics(files, context.signal);
	const text = results.length === 0
		? `No diagnostics across ${files.length} files.`
		: results.map((entry) => `${entry.file}\n${formatDiagnostics(entry.diagnostics, context.cwd)}`).join('\n\n');
	return {
		text,
		details: { action: 'diagnostics', success: true, files: files.length, count: results.reduce((total, entry) => total + entry.diagnostics.length, 0) },
	};
}
