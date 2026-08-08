import { describe, expect, it, vi } from 'vitest';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { getToolStreamingDisplay } from '../tools/index.js';
import { isRecord, parseToolArguments, toolResultText } from '../tui/live-tool-streaming.js';
import { MessageView } from '../tui/components/message.js';

vi.mock('@opentui/core', () => ({
	RGBA: { fromHex: (color: string) => color },
	SyntaxStyle: { fromStyles: (styles: unknown) => styles },
}));

function findIntrinsic(node: ReactNode, type: string): ReactElement<unknown>[] {
	if (!isValidElement(node)) return [];
	const matches = typeof node.type === 'string' && node.type === type ? [node] : [];
	if (!isRecord(node.props) || !('children' in node.props)) return matches;
	return Children.toArray(node.props.children).reduce<ReactElement<unknown>[]>(
		(found, child) => [...found, ...findIntrinsic(child, type)],
		matches,
	);
}

function elementProps(element: ReactElement<unknown>): Record<string, unknown> {
	return isRecord(element.props) ? element.props : {};
}

describe('live tool streaming', () => {
	it('recovers partial write content while JSON arguments are incomplete', () => {
		const args = parseToolArguments(
			'{"path":"src/example.ts","content":"export const answer =',
			{},
		);

		expect(args).toEqual({
			path: 'src/example.ts',
			content: 'export const answer =',
		});
	});

	it('recovers partial edit match and replacement content', () => {
		const args = parseToolArguments(
			'{"path":"src/example.ts","oldString":"const oldValue = 1;","newString":"const newValue',
			{},
		);

		expect(args).toEqual({
			path: 'src/example.ts',
			oldString: 'const oldValue = 1;',
			newString: 'const newValue',
		});
	});

	it('falls back safely when a fragment cannot form an object', () => {
		const fallback = { path: 'src/fallback.ts' };
		expect(parseToolArguments('not-json', fallback)).toBe(fallback);
	});

	it('joins streamed text blocks and ignores unsupported result content', () => {
		expect(toolResultText([
			{ type: 'text', text: 'stdout' },
			{ type: 'image', data: 'ignored' },
			{ type: 'text', text: 'stderr' },
		])).toBe('stdout\nstderr');
	});

	it('opts in only tools with useful live displays', () => {
		expect(getToolStreamingDisplay('edit')).toEqual({ arguments: true });
		expect(getToolStreamingDisplay('write')).toEqual({ arguments: true });
		expect(getToolStreamingDisplay('bash')).toEqual({ arguments: true, output: true });
		expect(getToolStreamingDisplay('read')).toBeUndefined();
	});

	it('renders partial write content through the streaming code view', () => {
		const view = MessageView({
			msg: {
				id: 'write-1',
				role: 'tool',
				content: '',
				streaming: true,
				toolName: 'write',
				toolCallId: 'write-1',
				toolArguments: { path: 'src/example.ts', content: 'export const answer =' },
				toolArgumentsComplete: false,
			},
		});
		const code = findIntrinsic(view, 'code');

		expect(code).toHaveLength(1);
		expect(elementProps(code[0])).toMatchObject({
			content: 'export const answer =',
			filetype: 'typescript',
			streaming: true,
		});
	});

	it('renders partial edit match and replacement as streaming code', () => {
		const view = MessageView({
			msg: {
				id: 'edit-1',
				role: 'tool',
				content: '',
				streaming: true,
				toolName: 'edit',
				toolCallId: 'edit-1',
				toolArguments: {
					path: 'src/example.ts',
					oldString: 'const oldValue = 1;',
					newString: 'const newValue',
				},
				toolArgumentsComplete: false,
			},
		});
		const code = findIntrinsic(view, 'code').map(elementProps);

		expect(code).toHaveLength(2);
		expect(code).toEqual(expect.arrayContaining([
			expect.objectContaining({ content: 'const oldValue = 1;', filetype: 'typescript', streaming: true }),
			expect.objectContaining({ content: 'const newValue', filetype: 'typescript', streaming: true }),
		]));
	});
});
