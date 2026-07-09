import { describe, expect, it } from 'vitest';
import { buildTaskPrompt, normalizeTaskArgs } from '../tools/task.js';

describe('task tool prompt contract', () => {
	it('normalizes structured tasks with shared context', () => {
		const request = normalizeTaskArgs({
			agent: 'explore',
			context: '# Goal\nFind auth flow',
			tasks: [
				{
					id: 'AuthScout',
					role: 'Auth-flow scout',
					description: 'Scout auth flow',
					assignment: '# Target\npackages/code/src/auth',
				},
			],
		});

		expect(request.agent).toBe('explore');
		expect(request.context).toBe('# Goal\nFind auth flow');
		expect(request.tasks[0]).toMatchObject({
			id: 'AuthScout',
			role: 'Auth-flow scout',
			description: 'Scout auth flow',
			assignment: '# Target\npackages/code/src/auth',
		});
	});

	it('uses the agent reporting default when the caller does not override it', () => {
		const request = normalizeTaskArgs({
			agent: 'explore',
			prompt: 'Inspect queue handling',
		});

		const prompt = buildTaskPrompt(request.tasks[0], request.context, request.reporting, 'Report by file path.');

		expect(prompt).toContain('# Assignment\nInspect queue handling');
		expect(prompt).toContain('# Reporting\nReport by file path.');
	});


	it('uses a domain-neutral default report when no override is provided', () => {
		const request = normalizeTaskArgs({
			agent: 'general',
			prompt: 'Write a greeting',
		});

		const prompt = buildTaskPrompt(request.tasks[0], request.context, request.reporting, undefined);

		expect(prompt).toContain('# Reporting\nReturn a concise final report with: outcome, important details, work completed');
		expect(prompt).toContain('Only mention files, code changes, or tests when they are relevant to the assignment.');
	});
	it('lets the caller override the agent reporting default', () => {
		const request = normalizeTaskArgs({
			agent: 'general',
			prompt: 'Patch the task tool',
			reporting: 'Return only changed files and verification.',
		});

		const prompt = buildTaskPrompt(request.tasks[0], request.context, request.reporting, 'Agent default report.');

		expect(prompt).toContain('# Reporting\nReturn only changed files and verification.');
		expect(prompt).not.toContain('Agent default report.');
	});

	it('lets a task-specific reporting instruction override the caller default', () => {
		const request = normalizeTaskArgs({
			agent: 'general',
			reporting: 'Caller default.',
			tasks: [{ assignment: 'Do one thing.', reporting: 'Task-specific report.' }],
		});

		const prompt = buildTaskPrompt(request.tasks[0], request.context, request.reporting, 'Agent default report.');

		expect(prompt).toContain('# Reporting\nTask-specific report.');
		expect(prompt).not.toContain('Caller default.');
	});
});
