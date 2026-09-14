import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';
import { menuColumns, truncateMenuText } from '../tui/utils/menu-text.js';

describe('menu end truncation', () => {
	it('reserves the same compact description column for short and long titles', () => {
		for (const title of ['/new', '/delete-session Delete Session']) {
			const row = menuColumns(66, title, 'Review the working tree and create a commit');
			expect(row.detailWidth).toBe(40);
			expect(row.titleWidth).toBe(25);
			expect(row.detail.endsWith('...')).toBe(true);
		}
		expect(menuColumns(30, '/new', 'Start fresh').detailWidth).toBe(19);
	});
	it('keeps the beginning and appends dots without retaining the end', () => {
		expect(truncateMenuText('description start and content end', 20)).toBe('description start...');
		expect(truncateMenuText('short', 5)).toBe('short');
	});
	it('handles wide characters, emoji and combining marks by display width', () => {
		for (const value of ['文件名称很长的菜单内容', '👩‍💻 developer tools and settings', 'e\u0301'.repeat(25)]) {
			for (let width = 0; width < 35; width++) {
				const result = truncateMenuText(value, width);
				expect(stringWidth(result)).toBeLessThanOrEqual(width);
				if (stringWidth(value) > width && width >= 3) expect(result.endsWith('...')).toBe(true);
			}
		}
	});
	it('keeps control sequences and newlines out of the row', () => {
		expect(truncateMenuText('\x1b[31mhello\x1b[0m\nworld', 30)).toBe('hello world');
	});
	it('budgets both columns inside the row, including their gap', () => {
		for (let width = 0; width <= 120; width++) {
			const row = menuColumns(width, '/very-long-command-name', 'An extremely long description ending in hidden content');
			expect(row.titleWidth + row.detailWidth + (row.detailWidth > 0 ? 1 : 0)).toBeLessThanOrEqual(width);
			expect(stringWidth(row.title)).toBeLessThanOrEqual(row.titleWidth);
			expect(stringWidth(row.detail)).toBeLessThanOrEqual(row.detailWidth);
		}
	});
});
