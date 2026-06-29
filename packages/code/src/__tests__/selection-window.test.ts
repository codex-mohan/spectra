import { describe, expect, test } from 'vitest';
import { getCenteredWindow } from '../tui/utils/selection-window.js';

describe('getCenteredWindow', () => {
	test('keeps the selected row centered until list edges', () => {
		const starts = Array.from({ length: 10 }, (_, selected) => getCenteredWindow(10, selected, 5).start);
		expect(starts).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 5, 5]);
	});

	test('clamps empty and out-of-range input', () => {
		expect(getCenteredWindow(0, 4, 5)).toEqual({ start: 0, end: 0 });
		expect(getCenteredWindow(3, 99, 5)).toEqual({ start: 0, end: 3 });
		expect(getCenteredWindow(10, -4, 5)).toEqual({ start: 0, end: 5 });
	});
});
