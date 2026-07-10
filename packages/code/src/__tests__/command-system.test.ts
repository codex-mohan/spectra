import { describe, expect, test } from 'vitest';
import { buildCommandRegistry, executeCommand, type CmdItem } from '../tui/command-types.js';
import { createRegistry, dispatch, type CommandDefinition } from '../command/index.js';
import { executeActions } from '../tui/command-action-executor.js';

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

describe('command registry', () => {
	test('keeps aliases resolvable without duplicating menu entries', () => {
		const commands: CmdItem[] = [
			{
				id: 'new',
				label: 'New',
				desc: 'start fresh',
				slashName: 'new',
				slashAliases: ['clear'],
				action: () => {},
			},
			{
				id: 'clear',
				label: 'Clear',
				desc: 'clear messages',
				slashName: 'clear',
				action: () => {},
			},
		];

		const registry = buildCommandRegistry(commands);

		expect(registry.entries.map((entry) => entry.invocation)).toEqual(['new', 'clear:2']);
		expect(registry.resolve('clear')?.definition.id).toBe('builtin:new');
		expect(registry.resolve('/CLEAR:2')?.definition.id).toBe('builtin:clear');
		expect([...registry.slashNames]).toEqual(['new', 'clear', 'clear:2']);
	});
});

describe('command dispatcher', () => {
	test('runs domain hooks around command execution', async () => {
		const order: string[] = [];
		const definition: CommandDefinition = {
			id: 'builtin:probe',
			name: 'probe',
			aliases: [],
			title: 'Probe',
			description: 'records order',
			source: 'builtin',
			execute: () => {
				order.push('execute');
			},
		};
		const registry = createRegistry([definition]);
		const resolved = registry.resolve('probe');
		expect(resolved).toBeDefined();

		await dispatch(resolved!, { source: 'slash', args: 'value', invocation: 'probe' }, {
			before: () => {
				order.push('before');
			},
			after: (_command, _context, result) => {
				order.push(result.ok ? 'after:ok' : 'after:error');
			},
		});

		expect(order).toEqual(['before', 'execute', 'after:ok']);
	});

	test('reports command failures to the after hook and rethrows', async () => {
		const definition: CommandDefinition = {
			id: 'builtin:failure',
			name: 'failure',
			aliases: [],
			title: 'Failure',
			description: 'throws',
			source: 'builtin',
			execute: () => {
				throw new Error('command failed');
			},
		};
		const resolved = createRegistry([definition]).resolve('failure');
		let afterStatus = '';

		await expect(dispatch(resolved!, { source: 'palette', args: '', invocation: 'failure' }, {
			after: (_command, _context, result) => {
				afterStatus = result.ok ? 'ok' : 'error';
			},
		})).rejects.toThrow('command failed');
		expect(afterStatus).toBe('error');
	});
});

describe('command actions', () => {
	test('normalizes dispatcher actions and applies them sequentially', async () => {
		const definition: CommandDefinition = {
			id: 'builtin:action-probe',
			name: 'action-probe',
			aliases: [],
			title: 'Action probe',
			description: 'returns application actions',
			source: 'builtin',
			execute: () => [
				{ type: 'submit_prompt', text: 'Review this change' },
				{ type: 'open_dialog', dialog: { type: 'usage' } },
			],
		};
		const resolved = createRegistry([definition]).resolve('action-probe');
		const dispatched = await dispatch(resolved!, {
			source: 'slash',
			args: '',
			invocation: 'action-probe',
		});
		const observed: string[] = [];

		const applied = await executeActions(dispatched.actions, {
			onSubmitPrompt: async (payload) => {
				observed.push(`prompt:${payload.text}:${payload.attachments.length}`);
			},
			onOpenDialog: (dialog) => {
				observed.push(`dialog:${dialog.type}`);
			},
			onShowToast: () => {},
		});

		expect(observed).toEqual(['prompt:Review this change:0', 'dialog:usage']);
		expect(applied.submitted).toBe(true);
	});
});
