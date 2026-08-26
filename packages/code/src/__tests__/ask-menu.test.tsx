import { describe, expect, it } from 'vitest';
import type { AskQuestion } from '../tools/ask.js';
import { buildAskDetails, getInitialAskCursor, toggleAskSelection } from '../tui/ui/ask-menu-state.js';

const questions: AskQuestion[] = [
	{
		id: 'storage',
		question: 'Which storage backend?',
		options: [{ label: 'PostgreSQL' }, { label: 'SQLite' }],
		recommended: 1,
	},
	{
		id: 'features',
		question: 'Which features?',
		options: [{ label: 'Search' }, { label: 'Export' }],
		multi: true,
	},
];

describe('AskMenu state', () => {
	it('starts on the recommended option and restores prior answers', () => {
		expect(getInitialAskCursor(questions[0]!, { selected: [] })).toBe(1);
		expect(getInitialAskCursor(questions[0]!, { selected: [0] })).toBe(0);
		expect(getInitialAskCursor(questions[1]!, { selected: [], customInput: 'Other' })).toBe(3);
	});

	it('toggles multi-select answers in option order', () => {
		let selected = toggleAskSelection([], 1);
		selected = toggleAskSelection(selected, 0);
		expect(selected).toEqual([0, 1]);
		expect(toggleAskSelection(selected, 0)).toEqual([1]);
	});

	it('builds structured results for selections and custom answers', () => {
		expect(buildAskDetails(questions, [
			{ selected: [1] },
			{ selected: [0, 1], customInput: 'Audit logs' },
		])).toEqual({
			results: [
				{
					id: 'storage',
					question: 'Which storage backend?',
					options: ['PostgreSQL', 'SQLite'],
					multi: false,
					selectedOptions: ['SQLite'],
				},
				{
					id: 'features',
					question: 'Which features?',
					options: ['Search', 'Export'],
					multi: true,
					selectedOptions: ['Search', 'Export'],
					customInput: 'Audit logs',
				},
			],
		});
	});
});
