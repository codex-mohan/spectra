import { relative, sep } from 'path';
import { fileURLToPath } from 'url';
import type { Diagnostic, DocumentSymbol, Hover, Location, LocationLink, SymbolInformation } from './protocol.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function displayPath(uri: string, cwd = process.cwd()): string {
	try {
		const path = fileURLToPath(uri);
		return (relative(cwd, path) || path).split(sep).join('/');
	} catch {
		return uri;
	}
}

export function formatLocation(location: Location | LocationLink, cwd = process.cwd()): string {
	if ('targetUri' in location) {
		const range = location.targetSelectionRange ?? location.targetRange;
		return `${displayPath(location.targetUri, cwd)}:${range.start.line + 1}:${range.start.character + 1}`;
	}
	return `${displayPath(location.uri, cwd)}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
}

export function normalizeLocations(result: unknown): Array<Location | LocationLink> {
	if (!result) return [];
	if (Array.isArray(result)) return result.filter((item): item is Location | LocationLink => isRecord(item));
	if (isRecord(result)) return [result as unknown as Location];
	return [];
}

export function formatDiagnostics(diagnostics: Diagnostic[], cwd = process.cwd(), file?: string): string {
	if (diagnostics.length === 0) return 'No diagnostics.';
	const severity = ['error', 'warning', 'info', 'hint'];
	return diagnostics.map((diagnostic) => {
		const level = severity[(diagnostic.severity ?? 1) - 1] ?? 'error';
		const location = file ? `${file}:` : '';
		const source = diagnostic.source ? ` [${diagnostic.source}]` : '';
		const code = diagnostic.code !== undefined ? ` (${diagnostic.code})` : '';
		return `${location}${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} ${level}: ${diagnostic.message}${source}${code}`;
	}).join('\n');
}

export function formatHover(result: unknown): string {
	if (!isRecord(result)) return 'No hover information.';
	const contents = result.contents;
	if (typeof contents === 'string') return contents;
	if (Array.isArray(contents)) {
		return contents.map((part) => (isRecord(part) && typeof part.value === 'string' ? part.value : String(part))).join('\n');
	}
	if (isRecord(contents) && typeof contents.value === 'string') return contents.value;
	return 'No hover information.';
}

function symbolKind(kind: number): string {
	const kinds = ['file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null', 'enum member', 'struct', 'event', 'operator', 'type parameter'];
	return kinds[kind - 1] ?? 'symbol';
}

export function formatDocumentSymbols(symbols: DocumentSymbol[], cwd = process.cwd(), uri?: string): string {
	const lines: string[] = [];
	const walk = (items: DocumentSymbol[], depth: number) => {
		for (const item of items) {
			const location = uri ? `${displayPath(uri, cwd)}:${item.selectionRange.start.line + 1}:${item.selectionRange.start.character + 1}` : '';
			lines.push(`${'  '.repeat(depth)}${item.name} (${symbolKind(item.kind)})${location ? ` ${location}` : ''}`);
			if (item.children) walk(item.children, depth + 1);
		}
	};
	walk(symbols, 0);
	return lines.length > 0 ? lines.join('\n') : 'No symbols.';
}

export function formatWorkspaceSymbols(symbols: SymbolInformation[], cwd = process.cwd()): string {
	if (symbols.length === 0) return 'No symbols.';
	return symbols
		.slice(0, 100)
		.map((symbol) => `${symbol.name} (${symbolKind(symbol.kind)}) ${formatLocation(symbol.location, cwd)}`)
		.join('\n');
}

export function formatCodeActions(actions: unknown[]): string {
	if (actions.length === 0) return 'No code actions.';
	return actions.map((action, index) => {
		if (!isRecord(action)) return `${index + 1}. <invalid action>`;
		const title = typeof action.title === 'string' ? action.title : '<untitled>';
		const kind = typeof action.kind === 'string' ? ` [${action.kind}]` : '';
		const hasEdit = isRecord(action.edit) ? ' (edit)' : '';
		return `${index + 1}. ${title}${kind}${hasEdit}`;
	}).join('\n');
}
