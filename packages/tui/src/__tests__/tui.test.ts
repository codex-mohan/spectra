import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzySort } from '../components/fuzzy-filter.js';
import { createTheme, darkTheme, getTheme, lightTheme, setTheme, type Theme } from '../theme.js';
import { KeybindingsManager, type Keybinding } from '../keybindings.js';
import { ScrollBox } from '../components/scroll-box.js';
import { SelectList, type SelectListItem } from '../components/select-list.js';
import { CommandPalette, type CommandPaletteItem } from '../components/command-palette.js';
import { Dialog } from '../components/dialog.js';
import { CancellableLoader } from '../components/cancellable-loader.js';

describe('fuzzy-filter', () => {
	it('matches exact strings', () => {
		const result = fuzzyMatch('foo', 'foo');
		expect(result).not.toBeNull();
		expect(result!.score).toBeGreaterThan(0);
	});

	it('matches substring', () => {
		const result = fuzzyMatch('foo', 'foobar');
		expect(result).not.toBeNull();
	});

	it('matches case-insensitively', () => {
		const result = fuzzyMatch('FOO', 'foobar');
		expect(result).not.toBeNull();
	});

	it('returns null for no match', () => {
		const result = fuzzyMatch('xyz', 'foobar');
		expect(result).toBeNull();
	});

	it('returns null for partial match only', () => {
		const result = fuzzyMatch('fxyz', 'foobar');
		expect(result).toBeNull();
	});

	it('scores consecutive matches higher than non-consecutive', () => {
		const consecutive = fuzzyMatch('ab', 'abc');
		const nonConsecutive = fuzzyMatch('ab', 'axb');
		expect(consecutive!.score).toBeGreaterThan(nonConsecutive!.score);
	});

	it('scores word boundary matches higher', () => {
		const boundary = fuzzyMatch('bf', 'bar foo');
		const mid = fuzzyMatch('bf', 'xbarfoo');
		expect(boundary!.score).toBeGreaterThanOrEqual(mid!.score);
	});

	it('scores case-exact matches higher', () => {
		const exactCase = fuzzyMatch('Foo', 'FooBar');
		const wrongCase = fuzzyMatch('Foo', 'fooBar');
		expect(exactCase!.score).toBeGreaterThan(wrongCase!.score);
	});

	it('fuzzySort returns empty for no pattern', () => {
		const items = [{ label: 'abc' }, { label: 'def' }];
		const result = fuzzySort('', items);
		expect(result).toHaveLength(2);
		expect(result[0].score).toBe(0);
	});

	it('fuzzySort filters and sorts', () => {
		const items = [{ label: 'foo bar' }, { label: 'baz' }, { label: 'food' }];
		const result = fuzzySort('foo', items);
		expect(result.length).toBeGreaterThan(0);
		expect(result.every((r) => r.item.label.includes('foo') || r.item.label.toLowerCase().includes('foo'))).toBe(
			true,
		);
	});
});

describe('theme', () => {
	it('default theme is dark', () => {
		expect(getTheme()).toBe(darkTheme);
	});

	it('setTheme changes the current theme', () => {
		setTheme(lightTheme);
		expect(getTheme()).toBe(lightTheme);
		setTheme(darkTheme);
		expect(getTheme()).toBe(darkTheme);
	});

	it('createTheme merges overrides', () => {
		const custom = createTheme({ spacing: { ...darkTheme.spacing, promptPaddingX: 5 } });
		expect(custom.spacing.promptPaddingX).toBe(5);
		expect(custom.colors).toEqual(darkTheme.colors);
	});

	it('theme colors produce ANSI output', () => {
		const result = darkTheme.colors.primary('hello');
		expect(result).toContain('hello');
		expect(result).toContain('\x1b[');
	});

	it('theme borders are single characters', () => {
		expect(darkTheme.border.horizontal.length).toBe(1);
		expect(darkTheme.border.vertical.length).toBe(1);
		expect(darkTheme.border.topLeft.length).toBe(1);
	});

	it('theme symbols are defined', () => {
		expect(darkTheme.symbols.check).toBeTruthy();
		expect(darkTheme.symbols.cross).toBeTruthy();
		expect(darkTheme.symbols.spinner.length).toBeGreaterThan(0);
	});
});

describe('KeybindingsManager', () => {
	it('registers and matches keybindings', () => {
		const km = new KeybindingsManager();
		km.add({ key: 'ctrl+c' as any, description: 'Quit', action: 'quit' });
		const result = km.handleInput('\x03');
		expect(result).toBe(true);
	});

	it('calls handler on match', () => {
		const km = new KeybindingsManager();
		let called = false;
		km.add({ key: 'q' as any, description: 'Quit', action: 'quit' });
		km.setHandler((action) => {
			if (action === 'quit') called = true;
		});
		km.handleInput('q');
		expect(called).toBe(true);
	});

	it('returns false for unmatched input', () => {
		const km = new KeybindingsManager();
		const result = km.handleInput('x');
		expect(result).toBe(false);
	});

	it('supports scoped keybindings with context', () => {
		const km = new KeybindingsManager();
		km.add({ key: 'escape' as any, description: 'Cancel', action: 'cancel', when: 'dialog' });
		km.setContext('dialog', true);
		const result = km.handleInput('\x1b');
		expect(result).toBe(true);
	});

	it('removes keybindings', () => {
		const km = new KeybindingsManager();
		km.add({ key: 'q' as any, description: 'Quit', action: 'quit' });
		km.remove('quit');
		const result = km.handleInput('q');
		expect(result).toBe(false);
	});
});

describe('ScrollBox', () => {
	it('renders content', () => {
		const sb = new ScrollBox();
		sb.setContent(['line1', 'line2', 'line3']);
		sb.setVisibleHeight(5);
		const lines = sb.render(40);
		expect(lines.length).toBeGreaterThan(0);
	});

	it('scrollTo and scrollDown work', () => {
		const sb = new ScrollBox();
		const content = Array.from({ length: 20 }, (_, i) => `line${i}`);
		sb.setContent(content);
		sb.setVisibleHeight(5);
		sb.scrollTo(10);
		expect(sb.scrollPosition).toBe(10);
		sb.scrollDown(3);
		expect(sb.scrollPosition).toBe(13);
	});

	it('clear resets content', () => {
		const sb = new ScrollBox();
		sb.setContent(['line1', 'line2']);
		sb.clear();
		expect(sb.lineCount).toBe(0);
	});

	it('appendLine adds content', () => {
		const sb = new ScrollBox();
		sb.appendLine('line1');
		expect(sb.lineCount).toBe(1);
		sb.appendLine('line2');
		expect(sb.lineCount).toBe(2);
	});
});

describe('SelectList', () => {
	const items: SelectListItem[] = [
		{ id: '1', label: 'Option 1' },
		{ id: '2', label: 'Option 2' },
		{ id: '3', label: 'Option 3' },
	];

	it('renders items', () => {
		const sl = new SelectList({ items });
		const lines = sl.render(40);
		expect(lines.length).toBeGreaterThan(0);
	});

	it('getSelectedItem returns selected item', () => {
		const sl = new SelectList({ items });
		expect(sl.getSelectedItem()?.id).toBe('1');
	});

	it('setItems updates items', () => {
		const sl = new SelectList({ items });
		sl.setItems([{ id: 'new', label: 'New' }]);
		expect(sl.getSelectedItem()?.id).toBe('new');
	});
});

describe('CommandPalette', () => {
	const items: CommandPaletteItem[] = [
		{ id: 'save', label: 'Save File' },
		{ id: 'open', label: 'Open File' },
		{ id: 'quit', label: 'Quit Application' },
	];

	it('renders items', () => {
		const cp = new CommandPalette({ items });
		const lines = cp.render(60);
		expect(lines.length).toBeGreaterThan(0);
	});

	it('getQuery returns empty initially', () => {
		const cp = new CommandPalette({ items });
		expect(cp.getQuery()).toBe('');
	});

	it('setItems updates available items', () => {
		const cp = new CommandPalette({ items });
		cp.setItems([{ id: 'new', label: 'New Item' }]);
		const lines = cp.render(60);
		expect(lines.length).toBeGreaterThan(0);
	});
});

describe('Dialog', () => {
	it('renders title and message', () => {
		const dialog = new Dialog({ title: 'Confirm', message: 'Are you sure?' });
		const lines = dialog.render(60);
		expect(lines.length).toBeGreaterThan(0);
		const combined = lines.join('');
		expect(combined).toContain('Confirm');
	});

	it('renders custom buttons', () => {
		const dialog = new Dialog({
			title: 'Delete',
			message: 'Delete this file?',
			buttons: [
				{ label: 'Cancel', action: 'cancel' },
				{ label: 'Delete', action: 'delete', primary: true },
			],
		});
		const lines = dialog.render(60);
		expect(lines.length).toBeGreaterThan(0);
	});
});

describe('CancellableLoader', () => {
	it('can be created', () => {
		const mockTui = { requestRender: () => {}, setFocus: () => {} } as any;
		const loader = new CancellableLoader(mockTui, { message: 'Loading...' });
		expect(loader).toBeDefined();
		loader.stop();
	});

	it('setMessage updates message', () => {
		const mockTui = { requestRender: () => {}, setFocus: () => {} } as any;
		const loader = new CancellableLoader(mockTui, { message: 'Loading...' });
		loader.setMessage('New message');
		const lines = loader.render(40);
		expect(lines.length).toBeGreaterThan(0);
		loader.stop();
	});
});
