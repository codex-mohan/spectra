import { pathToFileURL } from 'url';
import { formatDocumentSymbols, formatHover, formatLocation, formatWorkspaceSymbols, normalizeLocations } from '../format.js';
import type { DocumentSymbol, SymbolInformation } from '../protocol.js';
import { resolvePosition } from './position.js';
import { requireFile, type ActionContext, type ActionResult } from './types.js';

const POSITION_METHODS: Record<string, string> = {
	definition: 'textDocument/definition',
	type_definition: 'textDocument/typeDefinition',
	implementation: 'textDocument/implementation',
	references: 'textDocument/references',
	hover: 'textDocument/hover',
};

export async function runNavigationAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	const method = POSITION_METHODS[context.args.action];
	const position = resolvePosition(file, context.args.line, context.args.symbol);
	const params: Record<string, unknown> = {
		textDocument: { uri: pathToFileURL(file).toString() },
		position,
	};
	if (context.args.action === 'references') params.context = { includeDeclaration: true };

	const { result, managed } = await context.manager.request(file, method, params, context.signal);
	const details = { action: context.args.action, server: managed.serverId, success: true };

	if (context.args.action === 'hover') {
		return { text: formatHover(result), details };
	}

	const locations = normalizeLocations(result);
	if (locations.length === 0) {
		return { text: 'No locations found.', details: { ...details, success: false } };
	}
	const text = locations.map((location) => formatLocation(location, context.cwd)).join('\n');
	return { text, details: { ...details, count: locations.length } };
}

export async function runSymbolsAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	const uri = pathToFileURL(file).toString();

	if (context.args.query) {
		const { result, managed } = await context.manager.request(file, 'workspace/symbol', { query: context.args.query }, context.signal);
		const symbols = Array.isArray(result) ? (result as SymbolInformation[]) : [];
		return {
			text: formatWorkspaceSymbols(symbols, context.cwd),
			details: { action: 'symbols', server: managed.serverId, success: true, count: symbols.length },
		};
	}

	const { result, managed } = await context.manager.request(file, 'textDocument/documentSymbol', {
		textDocument: { uri },
	}, context.signal);
	const symbols = Array.isArray(result) ? (result as DocumentSymbol[]) : [];
	return {
		text: formatDocumentSymbols(symbols, context.cwd, uri),
		details: { action: 'symbols', server: managed.serverId, success: true, count: symbols.length },
	};
}
