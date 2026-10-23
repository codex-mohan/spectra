import { describe, expect, it } from 'vitest';
import { findAtTrigger } from '../tui/utils/prompt-triggers.js';
import { slashTokenAt } from '../tui/slash-commands.js';

describe('@ mention triggers', () => {
	it('triggers at the end of the prompt', () => {
		expect(findAtTrigger('read @src/ma')).toEqual({
			start: 5,
			end: 12,
			query: 'src/ma',
			range: undefined,
		});
	});

	it('triggers mid-prompt at the caret position', () => {
		const text = 'read @src/main.ts and summarize';
		expect(findAtTrigger(text, 'read @src/main.ts'.length)).toEqual({
			start: 5,
			end: 17,
			query: 'src/main.ts',
			range: undefined,
		});
	});

	it('keeps mentioning when text follows the caret', () => {
		const text = '@a then @src/mo rest';
		const cursor = '@a then @src/mo'.length;
		expect(findAtTrigger(text, cursor)?.query).toBe('src/mo');
	});

	it('ignores @ inside a word', () => {
		expect(findAtTrigger('mail user@host now')).toBeNull();
	});

	it('parses an explicit line range', () => {
		expect(findAtTrigger('@src/main.ts#10-20')?.range).toEqual({ start: 10, end: 20 });
	});
});

describe('mid-text slash tokens', () => {
	it('finds a slash token after whitespace', () => {
		expect(slashTokenAt('use /brain now', 'use /brain'.length)).toEqual({
			start: 4,
			end: 10,
			query: 'brain',
		});
	});

	it('does not treat the leading slash as a mid-text token', () => {
		expect(slashTokenAt('/brain', '/brain'.length)).toBeUndefined();
	});

	it('stops matching once whitespace follows the token', () => {
		expect(slashTokenAt('use /brain now', 'use /brain '.length)).toBeUndefined();
	});

	it('does not match slashes glued to a word', () => {
		expect(slashTokenAt('path/to/file', 'path/to/file'.length)).toBeUndefined();
	});
});
