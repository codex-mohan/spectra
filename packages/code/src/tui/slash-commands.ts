export interface SlashHead {
	name: string;
	arguments: string;
	end: number;
}

export interface ParsedSlashCommand {
	type: 'command';
	command: { name: string; arguments: string };
}

export interface ParsedSlashNone {
	type: 'none';
}

export type ParsedSlash = ParsedSlashCommand | ParsedSlashNone;

export interface SlashToken {
	/** Absolute index of the `/` in the draft text. */
	start: number;
	/** Cursor position that ends the token. */
	end: number;
	query: string;
}

/**
 * Find a `/token` at the cursor that is *not* at the start of the prompt.
 * Front-of-prompt slash input is handled by {@link slashHead}; this covers
 * mid-sentence references, where only skills are offered.
 */
export function slashTokenAt(text: string, cursor: number): SlashToken | undefined {
	const before = text.slice(0, cursor);
	const match = /(^|\s)\/([^\s]*)$/.exec(before);
	if (!match) return undefined;
	const query = match[2] ?? '';
	const start = before.length - query.length - 1;
	if (start === 0) return undefined;
	return { start, end: cursor, query };
}

export function slashHead(text: string): SlashHead | undefined {
	if (!text.startsWith('/')) return;
	for (let i = 1; i < text.length; i++) {
		switch (text[i]) {
			case ' ':
			case '\t':
			case '\n':
				return { name: text.slice(1, i), arguments: text.slice(i + 1), end: i };
		}
	}
	return { name: text.slice(1), arguments: '', end: text.length };
}

export function slashQuery(text: string, cursor: number): string | undefined {
	const head = slashHead(text.slice(0, cursor));
	if (!head || head.end !== cursor) return;
	return head.name;
}

export function parseSlashCommand(text: string, commands: ReadonlySet<string> | undefined): ParsedSlash {
	const head = slashHead(text);
	if (!head || head.name.length === 0) return { type: 'none' };
	if (!commands) return { type: 'none' };
	if (!commands.has(head.name)) return { type: 'none' };
	return { type: 'command', command: { name: head.name, arguments: head.arguments } };
}
