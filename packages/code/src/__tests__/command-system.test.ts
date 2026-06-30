import { describe, expect, test } from 'vitest';
import { executeCommand, type CmdItem } from '../tui/command-types.js';

describe('executeCommand', () => {
	test('passes source and args to command actions', async () => {
		let observed = '';
		const command: CmdItem = {
			id: 'probe',
			label: 'Probe',
			desc: 'captures args',
			action: ({ source, args }) => {
				observed = `${source}:${args}`;
			},
		};

		await executeCommand(command, { source: 'slash', args: 'alpha beta' });

		expect(observed).toBe('slash:alpha beta');
	});

	test('runs lifecycle hooks around the command action', async () => {
		const order: string[] = [];
		const command: CmdItem = {
			id: 'hooked',
			label: 'Hooked',
			desc: 'records hook order',
			beforeRun: () => {
				order.push('before');
			},
			action: () => {
				order.push('action');
			},
			afterRun: () => {
				order.push('after');
			},
		};

		await executeCommand(command, { source: 'palette', args: '' });

		expect(order).toEqual(['before', 'action', 'after']);
	});
});
