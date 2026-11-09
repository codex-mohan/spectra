import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async () => {
	const actual = await vi.importActual<typeof import('react')>('react');
	return {
		...actual,
		useEffect: () => {},
		useMemo: (factory: () => unknown) => factory(),
		useRef: (current: unknown) => ({ current }),
		useState: (value: unknown) => [typeof value === 'function' ? (value as () => unknown)() : value, () => {}],
	};
});
vi.mock('@opentui/core', () => ({ SyntaxStyle: {} }));
vi.mock('../tui/theme.js', async () => import('../tui/tokens.js'));
vi.mock('../tui/components/toast.js', () => ({ showToast: () => {} }));

import { SettingsDialog } from '../tui/ui/settings-dialog.js';

function collectText(node: any, found: string[] = []): string[] {
	if (!node || typeof node !== 'object') {
		if (typeof node === 'string') found.push(node);
		return found;
	}
	if (Array.isArray(node)) {
		for (const child of node) collectText(child, found);
		return found;
	}
	const children = node.props?.children;
	for (const child of Array.isArray(children) ? children : [children]) collectText(child, found);
	return found;
}

describe('SettingsDialog', () => {
	it('renders ten tabs and the appearance settings', () => {
		const tree = SettingsDialog({ onClose: () => {}, termWidth: 120, termHeight: 40 });
		const text = collectText(tree).join(' ').replace(/\s+/g, ' ');
		expect(text).toContain('Settings');
		expect(text).toContain('Theme');
		for (const label of ['Theme', 'Model', 'Interaction', 'Context', 'Memory', 'Files', 'Shell', 'Tools', 'Tasks', 'Providers']) {
			expect(text).toContain(label);
		}
	});

	it('opens on a deep-linked tab in sidebar layout', () => {
		const tree = SettingsDialog({ onClose: () => {}, termWidth: 120, termHeight: 40, defaultTab: 'tools' });
		const text = collectText(tree).join(' ').replace(/\s+/g, ' ');
		expect(text).toContain('Settings');
		expect(text).toContain('Tools');
	});

	it('uses top tabs on a narrow viewport', () => {
		const tree = SettingsDialog({ onClose: () => {}, termWidth: 70, termHeight: 18, defaultTab: 'model' });
		const text = collectText(tree).join(' ').replace(/\s+/g, ' ');
		expect(text).toContain('Model');
		expect(text).toContain('Settings');
	});
});
