import { describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
	useRef: (current: unknown) => ({ current }),
	useCallback: (fn: unknown) => fn,
	useEffect: () => {},
	useState: (value: unknown) => [value, () => {}],
}));
vi.mock('@opentui/core', () => ({ SyntaxStyle: {} }));
vi.mock('../tui/theme.js', async () => import('../tui/tokens.js'));

import { PromptBar } from '../tui/prompt-bar.js';

function findTextarea(node: any): any {
	if (!node || typeof node !== 'object') return undefined;
	if (node.type === 'textarea') return node.props;
	const children = node.props?.children;
	for (const child of Array.isArray(children) ? children : [children]) {
		const found = findTextarea(child);
		if (found) return found;
	}
}

describe('prompt submission lifecycle', () => {
	it.each([false, true])('cleans extmarks before synchronous destruction (attachment: %s)', (withAttachment) => {
		let destroyed = false;
		const attachment = { type: 'file', mime: 'text/plain', url: 'file:///example.txt', badge: { icon: '', label: 'example.txt', color: '#ffffff' } };
		let marks = withAttachment ? [{ id: 1, start: 0, end: 6 }] : [];
		const clear = vi.fn(() => {
			if (destroyed) throw new Error('EditBuffer is destroyed');
			marks = [];
		});
		const onSubmit = vi.fn(() => { destroyed = true; });
		const tree = PromptBar({
			isLoading: false, inputKey: 0, placeholder: 'Reply', onSubmit,
			hasModel: true, agent: 'build', model: 'model', provider: 'provider',
		});
		const input = findTextarea(tree);
		expect(input).toBeDefined();
		input.ref({ plainText: withAttachment ? '[file]  hello  ' : '  hello  ', extmarks: {
			getTypeId: () => withAttachment ? 1 : null,
			getAllForTypeId: () => [...marks],
			getMetadataFor: () => ({ attachment, text: '[file]' }),
			clear,
		} });
		expect(() => input.onSubmit()).not.toThrow();
		expect(clear).toHaveBeenCalledOnce();
		expect(onSubmit).toHaveBeenCalledWith({ text: 'hello', attachments: withAttachment ? [attachment] : [] });
		expect(destroyed).toBe(true);
	});
});
