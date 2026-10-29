/** 1-based editor line → 0-based LSP line. */
export function toLspLine(line: number): number {
	return Math.max(0, Math.floor(line) - 1);
}

/** Resolve a column for `symbol` on a line. Supports `name#N` occurrence selectors. */
export function resolveSymbolColumn(lineText: string, symbol: string): number | null {
	const hash = symbol.lastIndexOf('#');
	const hasOccurrence = hash > 0 && /^\d+$/.test(symbol.slice(hash + 1));
	const name = hasOccurrence ? symbol.slice(0, hash) : symbol;
	const occurrence = hasOccurrence ? Math.max(1, Number(symbol.slice(hash + 1))) : 1;
	if (!name) return null;

	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const identifier = /^[A-Za-z_$][\w$]*$/.test(name);
	const pattern = new RegExp(identifier ? `\\b${escaped}\\b` : escaped, 'g');
	let match: RegExpExecArray | null;
	let seen = 0;
	while ((match = pattern.exec(lineText)) !== null) {
		seen++;
		if (seen === occurrence) return match.index;
		if (pattern.lastIndex === match.index) pattern.lastIndex++;
	}
	return null;
}

export function offsetAt(text: string, line: number, character: number): number {
	let offset = 0;
	let currentLine = 0;
	while (currentLine < line && offset < text.length) {
		const next = text.indexOf('\n', offset);
		if (next < 0) return text.length;
		offset = next + 1;
		currentLine++;
	}
	return Math.min(text.length, offset + Math.max(0, character));
}

export function positionAt(text: string, offset: number): { line: number; character: number } {
	const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
	const lines = before.split('\n');
	return { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 };
}
