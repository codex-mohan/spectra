const RANGE_CHUNK_SOURCE = String.raw`L?\d+(?:(?:[-+]|\.\.)L?\d+|-|\.\.)?`;
const RANGE_LIST_SOURCE = `${RANGE_CHUNK_SOURCE}(?:,${RANGE_CHUNK_SOURCE})*`;
const SELECTOR_PATTERN = new RegExp(`^(?:${RANGE_LIST_SOURCE}|raw|conflicts)$`, 'i');
const INTERNAL_URL = /^([a-z][a-z0-9+.-]*):\/\//i;
const OPAQUE_SCHEMES: Record<string, true> = { mcp: true };

export interface LineRange {
	startLine: number;
	endLine?: number;
}

export type ReadSelector =
	| { kind: 'raw' }
	| { kind: 'conflicts' }
	| { kind: 'lines'; ranges: LineRange[] };

export interface SplitReadTarget {
	target: string;
	selector?: ReadSelector;
	opaqueFallback?: { target: string; selector: ReadSelector };
}

function parsePositiveInteger(value: string, selector: string): number {
	const normalized = value.replace(/^L/i, '');
	const parsed = Number(normalized);
	if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid read selector: ${selector}`);
	return parsed;
}

function parseRangeChunk(chunk: string, selector: string): LineRange {
	const normalized = chunk.replace(/\.\./g, '-');
	const plus = /^(L?\d+)\+(L?\d+)$/i.exec(normalized);
	if (plus) {
		const startLine = parsePositiveInteger(plus[1], selector);
		const count = parsePositiveInteger(plus[2], selector);
		return { startLine, endLine: startLine + count - 1 };
	}
	const closed = /^(L?\d+)-(L?\d+)$/i.exec(normalized);
	if (closed) {
		const startLine = parsePositiveInteger(closed[1], selector);
		const endLine = parsePositiveInteger(closed[2], selector);
		if (endLine < startLine) throw new Error(`Invalid descending read selector: ${selector}`);
		return { startLine, endLine };
	}
	const open = /^(L?\d+)-$/i.exec(normalized);
	if (open) return { startLine: parsePositiveInteger(open[1], selector) };
	return { startLine: parsePositiveInteger(normalized, selector), endLine: parsePositiveInteger(normalized, selector) };
}

export function parseReadSelector(value: string): ReadSelector {
	if (!SELECTOR_PATTERN.test(value)) throw new Error(`Invalid read selector: ${value}`);
	if (/^raw$/i.test(value)) return { kind: 'raw' };
	if (/^conflicts$/i.test(value)) return { kind: 'conflicts' };
	return { kind: 'lines', ranges: value.split(',').map((chunk) => parseRangeChunk(chunk, value)) };
}

function trailingSelector(input: string): { target: string; selector: ReadSelector } | undefined {
	for (let index = input.length - 1; index >= 0; index--) {
		if (input[index] !== ':') continue;
		const suffix = input.slice(index + 1);
		if (!SELECTOR_PATTERN.test(suffix)) continue;
		const target = input.slice(0, index);
		if (/^[A-Za-z]$/.test(target)) continue;
		return { target, selector: parseReadSelector(suffix) };
	}
	return undefined;
}

export function splitReadTarget(input: string): SplitReadTarget {
	const match = INTERNAL_URL.exec(input);
	const split = trailingSelector(input);
	if (!split) return { target: input };
	if (!match) return split;
	const scheme = match[1].toLowerCase();
	if (scheme === 'ssh') {
		const authorityEnd = input.indexOf('/', match[0].length);
		if (authorityEnd === -1 || split.target.length < authorityEnd) return { target: input };
	}
	if (OPAQUE_SCHEMES[scheme]) return { target: input, opaqueFallback: split };
	return split;
}

export function materializeRanges(selector: ReadSelector | undefined, lineCount: number, offset?: number, limit?: number): Array<{ start: number; end: number }> {
	if (selector?.kind === 'lines') {
		return selector.ranges.map((range) => ({ start: range.startLine, end: Math.min(lineCount, range.endLine ?? lineCount) }));
	}
	const start = offset ?? 1;
	const end = limit === undefined ? lineCount : Math.min(lineCount, start + limit - 1);
	return end >= start ? [{ start, end }] : [];
}
