export interface AtTrigger {
	/** Absolute index of the `@` in the draft text. */
	start: number;
	/** Cursor position that ends the mention token. */
	end: number;
	query: string;
	range?: { start: number; end: number };
}

/**
 * Find the `@` mention at the cursor. A mention starts at the beginning of the
 * text or after whitespace and runs to the cursor, so `@` works anywhere in the
 * prompt — mid-sentence included — rather than only at the end of the input.
 */
export function findAtTrigger(text: string, cursor = text.length): AtTrigger | null {
	const before = text.slice(0, cursor);
	const match = /(^|\s)@([^\s]*)$/.exec(before);
	if (!match) return null;
	const token = match[2] ?? '';
	const start = before.length - token.length - 1;
	const [queryPart, rangePart] = token.split('#', 2);
	return {
		start,
		end: cursor,
		query: (queryPart ?? '').toLowerCase(),
		range: parseLineRange(rangePart),
	};
}

function parseLineRange(value: string | undefined): { start: number; end: number } | undefined {
	if (!value) return undefined;
	const match = /^(\d+)(?:-(\d+))?$/.exec(value);
	if (!match) return undefined;
	const start = Number(match[1]);
	const end = Number(match[2] ?? match[1]);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return undefined;
	return { start, end };
}
