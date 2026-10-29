import { renameSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { applyWorkspaceEdits, extractWorkspaceEdits, previewWorkspaceEdits, type WorkspaceTextEdit } from '../edits.js';
import { formatCodeActions } from '../format.js';
import { resolvePosition } from './position.js';
import { requireFile, type ActionContext, type ActionResult } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validate(context: ActionContext) {
	return (path: string) => context.manager.validatePath(path);
}

export async function runRenameAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	if (!context.args.new_name) throw new Error('rename requires new_name');
	const position = resolvePosition(file, context.args.line, context.args.symbol);
	const { result, managed } = await context.manager.request(file, 'textDocument/rename', {
		textDocument: { uri: pathToFileURL(file).toString() },
		position,
		newName: context.args.new_name,
	}, context.signal);

	const edits = extractWorkspaceEdits(result);
	if (edits.length === 0) return { text: 'No edits returned by the server.', details: { action: 'rename', server: managed.serverId, success: false } };

	if (context.args.apply === true) {
		const applied = applyWorkspaceEdits(edits, validate(context));
		return {
			text: `Renamed in ${applied.files.length} file(s).\n\n${applied.preview}`,
			details: { action: 'rename', server: managed.serverId, success: true, files: applied.files },
		};
	}
	return {
		text: previewWorkspaceEdits(edits),
		details: { action: 'rename', server: managed.serverId, success: true, preview: true, files: edits.length },
	};
}

export async function runRenameFileAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	if (!context.args.new_name) throw new Error('rename_file requires new_name');
	const target = resolve(file, '..', context.args.new_name);
	const refusal = context.manager.validatePath(target);
	if (refusal) throw new Error(refusal);

	const managed = await context.manager.ensureClient(file);
	const oldUri = pathToFileURL(file).toString();
	const newUri = pathToFileURL(target).toString();

	let editText = '';
	try {
		const result = await managed.client.request('workspace/willRenameFiles', {
			files: [{ oldUri, newUri }],
		}, context.signal);
		const edits = extractWorkspaceEdits(result);
		if (edits.length > 0) {
			const applied = applyWorkspaceEdits(edits, validate(context));
			editText = `\n\n${applied.preview}`;
		}
	} catch {
		// Servers without willRenameFiles still get the filesystem move.
	}

	renameSync(file, target);
	managed.client.notify('workspace/didRenameFiles', { files: [{ oldUri, newUri }] });
	return {
		text: `Moved ${file} → ${target}${editText}`,
		details: { action: 'rename_file', server: managed.serverId, success: true, target },
	};
}

export async function runCodeActionsAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	const position = resolvePosition(file, context.args.line, context.args.symbol);
	const line = position.line;
	const uri = pathToFileURL(file).toString();
	const { result, managed } = await context.manager.request(file, 'textDocument/codeAction', {
		textDocument: { uri },
		range: { start: { line, character: 0 }, end: { line: line + 1, character: 0 } },
		context: { diagnostics: context.manager.peekDiagnostics(file) },
	}, context.signal);

	const actions = Array.isArray(result) ? result : [];
	if (context.args.apply !== true) {
		return {
			text: formatCodeActions(actions),
			details: { action: 'code_actions', server: managed.serverId, success: true, count: actions.length },
		};
	}

	const index = Math.max(1, Number(context.args.query) || 1) - 1;
	const action = actions[index];
	if (!isRecord(action)) throw new Error(`No code action at index ${index + 1}`);
	if (isRecord(action.edit)) {
		const edits = extractWorkspaceEdits(action.edit);
		const applied = applyWorkspaceEdits(edits, validate(context));
		return {
			text: `Applied "${String(action.title)}".\n\n${applied.preview}`,
			details: { action: 'code_actions', server: managed.serverId, success: true, applied: action.title },
		};
	}
	if (isRecord(action.command) && typeof action.command.command === 'string') {
		await managed.client.request('workspace/executeCommand', action.command, context.signal);
		return {
			text: `Executed "${action.command.command}".`,
			details: { action: 'code_actions', server: managed.serverId, success: true, executed: action.command.command },
		};
	}
	return { text: 'The selected code action has no edit or command.', details: { action: 'code_actions', server: managed.serverId, success: false } };
}

export async function runFormatAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	const { result, managed } = await context.manager.format(file, {}, context.signal);
	const edits: WorkspaceTextEdit[] = Array.isArray(result)
		? result.map((edit) => ({ path: file, range: (edit as { range: WorkspaceTextEdit['range'] }).range, newText: (edit as { newText: string }).newText }))
		: [];
	if (edits.length === 0) return { text: 'Already formatted.', details: { action: 'format', server: managed.serverId, success: true } };

	const applied = applyWorkspaceEdits(edits, validate(context));
	return {
		text: `Formatted ${file}.\n\n${applied.preview}`,
		details: { action: 'format', server: managed.serverId, success: true },
	};
}
